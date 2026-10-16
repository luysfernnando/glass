// Turn chrome, following SPEC.md "Turn chrome": the user row with its
// assistant header and dots line, the tool tree, the folded group, event
// rows. One glyph
// family (glyphs.ts), one ruler (width.ts), one hierarchy rule: bright for
// the live thing, `meta` for the done thing, `faint` for scaffolding,
// saturated color on marks only.
import type { Elements, RenderElement, RenderNode, UiPressArgument } from 'claude-code'

import type { GlassCall, GlassServerTool, GlassTurn } from '../types'
import { G } from './glyphs'
import { CODE_COLOR, highlightLine, langOf } from './highlight'
import type { State } from './highlight'
import { paintLine } from './output'
import type { Palette } from './palette'
import { measure } from './render'
import { shellSpans } from './shell'
import { THEME } from './theme'
import { cellWidth, clipPath } from './width'

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
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  // an hour on: `2h 05m`, so the clock's seven cells still hold it whole
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
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
  // no room: nothing, not a lone ellipsis a cell past the edge
  if (n <= 0) return ''
  let out = ''
  for (const ch of s) {
    if (cellWidth(out + ch) > n - 1) break
    out += ch
  }
  return out + G.ellipsis
}

// A tree row in the tree's inset. No air above it: the rows sit back to
// back (owner's request, 2026-10-05; a blank between runs, 2026-10-03, read
// as clutter once a turn had many). Tree rows sit 2 cells in from each edge (owner's request, 2026-10-03:
// the right column was flush with the terminal's edge), the same 2 the
// prose measure leaves on the right.
const TREE_INSET = 2
export function spaced(t: Table, p: Palette, row: RenderElement, air = false): RenderElement {
  return t.Box({ flexDirection: 'column', marginLeft: TREE_INSET, marginRight: TREE_INSET, children: air ? [t.Text({ color: p.faint, children: [G.pipe] }), row] : [row] })
}

// the session's directory: paths under it draw relative (`SPEC.md`, not
// the whole home path); set at session.start, empty draws paths whole
let cwd = ''
export function setCwd(dir: string): void {
  cwd = slashed(dir).replace(/\/+$/, '')
}
let home = ''
export function setHome(dir: string): void {
  home = slashed(dir).replace(/\/+$/, '')
}
// A path with `/` between its parts and a lowercase drive: Windows hands
// `C:\Users\x`, Git Bash's HOME `/c/Users/x`, so neither matched the cwd
// and every path drew whole (2026-10-07).
function slashed(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/([a-z])(?=\/|$)/i, '$1:')
    .replace(/^([a-z]):/i, (_, d: string) => `${d.toLowerCase()}:`)
}
// Claude Code's per-session temp folder: <tmp>/claude-<uid>/<project>/<session>/,
// on Windows <AppData>/Local/Temp/claude/<project>/<session>/
const SESSION_TMP = /^(?:\/(?:private\/)?tmp\/claude-\d+|[a-z]:\/.*\/Temp\/claude)\/[^/]+\/[0-9a-f-]{36}\//i
export function rel(path: string): string {
  const p = slashed(path)
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1)
  // a session's scratchpad, tasks or images: the part under the session folder
  const tmp = SESSION_TMP.exec(p)
  if (tmp) return G.ellipsis + '/' + p.slice(tmp[0].length)
  if (home && p.startsWith(home + '/')) return '~' + p.slice(home.length)
  return path
}
// chars a tree row's path keeps before it shortens to its last two parts
const SHORT_PATH = 40
// A tree row's path: rel, cut to `.../hooks/register.tsx` past SHORT_PATH,
// so the row's other parts keep their room (owner's request, 2026-10-07).
export function shortPath(path: string): string {
  const r = rel(path)
  if (r.length <= SHORT_PATH) return r
  const parts = slashed(r).split('/').filter(s => s !== '')
  return parts.length <= 2 ? r : `${G.ellipsis}/${parts.slice(-2).join('/')}`
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`
const sep = ` ${G.middot} `

// ---- user row ------------------------------------------------------------

export type TurnView = {
  turnId: string
  calls: GlassCall[]
  /** the finished turn, once it is */
  done: GlassTurn | null
}

export type UserRow = {
  text: string
  submittedAt: number | null
  /** when the turn for this prompt began; the assistant header follows once known */
  startedAt: number | null
  turn: TurnView | null
  columns: number
  /** 0.5.0, gated on the live press retest: the turn's tree is folded */
  folded?: boolean
  /** a press folds or unfolds this turn's tree; none, no chevron */
  onFold?: Press | null
  /** a press copies the turn's answer; none, no Copy */
  onCopy?: Press | null
}

// the dots: one per call in call order, grouped by consecutive tool with a
// space between groups; `ok` green, `err` red, hollow while running. Past
// DOTS_MAX calls the first DOTS_SHOWN draw and `+N` in `faint` stands for
// the rest, so the summary after them is never pushed off the row (45
// calls filled 80 columns with dots, 2026-10-06); the summary keeps every
// count, failures included.
const DOTS_MAX = 16
const DOTS_SHOWN = 12
function dots(t: Table, p: Palette, calls: GlassCall[]): RenderNode[] {
  const out: RenderNode[] = []
  let prev: string | null = null
  const shown = calls.length > DOTS_MAX ? calls.slice(0, DOTS_SHOWN) : calls
  for (const c of shown) {
    if (prev !== null && c.tool !== prev) out.push(t.Text({ children: [' '] }))
    prev = c.tool
    const mark = c.status === 'running' ? G.hollow : c.status === 'failed' ? G.cross : G.disc
    const color = c.status === 'failed' ? p.err : c.status === 'ok' ? p.ok : p.meta
    // the dot and its tree row light together under the pointer
    out.push(t.Text({ color, hover: { scope: callScope(c.id), backgroundColor: p.rowHover }, children: [mark] }))
  }
  if (shown.length < calls.length) out.push(t.Text({ color: p.faint, children: [` +${calls.length - shown.length}`] }))
  return out
}

// `Bash x3 . Read x2`: the tools in first-seen order with their counts
function toolCounts(calls: GlassCall[]): string {
  const counts = new Map<string, number>()
  for (const c of calls) counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1)
  return [...counts].map(([tool, n]) => (n > 1 ? `${toolText(tool)} ${G.times}${n}` : toolText(tool))).join(sep)
}

// ---- tool names ----------------------------------------------------------

// MCP tools arrive as `mcp__<server>__<tool>`: the label drops `mcp__` and
// splits the rest, the server drawn once in `faint` before the name. Servers
// lose the prefixes Claude Code adds (`plugin_<plugin>_`, `claude_ai_`) and
// a trailing `_MCP`, and read in kebab case; a name's underscore runs fold
// to one, or to spaces under NAME_SPACES (owner's request, 2026-10-07:
// `mcp__figma__get_design_context` read as rules, not a name). The server
// was `meta` first, which read lighter than the faint subject on water.
const NAME_SPACES = false
export type ToolLabel = { server: string | null; name: string }
export function toolLabel(tool: string): ToolLabel {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (!m) return { server: null, name: tool.replace(/_+/g, '_') }
  const server = m[1]!.replace(/^plugin_[^_]+_(?=.)/, '').replace(/^claude_ai_(?=.)/, '').replace(/(?<=.)_mcp$/i, '')
  const name = NAME_SPACES ? m[2]!.replace(/_+/g, ' ').trim() : m[2]!.replace(/_+/g, '_')
  return { server: server.toLowerCase().replace(/_+/g, '-'), name: name || m[2]! }
}
export function toolText(tool: string): string {
  const l = toolLabel(tool)
  return l.server ? `${l.server} ${l.name}` : l.name
}
// the name in the terminal's own color, as every tool name (owner's
// request, 2026-10-05); an MCP server before it in `faint`
function toolNodes(t: Table, p: Palette, tool: string, bold: boolean): RenderNode[] {
  const l = toolLabel(tool)
  const name = t.Text({ weight: bold ? 'bold' : undefined, children: [l.name] })
  return l.server ? [t.Text({ color: p.faint, children: [l.server + ' '] }), name] : [name]
}

// `<diamond> You . 01:11 PM`, the prompt under it at the measure, then after
// one blank row the assistant header `<fisheye> Claude . 01:14 PM` and the
// dots line: the one place a header can sit above both the tool rows and
// the reply, since the engine fixes the row order. Folded, the dots line
// reads the tool counts while the turn runs and the totals once it is
// done.
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
            // name and glyph in one color: a neutral bold name was tried
            // and the owner wanted the color back (2026-10-11)
            t.Text({ color: p.accentUser, weight: 'bold', children: [G.diamond + ' You'] }),
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
              t.Text({ color: p.accent, weight: 'bold', children: [G.fisheye + ' Claude'] }),
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
      if (v.done.failed > 0) summary.push(sep, t.Text({ color: p.err, children: [`${v.done.failed} failed`] }))
    } else {
      summary.push(toolCounts(v.calls))
      const failed = v.calls.filter(c => c.status === 'failed').length
      if (failed > 0) summary.push(sep, t.Text({ color: p.err, children: [`${failed} failed`] }))
    }
    // dots as sibling Texts, so each can light its row (a Text nested in a
    // Text follows its hover group but cannot heat it)
    const left = t.Box({
      flexDirection: 'row',
      flexShrink: 1,
      children: [...dots(t, p, v.calls), t.Text({ children: ['  '] }), t.Box({ flexShrink: 1, children: [t.Text({ wrap: 'truncate-end', color: v.done ? p.meta : p.bold, children: summary })] })],
    })
    // 0.5.0: the chevron and Copy return as plain Buttons at the right end,
    // gated on the live press retest (the 0.2 and 0.3 Buttons never
    // received a press; 2.1.288 fixed button routing). /fold and /unfold
    // stay the keyboard route. Label only: no children, so the tree
    // validates on engines before 2.1.295.
    const controls: RenderNode[] = []
    if (r.onFold) controls.push(t.Button({ key: `fold:${v.turnId}`, label: r.folded ? G.right : G.down, plain: true, dimColor: true, hover: { backgroundColor: p.rowHover }, onPress: r.onFold }))
    if (r.onCopy && v.done) controls.push(...(controls.length ? ['  '] : []), t.Button({ key: `copy:${v.turnId}`, label: G.copy + ' Copy', plain: true, dimColor: true, hover: { backgroundColor: p.rowHover }, onPress: r.onCopy }))
    rows.push(
      t.Box({
        key: `dots:${v.turnId}`,
        flexDirection: 'row',
        marginLeft: 2,
        // the same right inset as the tree rows, so the buttons end where
        // the durations end
        marginRight: TREE_INSET,
        justifyContent: 'space-between',
        hover: { backgroundColor: p.rowHover },
        children: [
          t.Box({ flexDirection: 'row', flexShrink: 1, children: [left] }),
          ...(controls.length ? [t.Box({ flexDirection: 'row', flexShrink: 0, marginLeft: 2, children: controls })] : []),
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
  /** a trunk row above; none by default (2026-10-05) */
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
  if (path) out.push(t.Text({ color: live ? p.path : p.faint, children: [safeText(shortPath(path), 400)] }))
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
  // the tick in `ok`: a meta tick was tried and the owner wanted the green
  // back (2026-10-11)
  const markColor = live ? p.meta : failed ? p.err : p.ok
  const subject = subjectNodes(t, p, row.tool, row.input, live)
  const tail: RenderNode[] = []
  if (!live && row.tool === 'Bash') {
    // the count only once the body folds: a three-line body is its own count
    const n = outputLines(row.output)
    if (n !== null && n > MAX_PAINTED_LINES) tail.push(t.Text({ color: p.faint, children: [sep + plural(n, 'line')] }))
  }
  // under a tenth of a second the time says nothing (`0.0s`): none
  const right = o.durationMs === null || o.durationMs < 100 ? '' : fmtToolTime(o.durationMs)
  return spaced(t, p, t.Box({
    key: `row:${row.tool_use_id}`,
    flexDirection: 'row',
    // a Read's row opens nothing, so it does not light under the pointer
    ...(row.tool === 'Read' ? {} : { hover: { scope: callScope(row.tool_use_id), backgroundColor: p.rowHover } }),
    children: [
      // the turn's last row closes the tree with the rounded corner
      // (owner's request, 2026-10-05)
      rowHead(t, t.Text({ color: p.faint, children: [(o.last ? G.arcBL : G.tee) + G.rule + ' '] }), t.Text({ color: markColor, children: [mark + ' '] })),
      t.Box({
        flexGrow: 1,
        flexShrink: 1,
        children: [
          t.Text({
            wrap: 'truncate-end',
            children: [...toolNodes(t, p, row.tool, live), ...(subject.length ? ['  ', ...subject] : []), ...tail],
          }),
        ],
      }),
      ...(live && o.clock && 'Raster' in t
        ? [t.Box({ flexShrink: 0, marginLeft: 2, children: [t.Raster({ key: 'clock', columns: CLOCK_CELLS, rows: 1, cells: o.clock })] })]
        : right
          ? [t.Box({ flexShrink: 0, marginLeft: 2, children: [t.Text({ color: live ? p.meta : p.faint, children: [right] })] })]
          : []),
    ],
  }), o.air ?? false)
}

// A tool the API ran inside the request (the advisor): no tool.call, no
// engine row, so the turn's record draws these after the reply (0.5.0).
// `|- v advisor  ran by the API                                   4.2s`
// Connector faint, the mark in meta (the engine ran nothing, so not ok's
// done), the name in `tool`, the note faint, the duration faint as on every
// finished row; none without an end time. Each row keeps its air row above.
export function renderServerToolRows(t: Table, p: Palette, tools: ReadonlyArray<GlassServerTool>): RenderElement {
  const rows = tools.map(s => {
    const right = s.endedAt === undefined || s.endedAt - s.startedAt < 100 ? '' : fmtToolTime(s.endedAt - s.startedAt)
    return spaced(t, p, t.Box({
      key: `server:${s.id}`,
      flexDirection: 'row',
      hover: { backgroundColor: p.rowHover },
      children: [
        rowHead(t, t.Text({ color: p.faint, children: [G.tee + G.rule + ' '] }), t.Text({ color: p.meta, children: [G.tick + ' '] })),
        t.Box({
          flexGrow: 1,
          flexShrink: 1,
          children: [t.Text({ wrap: 'truncate-end', children: [...toolNodes(t, p, safeText(s.name, 60), false), '  ', t.Text({ color: p.faint, children: ['ran by the API'] })] })],
        }),
        ...(right ? [t.Box({ flexShrink: 0, marginLeft: 2, children: [t.Text({ color: p.faint, children: [right] })] })] : []),
      ],
    }))
  })
  return t.Box({ flexDirection: 'column', children: rows })
}

// cells a body row leaves for the trunk column before its content
const TRUNK = 3
// painted output lines under a Bash row before the rest folds to a count
export const MAX_PAINTED_LINES = 3

// A body row under a tree row: the trunk down its left, `h` rows tall,
// the content indented under the row's mark. Under the turn's last row
// (`last`) the column is blank, since the elbow above closed the tree.
export function trunked(t: Table, p: Palette, h: number, content: RenderNode[], last = false): RenderElement {
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

// characters of one output line kept: more than any terminal row shows
const OUTPUT_LINE_MAX = 1000

// a line as a terminal leaves it: a carriage return (a progress bar's
// `50%\r100%`) starts the line over, so only the last pass shows
function overstruck(line: string): string {
  const s = line.replace(/\r+$/, '')
  return s.slice(s.lastIndexOf('\r') + 1)
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
  // each line made a string the API takes: no control characters (a `\b`
  // or a bell refused the whole tree) and cut well past any terminal's
  // width, since the row clips anyway (a minified JSON line ran 16000)
  const rows = shown.map(line =>
    trunked(t, p, 1, [
      t.Text({
        wrap: 'truncate-end',
        children: paintLine(safeText(overstruck(line), OUTPUT_LINE_MAX)).map(s => (s.color ? t.Text({ color: p[s.color], children: [s.text] }) : t.Text({ color: p.meta, children: [s.text] }))),
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
  if (hidden > 0) lines.push({ kind: 'note', num: null, pieces: [{ text: G.ellipsis + ` +${plural(hidden, 'line')}`, color: p.faint }] })

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
  const shown = o.path ? clipPath(name, Math.max(4, width - fixed)) : ''
  const titleW = o.path ? cellWidth(verb + shown + counts) + 1 : 0
  out.push(
    t.Text({
      children: [
        edge(G.arcTL + G.rule + (o.path ? ' ' : '')),
        ...(o.path
          ? [
              ...(verb ? [t.Text({ color: p.meta, children: [verb] })] : []),
              t.Text({ color: p.path, children: [shown] }),
              ...(add > 0 ? [' ', t.Text({ color: THEME.success, children: [`+${add}`] })] : []),
              ...(del > 0 ? [' ', t.Text({ color: THEME.error, children: [`-${del}`] })] : []),
              ' ',
            ]
          : []),
        edge(G.rule.repeat(Math.max(1, width - 3 - (o.path ? 1 : 0) - titleW)) + G.arcTR),
      ],
    }),
  )
  for (const l of lines) {
    // 0.5.0: the tints are the active theme's diff slots, so the card
    // matches the engine's own diff panels; 0.5.3: the marks take the
    // theme's success and error (the diff*Word slots are the engine's
    // word-level backgrounds, not text colors). A glass theme sets these to
    // the palette's addBg, delBg, ok and err.
    const bg = l.kind === 'add' ? THEME.diffAdded : l.kind === 'del' ? THEME.diffRemoved : undefined
    const mark = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '
    const markColor = l.kind === 'add' ? THEME.success : l.kind === 'del' ? THEME.error : p.faint
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

// ---- edit runs -----------------------------------------------------------

/**
 * The keys of the turn's edits that draw as one row with the edit `key`, in
 * call order: edits of one file, and edits called back to back (no text, no
 * other tool between: owner's request, 2026-10-05, `Edit x3 a.ts, b.ts`),
 * chained. `order` is the turn's main-loop calls; a Bash edit links by file.
 */
export function editRunKeys(edits: ReadonlyArray<{ id: string; key: string; file: string }>, order: ReadonlyArray<{ id: string; tool: string; afterText: boolean }>, key: string): string[] {
  const streak = new Map<string, number>()
  let s = 0
  let prevEdit = false
  for (const c of order) {
    const isEdit = c.tool === 'Edit' || c.tool === 'Write'
    if (!isEdit || c.afterText || !prevEdit) s++
    if (isEdit) streak.set(c.id, s)
    prevEdit = isEdit
  }
  const root = edits.map((_, i) => i)
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)))
  const byFile = new Map<string, number>()
  const byStreak = new Map<number, number>()
  edits.forEach((x, i) => {
    const f = byFile.get(x.file)
    if (f === undefined) byFile.set(x.file, i)
    else root[find(i)] = find(f)
    const n = x.key === x.id ? streak.get(x.id) : undefined
    if (n === undefined) return
    const at = byStreak.get(n)
    if (at === undefined) byStreak.set(n, i)
    else root[find(i)] = find(at)
  })
  const mine = edits.findIndex(x => x.key === key)
  if (mine < 0) return []
  return edits.filter((_, i) => find(i) === find(mine)).map(x => x.key)
}

// ---- folded group --------------------------------------------------------

export type GroupCall = { tool: string; input?: unknown; output?: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

/** Lines an Edit's or a Write's result added and removed; a created file counts its lines as added. */
export function lineCounts(output: unknown): { add: number; del: number } {
  const out = output as { structuredPatch?: unknown; type?: unknown; content?: unknown } | undefined
  if (out?.type === 'create' && typeof out.content === 'string') return { add: out.content.replace(/\n$/, '').split('\n').length, del: 0 }
  let add = 0
  let del = 0
  for (const h of Array.isArray(out?.structuredPatch) ? (out.structuredPatch as Hunk[]) : []) {
    for (const l of Array.isArray(h.lines) ? h.lines : []) {
      if (l[0] === '+') add++
      else if (l[0] === '-') del++
    }
  }
  return { add, del }
}

export type GroupOptions = {
  isActive: boolean
  /** the row's key, which its hover tint needs; null draws it untinted */
  key: string | null
  onExpand: Press | null
  /** the group holds the tree's last node: its last line closes the tree */
  last?: boolean
}

// One tree row per tool: `|- > Bash x2  Find foo . ls`, `|- v Read  a.ts`,
// all `faint`; a failed count in `err`; a live group ends in an ellipsis.
export function renderGroupRow(t: Table, p: Palette, calls: ReadonlyArray<GroupCall>, o: GroupOptions): RenderElement {
  const done = calls.filter(c => !c.isRunning).length
  // one line per tool, in the order the run first used it: a Bash run and
  // an edit are different things and never share a line
  const byTool = new Map<string, GroupCall[]>()
  for (const c of calls) byTool.set(c.tool, [...(byTool.get(c.tool) ?? []), c])
  // the engine marks the group active before its calls report running: no
  // count then (`0 running` read as a bug, 2026-10-05), and none for one call
  const running = calls.length - done
  const tail = o.isActive ? sep + (running > 1 ? `${running} running` : 'running') + G.ellipsis : ''
  const lines = [...byTool].map(([tool, group], i) => {
    // reads and searches by count alone, as on a run's row
    const subjects = FLAT_TOOLS.has(tool) ? [] : [...new Set(group.map(c => {
      const a = (c.input ?? {}) as Record<string, unknown>
      // a command's own description says what it did; the command is the fallback
      const path = str(a, 'file_path') ?? str(a, 'path')
      const s = str(a, 'description') ?? (path ? shortPath(path) : null) ?? str(a, 'pattern') ?? str(a, 'query') ?? str(a, 'url') ?? clip((str(a, 'command') ?? '').replace(/\s+/g, ' '), 60)
      return safeText(s.replace(/\s+/g, ' '), 200)
    }).filter(s => s !== ''))]
    // the tool's name in the terminal's own color, as an Edit row's Button
    // label must be (owner's request, 2026-10-05: one color for every name)
    const name = t.Text({ children: [group.length > 1 ? `${tool} ${G.times}${group.length}` : tool] })
    const parts: RenderNode[] = []
    if (subjects.length) parts.push('  ' + subjects.join(sep))
    if (isEditTool(tool)) {
      const k = group.filter(c => !c.isErrored).reduce((n, c) => {
        const l = lineCounts(c.output)
        return { add: n.add + l.add, del: n.del + l.del }
      }, { add: 0, del: 0 })
      if (k.add + k.del > 0) parts.push('  ', t.Text({ color: p.ok, children: [`+${k.add}`] }), ' ', t.Text({ color: p.err, children: [`-${k.del}`] }))
    }
    const failed = group.filter(c => c.isErrored || c.isInterrupted).length
    if (failed > 0) parts.push(sep, t.Text({ color: p.err, children: [`${failed} failed`] }))
    if (i === byTool.size - 1) parts.push(tail)
    // each tool its own tree row (owner's request, 2026-10-05); a tool whose
    // row already says it all (a Read's path) takes its status mark, not the
    // fold's, and no hover: there is nothing under it to open
    const opens = !FLAT_TOOLS.has(tool)
    const running = group.some(c => c.isRunning)
    const mark = opens ? G.right : running ? G.hollow : failed > 0 ? G.cross : G.tick
    const markColor = opens || running ? p.meta : failed > 0 ? p.err : p.ok
    return spaced(t, p, t.Box({
      ...(o.key && opens ? { key: `group:${o.key}:${tool}`, hover: { backgroundColor: p.rowHover } } : {}),
      flexDirection: 'row',
      children: [
        rowHead(t, t.Text({ color: p.faint, children: [(o.last && i === byTool.size - 1 ? G.arcBL : G.tee) + G.rule + ' '] }), t.Text({ color: markColor, children: [mark + ' '] })),
        t.Box({ flexShrink: 1, children: [t.Text({ wrap: 'truncate-end', children: [name, t.Text({ color: p.faint, children: parts })] })] }),
      ],
    }))
  })
  return lines.length === 1 ? lines[0]! : t.Box({ flexDirection: 'column', children: lines })
}

// ---- a run of calls -------------------------------------------------------

/**
 * The calls drawn as one row with the call `id`: the turn's calls with no
 * text from Claude between them, in call order (owner's request,
 * 2026-10-05). `order` is the turn's main-loop calls; empty when `id` is not
 * in it.
 */
export function callRun<T extends { id: string; afterText: boolean }>(order: ReadonlyArray<T>, id: string): T[] {
  const at = order.findIndex(c => c.id === id)
  if (at < 0) return []
  let start = at
  while (start > 0 && !order[start]!.afterText) start--
  let end = at + 1
  while (end < order.length && !order[end]!.afterText) end++
  return order.slice(start, end)
}

export type RunCall = { id: string; tool: string; subject: string; status: 'running' | 'background' | 'ok' | 'failed' }

export type RunOptions = {
  key: string
  isOpen: boolean
  /** the run holds the turn's last call: the row closes the tree */
  last: boolean
  lines: { add: number; del: number }
  durationMs: number | null
  /** while running: the spinner's first cell (spinCells); a ticker blits the rest */
  spin?: string
  onToggle: Press
}

// `|- v Bash x5 . Edit x2  Rewrite the hook  +54 -27 . 1 failed      1.2s`:
// one row for a run, its mark a spinner while a call runs, then a green
// tick, or a red cross when one failed; the subject is the running call's,
// else the last's. A press anywhere past the mark opens the calls under it.
export function renderRunRow(t: Table, p: Palette, calls: ReadonlyArray<RunCall>, o: RunOptions): RenderElement {
  const running = calls.some(c => c.status === 'running')
  const failed = calls.filter(c => c.status === 'failed').length
  // launched in the background and not done yet: hollow, never a tick
  const background = calls.filter(c => c.status === 'background').length
  const counts = new Map<string, number>()
  for (const c of calls) counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1)
  const name = [...counts].map(([tool, n]) => (n > 1 ? `${tool} ${G.times}${n}` : tool)).join(sep)
  const now = [...calls].reverse().find(c => c.status === 'running') ?? calls[calls.length - 1]
  // a read or a search says nothing its count does not (owner's request,
  // 2026-10-07): an edit's path and a command's description stay
  const subject = now && !FLAT_TOOLS.has(now.tool) ? safeText(now.subject.replace(/\s+/g, ' '), 200) : ''
  const mark = running && o.spin && 'Raster' in t
    ? t.Raster({ key: 'spin', columns: 1, rows: 1, cells: o.spin })
    : t.Text({ color: running || background > 0 ? p.meta : failed > 0 ? p.err : p.ok, children: [running || background > 0 ? G.hollow : failed > 0 ? G.cross : G.tick] })
  // A Button's label takes no color (foldRow's note): the counts and the
  // subject are Buttons, so a press anywhere opens the run
  const press = (k: string, label: string, color: string, dim = false) => t.Button({
    key: `${o.key}:${k}`, plain: true, ...(dim ? { dimColor: true } : {}), label, onPress: o.onToggle,
    hover: { color, backgroundColor: p.rowHover, inverse: false, dimColor: false },
  })
  const tail: RenderElement[] = []
  if (o.lines.add + o.lines.del > 0) tail.push(press('lines', `  +${o.lines.add} -${o.lines.del}`, p.ok))
  if (background > 0) tail.push(press('background', sep + `${background} in background`, p.meta))
  if (failed > 0) tail.push(press('failed', sep + `${failed} failed`, p.err))
  const right = running || background > 0 || o.durationMs === null || o.durationMs < 100 ? '' : fmtToolTime(o.durationMs)
  return spaced(t, p, t.Box({
    key: `row:${o.key}`,
    flexDirection: 'row',
    hover: { backgroundColor: p.rowHover },
    children: [
      rowHead(t, t.Text({ color: p.faint, children: [(o.last && !o.isOpen ? G.arcBL : G.tee) + G.rule + ' '] }), mark, t.Text({ children: [' '] })),
      t.Box({
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: 'row',
        overflow: 'hidden',
        // a Button never truncates: a long subject wrapped under the row and
        // broke the tree's trunk (2026-10-07), so it is a Text that cuts and
        // gives way first, the counts after it kept whole
        children: [
          t.Box({ flexShrink: 0, flexDirection: 'row', children: [press('mark', (o.isOpen ? G.down : G.right) + ' ', p.meta), press('name', name, p.bold)] }),
          ...(subject ? [t.Box({ flexShrink: 1, minWidth: 0, children: [t.Text({ wrap: 'truncate-end', dimColor: true, children: ['  ' + subject] })] })] : []),
          t.Box({ flexShrink: 0, flexDirection: 'row', children: tail }),
        ],
      }),
      ...(right ? [t.Box({ flexShrink: 0, marginLeft: 2, children: [t.Text({ color: p.faint, children: [right] })] })] : []),
    ],
  }))
}

// a running run's spinner, one frame a tick: BRAILLE PATTERN DOTS U+280B ... U+280F
const SPIN = [0x280b, 0x2819, 0x2839, 0x2838, 0x283c, 0x2834, 0x2826, 0x2827, 0x2807, 0x280f]

// A Raster's one cell for the spinner frame at `ms`, in the clockCells layout.
export function spinCells(ms: number, fg: string): string {
  const frame = SPIN[Math.floor(ms / 100) % SPIN.length]!
  const color = /^#[0-9a-f]{6}$/i.test(fg) ? parseInt(fg.slice(1), 16) : 0x01000000
  return base64(new Uint8Array(new Uint32Array([frame, color, 0x01000000]).buffer))
}

// tools a folded group lists without a fold: their line holds the whole call
export const FLAT_TOOLS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep'])

// ---- events after the turn -----------------------------------------------

export type EventTask = { status?: string; durationMs?: number }

// a background task's notification as one tree row:
// `|- v Agent "Research Empryo" finished                         1m 12s`
// A Box with a hover style must carry a key, or the validator refuses the
// whole tree and the engine draws its own row. The key is the message's
// own id: two notifications with the same first line must not share one.
// Every event row draws the tee, as tree rows do: knowing the last needs a
// subscription to the session's messages.
export function renderEventRow(t: Table, p: Palette, id: string, text: string, task: EventTask | undefined, expanded = false): RenderElement {
  const linesAll = text.split('\n')
  const at = linesAll.findIndex(l => l.trim() !== '')
  const first = safeText(linesAll[at] ?? '', 400)
  const rest = expanded ? safeText(linesAll.slice(at + 1).join('\n').trim(), MAX_TEXT) : ''
  const status = (task?.status ?? '').toLowerCase()
  const failed = /fail|error|kill|cancel/.test(status)
  // under a tenth of a second the time says nothing, as on a tree row
  const right = typeof task?.durationMs === 'number' && task.durationMs >= 100 ? fmtToolTime(task.durationMs) : ''
  // `Agent "Count hook source lines" finished` draws as a tool row
  const agent = /^Agent "(.+)" \w+/.exec(first)
  const row = spaced(t, p, t.Box({
    key: `event:${id}`,
    flexDirection: 'row',
    hover: { backgroundColor: p.rowHover },
    children: [
      rowHead(t, t.Text({ color: p.faint, children: [G.tee + G.rule + ' '] }), t.Text({ color: failed ? p.err : p.ok, children: [(failed ? G.cross : G.tick) + ' '] })),
      t.Box({ flexGrow: 1, flexShrink: 1, children: [t.Text({ wrap: 'truncate-end', children: agent ? [t.Text({ children: ['Agent'] }), t.Text({ color: p.meta, children: ['  ' + agent[1]!] })] : [t.Text({ color: p.meta, children: [first] })] })] }),
      ...(right ? [t.Box({ flexShrink: 0, marginLeft: 2, children: [t.Text({ color: p.faint, children: [right] })] })] : []),
    ],
  }))
  if (rest === '') return row
  // the rest of the notification hangs off the trunk as a Bash body does,
  // one row per line, clipped (a body with no trunk sat off the column)
  const body = rest.split('\n').map(l => t.Text({ wrap: 'truncate-end', color: p.meta, children: [l] }))
  return t.Box({
    flexDirection: 'column',
    children: [row, trunked(t, p, body.length, body)],
  })
}

// a message another agent sent, folded: `|- . Message from @Explore` in
// `private`; no key hint at the right (0.5.3: the hint line and the group
// rows gave theirs up, this was the last)
export function renderMessageRow(t: Table, p: Palette, name: string): RenderElement {
  return spaced(t, p, t.Box({
    key: `message:${name}`,
    flexDirection: 'row',
    hover: { backgroundColor: p.rowHover },
    children: [
      rowHead(t, t.Text({ color: p.faint, children: [G.tee + G.rule + ' '] }), t.Text({ color: p.faint, children: [G.ring + ' '] })),
      t.Box({ flexGrow: 1, flexShrink: 1, children: [t.Text({ wrap: 'truncate-end', color: p.private, children: [`Message from @${safeText(name, 80)}`] })] }),
    ],
  }))
}

// a prompt a plugin submitted, framed (not asUser): the plugin's name and
// the text's first line, a tick on `ok …`, a cross on `FAIL …`, the rest
// under it up to PLUGIN_LINES (no Box takes a press, so nothing may hide
// behind one); ctrl+o keeps the engine's body
const PLUGIN_LINES = 8
export function renderPluginRow(t: Table, p: Palette, id: string, name: string, text: string): RenderElement {
  const lines = text.split('\n')
  const at = lines.findIndex(l => l.trim() !== '')
  const first = safeText(lines[at] ?? '', 400)
  const rest = lines.slice(at + 1).filter(l => l.trim() !== '').map(l => safeText(l, 400))
  const mark = /^FAIL\b/.test(first)
    ? t.Text({ color: p.err, children: [G.cross + ' '] })
    : /^ok\b/.test(first)
      ? t.Text({ color: p.ok, children: [G.tick + ' '] })
      : t.Text({ color: p.faint, children: [G.ring + ' '] })
  const row = spaced(t, p, t.Box({
    key: `plugin:${id}`,
    flexDirection: 'row',
    hover: { backgroundColor: p.rowHover },
    children: [
      rowHead(t, t.Text({ color: p.faint, children: [G.tee + G.rule + ' '] }), mark),
      t.Box({ flexGrow: 1, flexShrink: 1, children: [t.Text({ wrap: 'truncate-end', children: [t.Text({ color: p.private, children: [safeText(name, 80)] }), t.Text({ color: p.meta, children: ['  ' + first] })] })] }),
    ],
  }))
  if (rest.length === 0) return row
  const extra = rest.length - PLUGIN_LINES
  const shown = extra > 0 ? [...rest.slice(0, PLUGIN_LINES), `${G.ellipsis} +${extra}${sep}ctrl+o`] : rest
  const body = shown.map(l => t.Text({ wrap: 'truncate-end', color: p.meta, children: [l] }))
  return t.Box({ flexDirection: 'column', children: [row, trunked(t, p, body.length, body)] })
}

export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
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

// A loaded skill, in place of the engine's body (its corner bracket sat off
// the trunk, 2026-10-09): one trunked line in `faint`, with the engine's
// tool count and model where it gives them. A forked skill draws as an
// Agent's launch.
export function renderSkillLoad(t: Table, p: Palette, output: unknown): RenderElement {
  const o = (output && typeof output === 'object' ? output : {}) as { status?: unknown; background?: unknown; allowedTools?: unknown; model?: unknown }
  if (o.status === 'forked') return o.background === true ? renderAgentLaunch(t, p, false) : trunked(t, p, 1, [t.Text({ color: p.faint, children: ['done'] })])
  const parts = ['skill loaded']
  if (Array.isArray(o.allowedTools) && o.allowedTools.length > 0) parts.push(`${plural(o.allowedTools.length, 'tool')} allowed`)
  if (typeof o.model === 'string' && o.model !== '') parts.push(safeText(o.model, 80))
  return trunked(t, p, 1, [t.Text({ color: p.faint, wrap: 'truncate-end', children: [parts.join(sep)] })])
}

// A failed non-Bash call's error, in place of the engine's body (its corner
// bracket broke the trunk, 2026-10-06): the reason's first line in `err`,
// the rest a `faint` count; ctrl+o has it whole.
// A call the person turned down (a denied permission, a question they
// chose to clarify or dismissed): the engine records it as an error, but
// nothing failed (owner's request, 2026-10-14).
export function isDeclined(output: unknown): boolean {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  return /doesn't want to proceed|tool use was rejected/.test(text)
}

// A declined call's result: one trunked line in `faint`, not an error.
export function renderDeclined(t: Table, p: Palette): RenderElement {
  return trunked(t, p, 1, [t.Text({ color: p.faint, wrap: 'truncate-end', children: ['Declined'] })])
}

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
// 99h 59m 59s, the longest time seven cells hold
const CLOCK_MAX_MS = ((99 * 60 + 59) * 60 + 59) * 1000

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
  // past 99h 59m the clock holds there: `100h 00m` is a cell too wide
  const text = fmtDuration(Math.min(Math.max(0, ms), CLOCK_MAX_MS)).padStart(CLOCK_CELLS)
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
// the permission mode in the active theme's own slot for it (0.5.0: the
// engine's panels and glass agree under any theme): plan `planMode`,
// accepting edits `autoAccept`, auto and bypass `warning`; anything else `meta`
export function renderHint(t: Table, p: Palette, h: { vim: string; rest: string }, tail = ''): RenderElement {
  const modeColor = /auto|bypass/i.test(h.rest) ? THEME.warning : /plan/i.test(h.rest) ? THEME.planMode : /accept/i.test(h.rest) ? THEME.autoAccept : p.meta
  return t.Text({
    wrap: 'truncate-end',
    children: [
      ...(h.vim ? [t.Text({ color: /INSERT/.test(h.vim) ? p.accentUser : p.meta, children: [h.vim] })] : []),
      ...(h.vim && h.rest ? ['  '] : []),
      ...(h.rest ? [t.Text({ color: modeColor, children: [h.rest] })] : []),
      ...(tail ? [t.Text({ color: p.faint, children: [(h.vim || h.rest ? sep : '') + tail] })] : []),
    ],
  })
}
