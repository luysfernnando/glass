// Turn chrome, following SPEC.md "Turn chrome": the user row with its
// assistant header and dots line, the tool tree, the folded group, the
// footer with its actions, event rows and the background band. One glyph
// family (glyphs.ts), one ruler (width.ts), one hierarchy rule: bright for
// the live thing, `meta` for the done thing, `faint` for scaffolding,
// saturated color on marks only.
import type { Elements, RenderElement, RenderNode, UiPressArgument } from 'claude-code'

import type { GlassAgent, GlassCall, GlassTurn } from '../types'
import { G } from './glyphs'
import { CODE_COLOR, highlightLine, langOf } from './highlight'
import type { State } from './highlight'
import { paintLine } from './output'
import type { Palette } from './palette'
import { measure } from './render'
import { shellSpans } from './shell'
import { cellWidth } from './width'

type Table = Elements['terminal']
type Press = (e: UiPressArgument) => void

// the API bounds a Text string at this many characters
const MAX_TEXT = 10000

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
export function isEditTool(name: string): boolean {
  return EDIT_TOOLS.has(name)
}

// `3:31 PM` in the machine's locale
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
export function clockTime(ms: number): string {
  return clock.format(ms)
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

// a tool's wall time: tenths under ten seconds, whole seconds after
export function fmtToolTime(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return fmtDuration(ms)
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1e6) return `${Math.round(n / 1000)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

// Empryo's rule: three decimals under a cent, two from there
export function fmtCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

// a Text string the API accepts: tab and newline are the only controls
export function safeText(s: string, max = MAX_TEXT): string {
  const clean = s.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  return clean.length > max ? clean.slice(0, max - 1) + G.ellipsis : clean
}

// cut to `n` cells with an ellipsis
export function clip(s: string, n: number): string {
  if (cellWidth(s) <= n) return s
  let out = ''
  for (const ch of s) {
    if (cellWidth(out + ch) > n - 1) break
    out += ch
  }
  return out + G.ellipsis
}

// pad or cut to exactly `n` cells
function fit(s: string, n: number): string {
  const c = clip(s, n)
  return c + ' '.repeat(Math.max(0, n - cellWidth(c)))
}

// a row of air above a tree row, with the trunk drawn through it so the
// tree stays one line (the owner wants a blank between runs, 2026-10-03)
// Tree rows sit 2 cells in from each edge (owner's request, 2026-10-03:
// the right column was flush with the terminal's edge), the same 2 the
// prose measure leaves on the right.
const TREE_INSET = 2
function spaced(t: Table, p: Palette, row: RenderElement, air = true): RenderElement {
  return t.Box({ flexDirection: 'column', marginLeft: TREE_INSET, marginRight: TREE_INSET, children: air ? [t.Text({ color: p.faint, children: [G.pipe] }), row] : [row] })
}

// the session's directory: paths under it draw relative (`SPEC.md`, not
// the whole home path); set at session.start, empty draws paths whole
let cwd = ''
export function setCwd(dir: string): void {
  cwd = dir.replace(/\/+$/, '')
}
export function rel(path: string): string {
  return cwd && path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const sep = ` ${G.middot} `

// ---- user row ------------------------------------------------------------

export type TurnView = {
  turnId: string
  calls: GlassCall[]
  /** the finished turn, once it is */
  done: GlassTurn | null
  onCopy: Press | null
}

export type UserRow = {
  text: string
  submittedAt: number | null
  /** when the turn for this prompt began; the assistant header follows once known */
  startedAt: number | null
  turn: TurnView | null
  columns: number
}

// the dots: one per call in call order, grouped by consecutive tool with a
// space between groups; `ok` green, `err` red, hollow while running
function dots(t: Table, p: Palette, calls: GlassCall[]): RenderNode[] {
  const out: RenderNode[] = []
  let prev: string | null = null
  for (const c of calls) {
    if (prev !== null && c.tool !== prev) out.push(t.Text({ children: [' '] }))
    prev = c.tool
    const mark = c.status === 'running' ? G.hollow : c.status === 'failed' ? G.cross : G.disc
    const color = c.status === 'failed' ? p.err : c.status === 'ok' ? p.ok : p.meta
    // the dot and its tree row light together under the pointer
    out.push(t.Text({ color, hover: { scope: callScope(c.id), backgroundColor: p.rowHover }, children: [mark] }))
  }
  return out
}

// `Bash x3 . Read x2`: the tools in first-seen order with their counts
function toolCounts(calls: GlassCall[]): string {
  const counts = new Map<string, number>()
  for (const c of calls) counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1)
  return [...counts].map(([tool, n]) => (n > 1 ? `${tool} ${G.times}${n}` : tool)).join(sep)
}

// `<diamond> You . 01:11 PM`, the prompt under it at the measure, then after
// one blank row the assistant header `<fisheye> Claude . 01:14 PM` and the
// dots line: the one place a header can sit above both the tool rows and
// the reply, since the engine fixes the row order. Folded, the dots line
// reads the tool counts while the turn runs and the totals once it is
// done. `Copy` at the right once the turn is done.
export function renderUserRow(t: Table, p: Palette, r: UserRow): RenderElement {
  const m = measure(r.columns)
  const rows: RenderElement[] = [
    // a turn separator: one blank row, a faint rule the measure wide, one
    // more blank row, so a new prompt stands apart from the reply above
    // (owner's request, 2026-10-03)
    // the turn boundary is one titled rule: `<diamond> You . 3:20 PM ---`
    // to the measure, a blank row above it (proposal 7, 2026-10-04: it
    // replaces a bare rule with a blank row each side, two rows saved)
    t.Box({
      marginTop: 1,
      children: [
        t.Text({
          wrap: 'truncate-end',
          children: [
            t.Text({ color: p.accentUser, bold: true, children: [G.diamond + ' You'] }),
            ...(r.submittedAt === null ? [] : [t.Text({ color: p.meta, children: [sep + clockTime(r.submittedAt)] })]),
            t.Text({ color: p.faint, children: [' ' + G.rule.repeat(Math.max(1, m - cellWidth(G.diamond + ' You' + (r.submittedAt === null ? '' : sep + clockTime(r.submittedAt))) - 1))] }),
          ],
        }),
      ],
    }),
    t.Box({ marginLeft: 2, width: m, children: [t.Text({ wrap: 'wrap', children: [safeText(r.text)] })] }),
  ]
  if (r.startedAt !== null) {
    rows.push(
      t.Box({
        marginTop: 1,
        children: [
          t.Text({
            children: [
              t.Text({ color: p.accent, bold: true, children: [G.fisheye + ' Claude'] }),
              t.Text({ color: p.meta, children: [sep + clockTime(r.startedAt)] }),
            ],
          }),
        ],
      }),
    )
  }
  const v = r.turn
  if (v && v.calls.length > 0) {
    const summary: RenderNode[] = []
    if (v.done) {
      summary.push(plural(v.done.tools, 'action'))
      if (v.done.edits > 0) summary.push(sep + plural(v.done.edits, 'edit'))
      if (v.done.failed > 0) summary.push(sep, t.Text({ color: p.err, children: [plural(v.done.failed, 'failed', 'failed')] }))
    } else {
      summary.push(toolCounts(v.calls))
      const failed = v.calls.filter(c => c.status === 'failed').length
      if (failed > 0) summary.push(sep, t.Text({ color: p.err, children: [plural(failed, 'failed', 'failed')] }))
    }
    // dots as sibling Texts, so each can light its row (a Text nested in a
    // Text follows its hover group but cannot heat it)
    const left = t.Box({
      flexDirection: 'row',
      flexShrink: 1,
      children: [...dots(t, p, v.calls), t.Text({ children: ['  '] }), t.Box({ flexShrink: 1, children: [t.Text({ wrap: 'truncate-end', color: v.done ? p.meta : p.bold, children: summary })] })],
    })
    // no chevron: a Button in a transcript row never received its press
    // live (2026-10-03), so folding moved to /fold and /unfold
    const right: RenderElement[] = []
    if (false as boolean) right.push(t.Button({ key: `copy:${v.turnId}`, label: G.copy + ' Copy', plain: true, dimColor: true, onPress: v.onCopy }))
    rows.push(
      t.Box({
        key: `dots:${v.turnId}`,
        flexDirection: 'row',
        marginLeft: 2,
        justifyContent: 'space-between',
        hover: { backgroundColor: p.rowHover },
        children: [
          t.Box({ flexDirection: 'row', flexShrink: 1, children: [left] }),
          ...(right.length ? [t.Box({ flexShrink: 0, marginLeft: 2, children: right })] : []),
        ],
      }),
    )
  }
  return t.Box({ flexDirection: 'column', children: rows })
}

// ---- tool tree -----------------------------------------------------------

export type TreeRow = {
  tool_use_id: string
  tool: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
  output?: unknown
}

export type TreeOptions = {
  /** the turn's last call draws the elbow */
  last: boolean
  /** wall time once known */
  durationMs: number | null
  /** a trunk row above; false inside a run of the same tool (2026-10-04) */
  air?: boolean
  /** while running: the clock's first cells (clockCells); a ticker blits the rest */
  clock?: string
}

function str(args: Record<string, unknown>, k: string): string | null {
  return typeof args[k] === 'string' ? (args[k] as string) : null
}

// the subject of a row: a Bash command tokenized, live or done (the owner
// liked the colors on the done row, 2026-10-05); other subjects step down
// to faint once done
function subjectNodes(t: Table, p: Palette, tool: string, input: unknown, live: boolean): RenderNode[] {
  const args = (input ?? {}) as Record<string, unknown>
  const out: RenderNode[] = []
  const command = tool === 'Bash' ? str(args, 'command') : null
  if (command) {
    const text = safeText(command.replace(/\s*\n\s*/g, ' '), 400)
    const spans = shellSpans(text, true) ?? [{ text, kind: 'plain' as const }]
    for (const s of spans) out.push(s.kind === 'plain' ? s.text : t.Text({ color: p[s.kind], children: [s.text] }))
    return out
  }
  const path = str(args, 'file_path') ?? str(args, 'path') ?? str(args, 'notebook_path')
  const url = str(args, 'url')
  const other = str(args, 'pattern') ?? str(args, 'query') ?? str(args, 'description') ?? str(args, 'skill') ?? str(args, 'prompt') ?? str(args, 'command')
  // a done row steps everything after the name down to faint, paths included
  if (other && !path) out.push(t.Text({ ...(live ? {} : { color: p.faint }), children: [safeText(other.replace(/\s*\n\s*/g, ' '), 200)] }))
  if (path) out.push(t.Text({ color: live ? p.path : p.faint, children: [safeText(rel(path), 400)] }))
  if (url) out.push(t.Text({ color: live ? p.url : p.faint, underline: live, children: [safeText(url, 400)] }))
  if (other && path) out.push(t.Text({ color: live ? p.meta : p.faint, children: [sep + safeText(other.replace(/\s*\n\s*/g, ' '), 200)] }))
  return out
}

// lines a Bash result holds, for the `. N lines` tail of a done row
function outputLines(output: unknown): number | null {
  if (!output || typeof output !== 'object') return null
  const o = output as { stdout?: unknown; stderr?: unknown }
  const text = [o.stdout, o.stderr].filter((s): s is string => typeof s === 'string' && s.trim() !== '').join('\n').replace(/\s+$/, '')
  return text === '' ? 0 : text.split('\n').length
}

// The connector and mark that open a tree row, in a box that never shrinks.
// A Text in a row shrinks with its siblings: when the subject overflows, the
// row squeezed the two-cell `o ` mark to one cell and the gap after it went
// (`oBash  cat > ...`, seen 2026-10-05). Only the subject truncates now.
function rowHead(t: Table, ...cells: RenderElement[]): RenderElement {
  return t.Box({ flexDirection: 'row', flexShrink: 0, children: cells })
}

// `|- v Bash  git log --oneline . 3 lines                        0.8s`
// Connector `faint`, mark in its status color, the name in `tool` (bold
// while live), the subject truncating (ctrl+o has the whole call), the
// time at the right. The row lights under the pointer.
export function renderTreeRow(t: Table, p: Palette, row: TreeRow, o: TreeOptions): RenderElement {
  const live = row.isRunning
  const failed = row.isErrored || row.isInterrupted
  const mark = live ? G.hollow : failed ? G.cross : G.tick
  const markColor = live ? p.meta : failed ? p.err : p.ok
  const subject = subjectNodes(t, p, row.tool, row.input, live)
  const tail: RenderNode[] = []
  if (!live && row.tool === 'Bash') {
    const n = outputLines(row.output)
    if (n !== null && n > 0) tail.push(t.Text({ color: p.faint, children: [sep + plural(n, 'line')] }))
  }
  // under a tenth of a second the time says nothing (`0.0s`): none
  const right = o.durationMs === null || o.durationMs < 100 ? '' : fmtToolTime(o.durationMs)
  return spaced(t, p, t.Box({
    key: `row:${row.tool_use_id}`,
    flexDirection: 'row',
    hover: { scope: callScope(row.tool_use_id), backgroundColor: p.rowHover },
    children: [
      rowHead(t, t.Text({ color: p.faint, children: [(o.last ? G.elbow : G.tee) + G.rule + ' '] }), t.Text({ color: markColor, children: [mark + ' '] })),
      t.Box({
        flexGrow: 1,
        flexShrink: 1,
        children: [
          t.Text({
            wrap: 'truncate-end',
            children: [t.Text({ color: p.tool, bold: live, children: [row.tool] }), ...(subject.length ? ['  ', ...subject] : []), ...tail],
          }),
        ],
      }),
      ...(live && o.clock && 'Raster' in t
        ? [t.Box({ flexShrink: 0, marginLeft: 2, children: [t.Raster({ key: 'clock', columns: CLOCK_CELLS, rows: 1, cells: o.clock })] })]
        : right
          ? [t.Box({ flexShrink: 0, marginLeft: 2, children: [t.Text({ color: live ? p.meta : p.faint, children: [right] })] })]
          : []),
    ],
  }), o.air ?? true)
}

// cells a body row leaves for the trunk column before its content
const TRUNK = 3

// A body row under a tree row: the trunk down its left, `h` rows tall,
// the content indented under the row's mark. Under the turn's last row
// (`last`) the column is blank, since the elbow above closed the tree.
function trunked(t: Table, p: Palette, h: number, content: RenderNode[], last = false): RenderElement {
  const bar = last ? ' ' : G.pipe
  return t.Box({
    flexDirection: 'row',
    marginLeft: TREE_INSET,
    marginRight: TREE_INSET,
    children: [
      t.Box({ width: TRUNK, flexShrink: 0, children: [t.Text({ color: p.faint, children: [Array(Math.max(1, h)).fill(bar).join('\n')] })] }),
      t.Box({ flexGrow: 1, flexShrink: 1, flexDirection: 'column', children: content }),
    ],
  })
}

// rows a line takes once wrapped under the trunk
function rowsOf(line: string, columns: number): number {
  const avail = Math.max(10, columns - 2 * TREE_INSET - TRUNK)
  return Math.max(1, Math.ceil(cellWidth(line) / avail))
}

export type OutputOptions = {
  columns: number
  /** lines past this fold to a `faint` count */
  maxLines: number
  /** the row above is the turn's last: no trunk */
  last?: boolean
}

// The engine's Bash result body, redrawn so the output can be painted (the
// engine strips escape codes from a rewritten result, so colors have to be
// Text) and so the trunk runs through it: one trunked row per line, the
// rest folded to `+N lines`. (The dentistry-symbol connector and the engine's own
// collapsed body for long output were the first design; both broke the
// tree's line, owner's request 2026-10-03.)
export function renderToolOutput(t: Table, p: Palette, lines: string[], o: OutputOptions = { columns: 80, maxLines: lines.length }): RenderElement {
  const shown = lines.slice(0, o.maxLines)
  // one row per output line, clipped: a long line no longer doubles the
  // body's height, and ctrl+o has the whole output (2026-10-04)
  const rows = shown.map(line =>
    trunked(t, p, 1, [
      t.Text({
        wrap: 'truncate-end',
        children: paintLine(line).map(s => (s.color ? t.Text({ color: p[s.color], children: [s.text] }) : t.Text({ color: p.meta, children: [s.text] }))),
      }),
    ], o.last),
  )
  const rest = lines.length - shown.length
  if (rest > 0) rows.push(trunked(t, p, 1, [t.Text({ color: p.faint, children: [G.ellipsis + ` +${plural(rest, 'line')}`] })], o.last))
  return t.Box({ flexDirection: 'column', children: rows })
}

// ---- an Edit's diff ------------------------------------------------------

export type Hunk = { oldStart: number; newStart: number; lines: string[] }

export type DiffOptions = {
  /** the file's path, for the highlighter's language */
  path: string
  /** the terminal's width */
  columns: number
  /** the row above is the turn's last (kept for the callers' symmetry; the card's own border is its trunk) */
  last?: boolean
  /** `Created` or `Deleted` before the path in the title; absent for an update */
  verb?: string
}

// rows a diff body draws before folding the rest into a count
const MAX_DIFF_ROWS = 200
const DIFF_MIN = 60

// An Edit's `structuredPatch` as glass draws it, in place of the engine's
// own diff panel (owner's request, 2026-10-03, after Empryo's card): a
// rounded `faint` frame on the trunk column, sized to the hunks, one number column (the new
// number on a kept or added line, the old on a removed one) in `faint`,
// `+` in `ok` on an `addBg` row, `-` in `err` on a `delBg` row, the code
// painted by glass's highlighter, an ellipsis row between hunks.
export function renderDiff(t: Table, p: Palette, hunks: ReadonlyArray<Hunk>, o: DiffOptions): RenderElement {
  const lang = langOf(o.path)
  const last = Math.max(1, ...hunks.flatMap(h => [h.oldStart + h.lines.length, h.newStart + h.lines.length]))
  const digits = String(last).length
  type Piece = { text: string; color?: string }
  type Line = { kind: 'add' | 'del' | 'ctx' | 'note'; num: number | null; pieces: Piece[] }
  const lines: Line[] = []
  let widest = 0
  let total = 0
  let hidden = 0
  let add = 0
  let del = 0
  hunks.forEach((h, i) => {
    const state: State = { inBlock: false }
    // one context line before the first change and one after the last;
    // context between changes stays, and the numbers keep counting
    const changed = h.lines.map((l, k) => (l[0] === '+' || l[0] === '-' ? k : -1)).filter(k => k >= 0)
    const lo = changed.length ? changed[0]! - 1 : -Infinity
    const hi = changed.length ? changed[changed.length - 1]! + 1 : Infinity
    let k = -1
    if (i > 0 && total < MAX_DIFF_ROWS) lines.push({ kind: 'note', num: null, pieces: [{ text: G.ellipsis, color: p.faint }] })
    let old = h.oldStart
    let cur = h.newStart
    for (const raw of h.lines) {
      k++
      const head = raw[0]
      const kind = head === '+' ? 'add' : head === '-' ? 'del' : head === '\\' ? 'note' : 'ctx'
      const num = kind === 'del' ? old : cur
      if (kind === 'ctx' || kind === 'del') old++
      if (kind === 'ctx' || kind === 'add') cur++
      if (kind === 'add') add++
      if (kind === 'del') del++
      if (kind === 'ctx' && (k < lo || k > hi)) continue
      total++
      if (total > MAX_DIFF_ROWS) {
        hidden++
        continue
      }
      // tabs expand here: the engine and the terminal disagree on a tab's width
      const body = safeText(raw.slice(1), 2000).replace(/\t/g, '    ')
      widest = Math.max(widest, cellWidth(body))
      if (kind === 'note') {
        lines.push({ kind, num: null, pieces: [{ text: body, color: p.faint }] })
        continue
      }
      const pieces = highlightLine(body, lang, state).map(s => (s.kind === 'plain' ? { text: s.text } : { text: s.text, color: p[CODE_COLOR[s.kind]] }))
      lines.push({ kind, num, pieces })
    }
  })
  if (hidden > 0) lines.push({ kind: 'note', num: null, pieces: [{ text: G.ellipsis + ` +${plural(hidden, 'line')} (ctrl+o to expand)`, color: p.faint }] })

  const name = safeText(rel(o.path), 400)
  const counts = (add > 0 ? ` +${add}` : '') + (del > 0 ? ` -${del}` : '')
  const verb = o.verb ? o.verb + ' ' : ''
  const cap = Math.max(20, o.columns - 2 * TREE_INSET)
  const width = Math.min(cap, Math.max(DIFF_MIN, widest + digits + 3 + 4, cellWidth(verb + name + counts) + 8))
  // inside the frame: a border and a padding cell each side
  const inner = width - 4
  const gutter = digits + 3
  const room = Math.max(1, inner - gutter)

  // The frame is drawn by glass, row by row, so the file can sit in the top
  // border, `SPEC.md +1 -1` between the arcs (owner's pick, 2026-10-03; an absolute
  // title over a Box border is clipped by the engine). glass breaks every
  // code line at the room itself, so the engine never wraps inside the card
  // and each row carries its own two edges: no glyph column guesses a height.
  const edge = (s: string) => t.Text({ color: p.faint, children: [s] })
  const out: RenderElement[] = []
  const fixed = 3 + cellWidth(verb + counts) + 3
  const shown = o.path ? clip(name, Math.max(4, width - fixed)) : ''
  const titleW = o.path ? cellWidth(verb + shown + counts) + 1 : 0
  out.push(
    t.Text({
      children: [
        edge(G.arcTL + G.rule + (o.path ? ' ' : '')),
        ...(o.path
          ? [
              ...(verb ? [t.Text({ color: p.meta, children: [verb] })] : []),
              t.Text({ color: p.path, children: [shown] }),
              ...(add > 0 ? [' ', t.Text({ color: p.ok, children: [`+${add}`] })] : []),
              ...(del > 0 ? [' ', t.Text({ color: p.err, children: [`-${del}`] })] : []),
              ' ',
            ]
          : []),
        edge(G.rule.repeat(Math.max(1, width - 3 - (o.path ? 1 : 0) - titleW)) + G.arcTR),
      ],
    }),
  )
  for (const l of lines) {
    const bg = l.kind === 'add' ? p.addBg : l.kind === 'del' ? p.delBg : undefined
    const mark = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '
    const markColor = l.kind === 'add' ? p.ok : l.kind === 'del' ? p.err : p.faint
    chunk(l.pieces, room).forEach((part, n) => {
      const used = part.reduce((w, x) => w + cellWidth(x.text), 0)
      const head: RenderNode[] =
        n === 0 && l.num !== null
          ? [t.Text({ color: bg ? p.meta : p.faint, children: [String(l.num).padStart(digits) + ' '] }), t.Text({ color: markColor, children: [mark + ' '] })]
          : [' '.repeat(gutter)]
      out.push(
        t.Box({
          flexDirection: 'row',
          children: [
            edge(G.pipe + ' '),
            t.Box({
              width: inner,
              flexShrink: 0,
              ...(bg ? { backgroundColor: bg } : {}),
              children: [
                t.Text({
                  wrap: 'truncate-end',
                  children: [...head, ...part.map(x => (x.color ? t.Text({ color: x.color, children: [x.text] }) : x.text)), ' '.repeat(Math.max(0, room - used))],
                }),
              ],
            }),
            edge(' ' + G.pipe),
          ],
        }),
      )
    })
  }
  out.push(edge(G.arcBL + G.rule.repeat(width - 2) + G.arcBR))
  // the card sits on the trunk column: its left edge is the trunk
  return t.Box({ marginLeft: TREE_INSET, marginRight: TREE_INSET, width, flexDirection: 'column', children: out })
}

// colored pieces cut into rows of at most `w` cells, by the engine's ruler
function chunk(pieces: ReadonlyArray<{ text: string; color?: string }>, w: number): { text: string; color?: string }[][] {
  const rows: { text: string; color?: string }[][] = [[]]
  let used = 0
  for (const piece of pieces) {
    let buf = ''
    for (const ch of piece.text) {
      const cw = cellWidth(ch)
      if (used + cw > w && used > 0) {
        if (buf) rows[rows.length - 1]!.push({ ...piece, text: buf })
        rows.push([])
        buf = ''
        used = 0
      }
      buf += ch
      used += cw
    }
    if (buf) rows[rows.length - 1]!.push({ ...piece, text: buf })
  }
  return rows
}

// ---- a Bash result that changed files ------------------------------------

export type ChangedFile = { filePath: string; hunks: Hunk[]; created?: true; deleted?: true }

export type BashResultOptions = {
  /** the painted body shows this many lines before folding the rest */
  maxLines: number
  moreFiles: number
  columns: number
  last?: boolean
}

// A Bash result whose command rewrote files: the output body as the
// standalone one draws (folded past `maxLines` to a `faint` count), then
// per file, after one trunked row of air, a header `Updated <path> +a -b` and the
// same rounded diff card an Edit gets (owner's request, 2026-10-03: the
// engine's own panel for these was the one pink thing left).
export function renderBashResult(t: Table, p: Palette, lines: string[], files: ReadonlyArray<ChangedFile>, o: BashResultOptions): RenderElement {
  const rows: RenderElement[] = []
  const air = () => trunked(t, p, 1, [t.Text({ children: [''] })], o.last)
  if (lines.length > 0) rows.push(renderToolOutput(t, p, lines, { columns: o.columns, maxLines: o.maxLines, last: o.last }))
  for (const f of files) {
    const verb = f.created ? 'Created' : f.deleted ? 'Deleted' : undefined
    rows.push(air())
    // the card's top border names the file; a change with no hunks keeps a header line
    if (f.hunks.length > 0) {
      rows.push(renderDiff(t, p, f.hunks, { path: f.filePath, columns: o.columns, last: o.last, ...(verb ? { verb } : {}) }))
      continue
    }
    rows.push(
      trunked(t, p, 1, [
        t.Text({
          wrap: 'truncate-end',
          children: [
            t.Text({ color: p.meta, children: [(verb ?? 'Updated') + ' '] }),
            t.Text({ color: p.path, children: [safeText(rel(f.filePath), 400)] }),
          ],
        }),
      ], o.last),
    )
  }
  if (o.moreFiles > 0) {
    rows.push(air())
    rows.push(trunked(t, p, 1, [t.Text({ color: p.faint, children: [G.ellipsis + ` +${o.moreFiles} more file${o.moreFiles === 1 ? '' : 's'}`] })], o.last))
  }
  return t.Box({ flexDirection: 'column', children: rows })
}

// ---- folded group --------------------------------------------------------

export type GroupCall = { tool: string; input?: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

export type GroupOptions = {
  isActive: boolean
  /** the Button's key; null draws the fold as text alone */
  key: string | null
  onExpand: Press | null
}

// `|- o +17 completed [3 edits] . Click to expand`, all `faint`, the mark
// in `meta`; a failed count in `err`; a live group ends in an ellipsis.
export function renderGroupRow(t: Table, p: Palette, calls: ReadonlyArray<GroupCall>, o: GroupOptions): RenderElement {
  const done = calls.filter(c => !c.isRunning).length
  const edits = calls.filter(c => isEditTool(c.tool)).length
  const failed = calls.filter(c => c.isErrored || c.isInterrupted).length
  // what the run touched: the tools with counts, then each subject once
  const counts = new Map<string, number>()
  for (const c of calls) counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1)
  const tools = [...counts].map(([tool, n]) => (n > 1 ? `${tool} ${G.times}${n}` : tool)).join(sep)
  const subjects = [...new Set(calls.map(c => {
    const a = (c.input ?? {}) as Record<string, unknown>
    const s = str(a, 'file_path') ?? str(a, 'path') ?? str(a, 'pattern') ?? str(a, 'query') ?? str(a, 'url') ?? clip((str(a, 'command') ?? '').replace(/\s+/g, ' '), 60)
    return safeText(rel(s).replace(/\s+/g, ' '), 200)
  }).filter(s => s !== ''))]
  const parts: RenderNode[] = [t.Text({ color: p.tool, children: [tools] })]
  if (subjects.length) parts.push('  ' + subjects.join(sep))
  if (edits > 0) parts.push(` [${plural(edits, 'edit')}]`)
  if (failed > 0) parts.push(sep, t.Text({ color: p.err, children: [`${failed} failed`] }))
  // no fold button: a Button in a transcript row never received its press
  // live (2026-10-03); /expand opens every group
  const button = null
  const tail = o.isActive ? sep + `${calls.length - done} running` + G.ellipsis : ''
  return spaced(t, p, t.Box({
    ...(o.key ? { key: `group:${o.key}`, hover: { backgroundColor: p.rowHover } } : {}),
    flexDirection: 'row',
    children: [
      rowHead(t, t.Text({ color: p.faint, children: [G.tee + G.rule + ' '] }), t.Text({ color: p.meta, children: [G.right + ' '] })),
      t.Box({ flexShrink: 1, children: [t.Text({ wrap: 'truncate-end', color: p.faint, children: [...parts, tail] })] }),
      ...(button ? [t.Box({ flexShrink: 0, children: [button] })] : []),
    ],
  }))
}

// ---- events after the turn -----------------------------------------------

export type EventTask = { status?: string; durationMs?: number }

// a background task's notification as one tree row:
// `|- v Agent "Research Empryo" finished                         1m 12s`
// A Box with a hover style must carry a key, or the validator refuses the
// whole tree and the engine draws its own row.
export function renderEventRow(t: Table, p: Palette, text: string, task: EventTask | undefined, expanded = false): RenderElement {
  const linesAll = text.split('\n')
  const at = linesAll.findIndex(l => l.trim() !== '')
  const first = safeText(linesAll[at] ?? '', 400)
  const rest = expanded ? safeText(linesAll.slice(at + 1).join('\n').trim(), MAX_TEXT) : ''
  const status = (task?.status ?? '').toLowerCase()
  const failed = /fail|error|kill|cancel/.test(status)
  const right = typeof task?.durationMs === 'number' && task.durationMs > 0 ? fmtToolTime(task.durationMs) : ''
  // `Agent "Count hook source lines" finished` draws as a tool row
  const agent = /^Agent "(.+)" \w+/.exec(first)
  const row = spaced(t, p, t.Box({
    key: `event:${first.slice(0, 60)}`,
    flexDirection: 'row',
    hover: { backgroundColor: p.rowHover },
    children: [
      rowHead(t, t.Text({ color: p.faint, children: [G.tee + G.rule + ' '] }), t.Text({ color: failed ? p.err : p.ok, children: [(failed ? G.cross : G.tick) + ' '] })),
      t.Box({ flexGrow: 1, flexShrink: 1, children: [t.Text({ wrap: 'truncate-end', color: p.meta, children: agent ? [t.Text({ color: p.tool, children: ['Agent'] }), '  ' + agent[1]!] : [first] })] }),
      ...(right ? [t.Box({ flexShrink: 0, marginLeft: 2, children: [t.Text({ color: p.faint, children: [right] })] })] : []),
    ],
  }))
  if (rest === '') return row
  return t.Box({
    flexDirection: 'column',
    children: [row, t.Box({ marginLeft: 5, children: [t.Text({ wrap: 'wrap', color: p.meta, children: [rest] })] })],
  })
}

// a message another agent sent, folded: `|- . Message from @Explore` in
// `private`, with the engine's own hint at the right; ctrl+o shows the body
export function renderMessageRow(t: Table, p: Palette, name: string): RenderElement {
  return spaced(t, p, t.Box({
    key: `message:${name}`,
    flexDirection: 'row',
    hover: { backgroundColor: p.rowHover },
    children: [
      rowHead(t, t.Text({ color: p.faint, children: [G.tee + G.rule + ' '] }), t.Text({ color: p.faint, children: [G.ring + ' '] })),
      t.Box({ flexGrow: 1, flexShrink: 1, children: [t.Text({ wrap: 'truncate-end', color: p.private, children: [`Message from @${safeText(name, 80)}`] })] }),
      t.Box({ flexShrink: 0, marginLeft: 2, children: [t.Text({ color: p.faint, children: ['ctrl+o'] })] }),
    ],
  }))
}

// ---- background band -----------------------------------------------------

const BAND_ROWS = 5
const COL_NAME = 20
const COL_MODEL = 22
const COL_STAGE = 14
const COL_TOKENS = 8

export type BandOptions = {
  agents: GlassAgent[]
  now: number
  columns: number
  open: boolean
  onToggle: Press | null
  /** the slash command that lists tasks, when the session has one */
  tasksCommand: string | null
}

// the agent's face: eyes level while it thinks, lowered while it reads
function face(a: GlassAgent): string {
  const eye = G.disc
  const mouth = a.stage.startsWith('thinking') ? G.smile : G.down
  return `(${eye}${mouth}${eye})`
}

function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

// A rounded frame the band's width, the title in its top edge and the
// oldest agent's elapsed time at the right; one row per live agent, newest
// last, five at most and `+N more`; the bottom edge carries the hint.
// Closed, one strip: the title, the faces, the newest agent's stage.
export function renderBand(t: Table, p: Palette, o: BandOptions): RenderElement {
  const { agents, now } = o
  // the engine draws its `[-]` collapse mark over the band's top-right
  // cells; the frame stops four short of it (2026-10-04)
  const w = Math.max(40, o.columns - 4)
  const oldest = agents.reduce((n, a) => Math.min(n, a.startedAt), now)
  const elapsed = fmtDuration(Math.max(0, now - oldest))
  const titleText = `background${sep}${agents.length}`
  const chevron = o.onToggle
    ? t.Button({ key: 'band:toggle', label: o.open ? G.down : G.right, plain: true, onPress: o.onToggle })
    : t.Text({ color: p.accent, children: [o.open ? G.down : G.right] })
  const title = t.Text({
    children: [
      t.Text({ color: p.accent, children: [G.dotted + ' '] }),
      t.Text({ color: p.accent, bold: true, children: ['background'] }),
      t.Text({ color: p.meta, children: [sep] }),
      t.Text({ color: p.accent, bold: true, children: [String(agents.length)] }),
      ' ',
    ],
  })

  if (!o.open) {
    // `- o background . 3 v - (o_o) (o_o)  Research Empryo . thinking... ----- 1m 25s -`
    // the fill is measured from the strings around it, so the strip is
    // exactly the band wide
    const newest = agents[agents.length - 1]!
    const faces = agents.slice(-BAND_ROWS).map(a => face(a)).join(' ')
    const lead = `${G.rule} `
    const titleStr = `${G.dotted} background${sep}${agents.length} `
    const mid = ` ${G.rule} `
    const tail = ` ${elapsed} ${G.rule}`
    const fixed = cellWidth(lead + titleStr) + 1 + cellWidth(mid + faces) + 2 + 1 + cellWidth(tail)
    const name = clip(`${a11(newest.description)}${sep}${newest.stage}`, Math.max(8, w - fixed - 8))
    const fill = Math.max(1, w - fixed - cellWidth(name))
    return t.Box({
      flexDirection: 'row',
      width: w,
      children: [
        t.Text({ color: p.accent, children: [lead] }),
        title,
        chevron,
        t.Text({ color: p.accent, children: [mid] }),
        t.Text({ color: p.warn, children: [faces] }),
        t.Text({ color: p.meta, children: [`  ${name} `] }),
        t.Text({ color: p.accent, children: [G.rule.repeat(fill)] }),
        t.Text({ color: p.meta, children: [` ${elapsed} `] }),
        t.Text({ color: p.accent, children: [G.rule] }),
      ],
    })
  }

  // the top edge: arc, rule, the title, rules to the elapsed time, arc
  const topUsed = cellWidth(`${G.arcTL}${G.rule} ${G.dotted} background${sep}${agents.length} `) + 1 + 1 + cellWidth(` ${elapsed} ${G.rule}${G.arcTR}`)
  const top = t.Box({
    flexDirection: 'row',
    children: [
      t.Text({ color: p.accent, children: [G.arcTL + G.rule + ' '] }),
      title,
      chevron,
      t.Text({ color: p.accent, children: [' ' + G.rule.repeat(Math.max(1, w - topUsed))] }),
      t.Text({ color: p.meta, children: [` ${elapsed} `] }),
      t.Text({ color: p.accent, children: [G.rule + G.arcTR] }),
    ],
  })
  const edge = (s: string) => t.Text({ color: p.accent, children: [s] })
  const inner = w - 4
  const shown = agents.slice(-BAND_ROWS)
  const more = agents.length - shown.length
  // the diamond, a space, the five-cell face, a space, then the columns with one space between
  const fileWidth = Math.max(0, inner - 8 - COL_NAME - 1 - COL_MODEL - 1 - COL_STAGE - 1 - COL_TOKENS - 1)
  const rows = shown.map(a => {
    const modelText = `${shortModel(a.model)}${a.effort ? sep + a.effort : ''}`
    return t.Box({
      flexDirection: 'row',
      children: [
        edge(G.pipe + ' '),
        t.Text({
          children: [
            t.Text({ color: p.warn, children: [G.diamond + ' ' + face(a) + ' '] }),
            t.Text({ color: p.bold, bold: true, children: [fit(a11(a.description), COL_NAME)] }),
            ' ',
            t.Text({ color: p.accent, children: [fit(modelText, COL_MODEL)] }),
            ' ',
            t.Text({ color: p.meta, children: [fit(a.stage, COL_STAGE)] }),
            ' ',
            t.Text({ color: p.meta, children: [fit(a.tokens > 0 ? fmtTokens(a.tokens) : '', COL_TOKENS)] }),
            ' ',
            t.Text({ color: p.faint, children: [fit(a.file, fileWidth)] }),
          ],
        }),
        edge(' ' + G.pipe),
      ],
    })
  })
  if (more > 0) {
    rows.push(
      t.Box({
        flexDirection: 'row',
        children: [edge(G.pipe + ' '), t.Text({ color: p.faint, children: [fit(`  +${more} more`, inner)] }), edge(' ' + G.pipe)],
      }),
    )
  }
  const hint = 'They outlive this turn'
  const cmd = o.tasksCommand ? `/${o.tasksCommand}` : ''
  const bottomUsed = 2 + 1 + cellWidth(hint) + 1 + (cmd ? cellWidth(cmd) + 2 : 0) + 2
  const bottom = t.Box({
    flexDirection: 'row',
    children: [
      t.Text({ color: p.accent, children: [G.arcBL + G.rule + ' '] }),
      t.Text({ color: p.faint, children: [hint + ' '] }),
      t.Text({ color: p.accent, children: [G.rule.repeat(Math.max(1, w - bottomUsed))] }),
      ...(cmd ? [t.Text({ color: p.meta, children: [` ${cmd} `] })] : []),
      t.Text({ color: p.accent, children: [G.rule + G.arcBR] }),
    ],
  })
  return t.Box({ flexDirection: 'column', width: w, children: [top, ...rows, bottom] })
}

// a description as one printable line
function a11(s: string): string {
  return safeText(s.replace(/\s+/g, ' ').trim(), 120)
}

// A backgrounded Agent's result, in place of the engine's body (its corner
// bracket broke the trunk, 2026-10-04): one trunked line in `faint`.
export function renderAgentLaunch(t: Table, p: Palette, remote: boolean): RenderElement {
  const text = remote ? `running remotely${sep}/tasks` : `running in the background${sep}${G.arrowDown} to manage`
  return trunked(t, p, 1, [t.Text({ color: p.faint, wrap: 'truncate-end', children: [text] })])
}

// A Bash command that printed nothing, in place of the engine's body (its
// corner bracket broke the trunk, 2026-10-06): one trunked line in `faint`.
export function renderNoOutput(t: Table, p: Palette): RenderElement {
  return trunked(t, p, 1, [t.Text({ color: p.faint, wrap: 'truncate-end', children: ['(No output)'] })])
}

// A failed non-Bash call's error, in place of the engine's body (its corner
// bracket broke the trunk, 2026-10-06): the reason's first line in `err`,
// the rest a `faint` count; ctrl+o has it whole.
export function renderToolError(t: Table, p: Palette, text: string): RenderElement {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '')
  const rows = [trunked(t, p, 1, [t.Text({ color: p.err, wrap: 'truncate-end', children: [safeText(lines[0] ?? 'Error', 400)] })])]
  if (lines.length > 1) rows.push(trunked(t, p, 1, [t.Text({ color: p.faint, children: [G.ellipsis + ` +${plural(lines.length - 1, 'line')}`] })]))
  return t.Box({ flexDirection: 'column', children: rows })
}

// ---- live clock ----------------------------------------------------------

/** the hover group a call's dot and its tree row share */
export function callScope(id: string): string {
  return ('glass:' + id).slice(0, 64)
}

/** cells the running row's clock takes: `12m 04s` at most */
export const CLOCK_CELLS = 7

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

// A Raster's cells for the elapsed time, right-aligned in CLOCK_CELLS: each
// cell a [codePoint, fg, bg] triplet of little-endian u32, the background
// the terminal's own (bit 24 alone). ASCII digits and letters only.
export function clockCells(ms: number, fg: string): string {
  const text = fmtDuration(Math.max(0, ms)).slice(-CLOCK_CELLS).padStart(CLOCK_CELLS)
  const color = /^#[0-9a-f]{6}$/i.test(fg) ? parseInt(fg.slice(1), 16) : 0x01000000
  const words = new Uint32Array(CLOCK_CELLS * 3)
  for (let i = 0; i < CLOCK_CELLS; i++) {
    words[i * 3] = text.charCodeAt(i)
    words[i * 3 + 1] = color
    words[i * 3 + 2] = 0x01000000
  }
  return base64(new Uint8Array(words.buffer))
}

// ---- the hint line under the prompt ----------------------------------------

// The engine's hint, its key reminders dropped (owner's request, 2026-10-04:
// keep the line under the prompt clean): `(shift+tab to cycle)` and
// `<left arrow> for agents` go. The vim mode comes first, wherever the engine
// put it (live: `<mode> . -- INSERT --`), then the permission mode. Null when
// the hint has neither and nothing was dropped (`? for shortcuts`), so the
// engine keeps its own line.
export function cleanHint(hint: string): { vim: string; rest: string } | null {
  const dropped = hint
    .replace(/\s*\((?:shift|ctrl|alt|meta)\+[a-z]+ to cycle\)/gi, '')
    .replace(new RegExp('\\s*' + G.middot + '?\\s*' + G.arrowLeft + '\\s*for agents', 'g'), '')
  const vimMatch = /--\s*[A-Z]+\s*--/.exec(dropped)
  const vim = vimMatch ? vimMatch[0] : ''
  const sepRe = new RegExp('^[\\s' + G.middot + ']+|[\\s' + G.middot + ']+$', 'g')
  const rest = (vim ? dropped.replace(vim, ' ') : dropped).replace(new RegExp('\\s*' + G.middot + '\\s*' + G.middot + '\\s*', 'g'), ' ' + G.middot + ' ').replace(sepRe, '')
  const changed = dropped !== hint
  if (!changed && !vim && !MODE_RE.test(rest)) return null
  return { vim, rest }
}

const MODE_RE = /mode on|accept edits on|plan mode/i

// the vim mode in `accentUser` (the person's own color: typing is theirs),
// the permission mode colored by what it means: auto and bypass `warn`, plan
// `accent`, accepting edits `ok`; anything else `meta`
export function renderHint(t: Table, p: Palette, h: { vim: string; rest: string }): RenderElement {
  const modeColor = /auto|bypass/i.test(h.rest) ? p.warn : /plan/i.test(h.rest) ? p.accent : /accept/i.test(h.rest) ? p.ok : p.meta
  return t.Text({
    wrap: 'truncate-end',
    children: [
      ...(h.vim ? [t.Text({ color: /INSERT/.test(h.vim) ? p.accentUser : p.meta, children: [h.vim] })] : []),
      ...(h.vim && h.rest ? ['  '] : []),
      ...(h.rest ? [t.Text({ color: modeColor, children: [h.rest] })] : []),
    ],
  })
}
