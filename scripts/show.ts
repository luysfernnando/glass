// Paints the DEMO.md fixtures in the terminal, before (the installed 0.4.25
// in the plugin cache) and after (this working tree), in real colors.
//
//   bun scripts/show.ts                     every fixture that differs
//   bun scripts/show.ts --all               identical fixtures too
//   bun scripts/show.ts diff-card hint      only fixtures whose name contains these
//   bun scripts/show.ts --theme rose-pine   resolve theme slots through that theme
//   bun scripts/show.ts --theme dark        ... or the stock dark defaults
//   bun scripts/show.ts --plain             no colors, for a paste
//   GLASS_BEFORE=/path/to/old/hooks bun scripts/show.ts
//
// Before against the last commit instead of the installed release:
//   rm -rf /tmp/glass-base && mkdir -p /tmp/glass-base && git archive HEAD hooks types | tar -x -C /tmp/glass-base
//   GLASS_BEFORE=/tmp/glass-base/hooks bun scripts/show.ts --all
//
// Layout is an approximation of the engine's: column boxes stack, row boxes
// sit side by side, a `space-between` row pushes its last child to the right
// edge of the room it has (the terminal width less the margins and widths
// above it), a tinted Box paints its width.
//
// The renderers build plain trees and import nothing at runtime from
// 'claude-code', so both versions load here as ordinary modules. A theme
// slot named as a color (planMode, diffAdded) resolves through the active
// custom theme file when settings.json names one, else the dark defaults;
// under a glass theme those slots are the palette's own colors, so the
// diff card and the mode word look the same before and after. Under
// rose-pine or dark they follow that theme, which is the change.
// A row that differs from the before block is marked with a bar.
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Node = string | { type: string; props: Record<string, unknown> & { children?: Node[] } }
type Mods = {
  chrome: Record<string, (...a: never[]) => unknown>
  render: { renderReply: (...a: never[]) => Node }
  markdown: { parseMarkdown: (s: string) => unknown }
  palette: { PALETTES: Record<string, Record<string, string>> }
  glyphs: { G: Record<string, string> }
}

const HERE = new URL('.', import.meta.url).pathname
const AFTER = join(HERE, '..', 'hooks')
const BEFORE = process.env.GLASS_BEFORE ?? join(homedir(), '.claude', 'plugins', 'cache', 'glass', 'glass', '0.4.25', 'hooks')
const PALETTE = process.env.GLASS_PALETTE ?? 'water'
const COLUMNS = Math.min(process.stdout.columns ?? 100, 110)

// arguments: --all, --theme <name>, then fixture name filters
const argv = process.argv.slice(2)
const SHOW_ALL = argv.includes('--all')
const PLAIN = argv.includes('--plain')
const BEFORE_LABEL = BEFORE.includes('0.4.25') ? 'before 0.4.25' : `before (${BEFORE.replace(/\/hooks\/?$/, '').split('/').pop()})`
const themeArg = argv.includes('--theme') ? argv[argv.indexOf('--theme') + 1] : undefined
const want = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--theme')

// ---- theme slots -----------------------------------------------------------

const DARK: Record<string, string> = {
  success: '#4eba65', error: '#ff6b80',
  planMode: '#5fb3d9', autoAccept: '#8fc98f', warning: '#e5a84b', permission: '#b1b9f9',
  diffAdded: '#225c2a', diffRemoved: '#7a2f2f', diffAddedWord: '#9cce8b', diffRemovedWord: '#e67680',
}
function themeSlots(): { name: string; slots: Record<string, string> } {
  try {
    let name = themeArg
    if (!name) {
      const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')) as { theme?: string }
      name = /^custom:(.+)$/.exec(settings.theme ?? '')?.[1] ?? 'dark'
    }
    if (name === 'dark') return { name, slots: DARK }
    const file = join(homedir(), '.claude', 'themes', `${name}.json`)
    if (!existsSync(file)) return { name: `dark (no ${file})`, slots: DARK }
    const theme = JSON.parse(readFileSync(file, 'utf8')) as { overrides?: Record<string, string> }
    return { name, slots: { ...DARK, ...(theme.overrides ?? {}) } }
  } catch {
    return { name: 'dark', slots: DARK }
  }
}
const THEME = themeSlots()
const SLOTS = THEME.slots

// ---- painting ----------------------------------------------------------------

const ESC = String.fromCodePoint(0x1b)
function rgb(color: string, bg: boolean): string {
  if (PLAIN) return ''
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : SLOTS[color]
  if (!hex) return ''
  const n = parseInt(hex.slice(1), 16)
  return `${ESC}[${bg ? 48 : 38};2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`
}
const RESET = PLAIN ? '' : `${ESC}[0m`

type Style = { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }
function open(s: Style): string {
  if (PLAIN) return ''
  let out = ''
  if (s.fg) out += rgb(s.fg, false)
  if (s.bg) out += rgb(s.bg, true)
  if (s.bold) out += `${ESC}[1m`
  if (s.dim) out += `${ESC}[2m`
  if (s.italic) out += `${ESC}[3m`
  if (s.underline) out += `${ESC}[4m`
  return out
}

// one Text's inline content, styles nested
function inline(node: Node, inherited: Style): string {
  // a string with newlines (the callout bar is one Text of bars) paints one row per line
  if (typeof node === 'string') return node.split('\n').map(line => open(inherited) + line + RESET).join('\n')
  const p = node.props
  const s: Style = {
    ...inherited,
    ...(typeof p.color === 'string' ? { fg: p.color } : {}),
    ...(typeof p.backgroundColor === 'string' ? { bg: p.backgroundColor } : {}),
    ...(p.bold || p.weight === 'bold' || p.weight === 'semibold' ? { bold: true } : {}),
    ...(p.dimColor ? { dim: true } : {}),
    ...(p.italic ? { italic: true } : {}),
    ...(p.underline ? { underline: true } : {}),
  }
  if (node.type === 'Button') return open({ ...s, dim: true }) + `[${String(p.label ?? '')}]` + RESET
  if (node.type === 'Raster') return open({ ...s, dim: true }) + `<clock>` + RESET
  if (node.type === 'Link') return open({ ...s, underline: true }) + (p.children ?? []).map(c => inline(c, s)).join('') + RESET
  return (p.children ?? []).map(c => inline(c, s)).join('')
}

// rows of a tree: a column Box stacks, a row Box joins; margins indent.
// `room` is the width the node may fill: the terminal less the margins and
// widths above it, so a `space-between` row can push its last child to its
// right edge (the duration lane, the dots line's buttons).
function rows(node: Node, inherited: Style = {}, room = COLUMNS): string[] {
  if (typeof node === 'string') return inline(node, inherited).split('\n')
  const p = node.props
  if (p.display === 'none') return []
  if (node.type !== 'Box') return inline(node, inherited).split('\n')
  const s: Style = { ...inherited, ...(typeof p.backgroundColor === 'string' ? { bg: p.backgroundColor } : {}) }
  const kids = p.children ?? []
  const left = typeof p.marginLeft === 'number' ? ' '.repeat(p.marginLeft) : ''
  const top = typeof p.marginTop === 'number' ? p.marginTop : 0
  const inner = typeof p.width === 'number' ? p.width : room - left.length - (typeof p.marginRight === 'number' ? p.marginRight : 0)
  let out: string[]
  if (p.flexDirection === 'row') {
    const parts = kids.map(k => rows(k, s, inner))
    const height = Math.max(1, ...parts.map(r => r.length))
    out = []
    // a child with flexGrow takes the room the others leave, so a right
    // lane (the duration) ends at the row's edge
    const grow = kids.findIndex(k => typeof k !== 'string' && typeof k.props.flexGrow === 'number' && k.props.flexGrow > 0)
    for (let i = 0; i < height; i++) {
      const cells = parts.map(r => r[i] ?? '')
      const used = cells.reduce((n, c) => n + visible(c), 0)
      const gap = ' '.repeat(Math.max(0, inner - used))
      if (p.justifyContent === 'space-between' && cells.length > 1) {
        out.push(cells.slice(0, -1).join('') + gap + cells[cells.length - 1])
      } else if (grow >= 0 && cells.length > 1) {
        out.push(cells.map((c, j) => (j === grow ? c + gap : c)).join(''))
      } else {
        out.push(cells.join(''))
      }
    }
  } else {
    out = kids.flatMap(k => rows(k, s, inner))
  }
  if (typeof p.width === 'number') {
    // a box with a width fills it; a tinted one paints the fill, as the terminal does
    out = out.map(r => r + (s.bg ? open({ bg: s.bg }) : '') + ' '.repeat(Math.max(0, p.width as number - visible(r))) + (s.bg ? RESET : ''))
  }
  return [...Array<string>(top).fill(''), ...out.map(r => left + r)]
}
function visible(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length
}

// ---- fixtures ------------------------------------------------------------------

const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
const t = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Link: el('Link'), Code: el('Code'), Markdown: el('Markdown'), Raster: el('Raster') }

const REPLY = [
  '## What changed',
  '',
  'The engine now exposes `$.ui.notify` and glass reads it. Run `claude plugin test .` to see the dumps.',
  '',
  '- one item with `code`',
  '- a second item',
  '',
  '```ts',
  'const n: number = fmt(42) // note',
  '```',
  '',
  '**Bottom line**',
  'Verified: the tree validates on the terminal.',
  'Issue: none.',
  'Fix: nothing to do.',
].join('\n')

// 0.5.2 polish: nested items under the parent's text, right-aligned numbers,
// air around a card under an item, a card and a table under a heading
const LISTS = [
  '## Steps',
  '',
  '```ts',
  'const n = 1',
  '```',
  '',
  '8. Install the deps:',
  '   ```',
  '   npm install',
  '   ```',
  '9. Check the tree',
  '   - a child under the text',
  '   - a second child',
  '10. Then open the file',
  '    - its child',
  '',
  '## Results',
  '',
  '| file | cost | p95 | rate |',
  '| --- | --- | --- | --- |',
  '| render.ts | $12 | 1.2s | 3GB |',
  '| width.ts | ' + String.fromCodePoint(0x2014) + ' | 340ms | 4.5MB/s |',
].join('\n')

// 0.5.3: quoted prose in meta; fences by language (Rust lifetimes, JSON and
// YAML keys, Python's range as a call)
const QUOTE_AND_FENCES = [
  'A quote, then fences:',
  '',
  '> The tree validates on the terminal, **every** row, and `cellWidth` agrees.',
  '> Second line of the quote.',
  '',
  '```rs',
  "fn first<'a>(xs: &'a [u8]) -> Option<&'a u8> { xs.first() }",
  '```',
  '',
  '```py',
  'for i in range(10): print(values[i])',
  '```',
  '',
  '```json',
  '{ "name": "glass", "version": "0.5.3", "ok": true }',
  '```',
  '',
  '```yaml',
  'palette: water',
  'files:',
  '  - path: hooks/chrome.ts',
  '```',
].join('\n')

const turn = {
  turnId: 'demo', durationMs: 146_000, tools: 4, edits: 1, failed: 1, inTokens: 1_800_000, cacheTokens: 1_620_000, outTokens: 5300,
  costUsd: 0.58, lastToolId: 't4', answer: 'done', startedAt: 0, finishedAt: 146_000,
}
const call = (id: string, tool: string, status: string, ms: number | null) => ({ id, tool, status, ms })
const row = (tool: string, input: unknown, failed = false, id = 't1') => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: failed, isInterrupted: false })

function fixtures(m: Mods): Record<string, () => Node | null> {
  const p = m.palette.PALETTES[PALETTE] ?? m.palette.PALETTES.tidepool!
  const c = m.chrome as unknown as Record<string, (...a: unknown[]) => Node>
  const columns = COLUMNS
  return {
    reply: () => m.render.renderReply(...([t, m.markdown.parseMarkdown(REPLY), p, { first: true, columns, marks: true }] as never[])),
    lists: () => m.render.renderReply(...([t, m.markdown.parseMarkdown(LISTS), p, { first: true, columns, marks: false }] as never[])),
    'quote-fences': () => m.render.renderReply(...([t, m.markdown.parseMarkdown(QUOTE_AND_FENCES), p, { first: true, columns, marks: false }] as never[])),
    // a Bash body shown whole against one that folds (the count only on the second)
    'bash-bodies': () =>
      t.Box({
        flexDirection: 'column',
        children: [
          c.renderTreeRow!(t, p, { ...row('Bash', { command: 'git status --short' }, false, 'b1'), output: { stdout: ' M a.ts\n M b.ts\n?? c.ts\n', stderr: '' } }, { durationMs: 400 }),
          c.renderTreeRow!(t, p, { ...row('Bash', { command: 'ls tests' }, false, 'b2'), output: { stdout: Array.from({ length: 12 }, (_, i) => `file-${i}.ts`).join('\n') + '\n', stderr: '' } }, { durationMs: 300 }),
          c.renderMessageRow!(t, p, 'Explore'),
        ],
      }),
    // every palette role in its own color, for the eye (colors only)
    palette: () =>
      t.Box({
        flexDirection: 'column',
        children: Object.entries(p).filter(([, v]) => typeof v === 'string' && /^#/.test(v)).map(([k, v]) =>
          t.Box({ flexDirection: 'row', children: [t.Text({ color: p.faint, children: [k.padEnd(12)] }), t.Text({ color: v, children: [`${v}  sample text 0.8s hooks/a.ts`] })] }),
        ),
      }),
    'event-rows': () =>
      t.Box({
        flexDirection: 'column',
        children: [
          c.renderEventRow!(t, p, 'm1', 'Agent "Hunt widths" finished\nFound 3 call sites.\nAll under hooks/.', { status: 'completed', durationMs: 72_000 }, true),
          c.renderGroupRow!(t, p, [{ tool: 'Read', input: { file_path: 'a.ts' }, isRunning: false, isErrored: false, isInterrupted: false }, { tool: 'Edit', input: { file_path: 'b.ts' }, isRunning: false, isErrored: false, isInterrupted: false }], { isActive: false, key: 'g2' }),
          ...(c.renderServerToolRows ? [c.renderServerToolRows(t, p, [{ id: 's1', name: 'advisor', startedAt: 1000, endedAt: 5200 }])] : []),
        ],
      }),
    summary: () => m.render.renderReply(...([t, m.markdown.parseMarkdown('Summary of the session so far: three files changed.'), p, { first: true, columns, marks: true, summary: true }] as never[])),
    'dots-line': () =>
      c.renderUserRow!(t, p, {
        text: 'add the notify option',
        submittedAt: 1_000_000,
        startedAt: 1_000_500,
        turn: { turnId: 'demo', calls: [call('t1', 'Read', 'ok', 300), call('t2', 'Bash', 'ok', 800), call('t3', 'Edit', 'failed', 120), call('t4', 'Bash', 'ok', 1200)], done: turn },
        columns,
        folded: false,
        onFold: () => undefined,
        onCopy: () => undefined,
      }),
    'tree-rows': () =>
      t.Box({
        flexDirection: 'column',
        children: [
          c.renderTreeRow!(t, p, row('Read', { file_path: 'hooks/register.ts' }), { durationMs: 300 }),
          c.renderTreeRow!(t, p, row('Bash', { command: 'git log --oneline -1' }, false, 't2'), { durationMs: 800 }),
          c.renderTreeRow!(t, p, row('Edit', { file_path: 'hooks/chrome.ts' }, true, 't3'), { durationMs: 120 }),
          c.renderGroupRow!(t, p, [{ tool: 'Read', input: { file_path: 'a.ts' }, isRunning: false, isErrored: false, isInterrupted: false }, { tool: 'Grep', input: { pattern: 'x' }, isRunning: false, isErrored: false, isInterrupted: false }], { isActive: false, key: 'g1' }),
        ],
      }),
    'diff-card': () =>
      c.renderDiff!(t, p, [{ oldStart: 268, newStart: 274, lines: ['  const right = x', '-  return t.Box({', '+  return spaced(t, p, t.Box({', '   key: 1'] }], { path: 'hooks/chrome.ts', columns }),
    'hint-modes': () =>
      t.Box({
        flexDirection: 'column',
        children: ['plan mode on', 'accept edits on', 'auto mode on', 'bypass permissions on'].map(rest => c.renderHint!(t, p, { vim: '-- INSERT --', rest })),
      }),
    band: () =>
      c.renderBand!(t, p, {
        agents: [
          { agentId: 'a1', description: 'Hunt widths', kind: 'Explore', model: 'claude-sonnet-5-5', effort: 'medium', stage: 'Grep', file: 'hooks/width.ts', tokens: 12_400, startedAt: 0 },
          { agentId: 'a2', description: 'Review the diff', kind: 'general-purpose', model: 'claude-opus-5-5', effort: 'high', stage: 'thinking' + m.glyphs.G.ellipsis, file: '', tokens: 900, startedAt: 30_000 },
        ],
        now: 85_000,
        columns,
        open: true,
        onToggle: null,
        tasksCommand: 'tasks',
      }),
    'server-tools': () =>
      c.renderServerToolRows
        ? c.renderServerToolRows(t, p, [
            { id: 's1', name: 'advisor', startedAt: 1000, endedAt: 5200 },
            { id: 's2', name: 'advisor', startedAt: 9000 },
          ])
        : null,
  }
}

async function load(dir: string): Promise<Mods | null> {
  if (!existsSync(join(dir, 'chrome.ts'))) return null
  const [chrome, render, markdown, palette, glyphs] = await Promise.all(['chrome', 'render', 'markdown', 'palette', 'glyphs'].map(f => import(join(dir, `${f}.ts`))))
  return { chrome, render, markdown, palette, glyphs } as Mods
}

const before = await load(BEFORE)
const after = await load(AFTER)
if (!after) throw new Error(`no hooks at ${AFTER}`)
if (!before) console.log(`${ESC}[2m(no before: ${BEFORE} not found; set GLASS_BEFORE)${RESET}\n`)

const title = (s: string) => `${ESC}[1m${s}${RESET}`
const dim = (s: string) => `${ESC}[2m${s}${RESET}`
// the changed-row mark: glass's own thin gutter glyph in the palette's meta
// step, so it sits with the palette instead of shouting over it
const markPalette = after.palette.PALETTES[PALETTE] ?? after.palette.PALETTES.tidepool!
const MARK = `${rgb(markPalette.meta ?? '#8e8ca1', false)}${String.fromCodePoint(0x258e)}${RESET} `
const SAME = '  '

console.log(dim(`palette ${PALETTE}, theme slots from ${THEME.name}, ${before ? BEFORE_LABEL : 'no before'}, ${COLUMNS} columns`))
console.log('')

function paint(mods: Mods | null, name: string): string[] | null {
  if (!mods) return null
  const make = fixtures(mods)[name]
  const tree = make ? make() : null
  return tree === null ? null : rows(tree)
}

const names = Object.keys(fixtures(after)).filter(n => want.length === 0 || want.some(w => n.includes(w)))
let identical = 0
for (const name of names) {
  const a = paint(before, name)
  const b = paint(after, name)
  const same = a !== null && b !== null && a.length === b.length && a.every((r, i) => r === b[i])
  if (same && !SHOW_ALL) {
    identical += 1
    console.log(title(`== ${name}`) + dim('  identical before and after'))
    continue
  }
  console.log(title(`== ${name}`) + (same ? dim('  identical before and after') : ''))
  console.log(dim('-- ' + BEFORE_LABEL))
  if (a === null) console.log(dim('   (nothing drawn)'))
  else for (const r of a) console.log(SAME + r)
  console.log(dim('-- after (working tree)' + (same ? '' : '   (marked rows differ)')))
  if (b === null) console.log(dim('   (nothing drawn)'))
  else b.forEach((r, i) => console.log((a && a[i] === r ? SAME : MARK) + r))
  console.log('')
}
if (identical > 0 && !SHOW_ALL) console.log(dim(`${identical} fixture${identical === 1 ? '' : 's'} unchanged by design; --all shows them too`))
