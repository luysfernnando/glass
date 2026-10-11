// Paints the DEMO.md fixtures in the terminal, before (the installed 0.4.25
// in the plugin cache) and after (this working tree), in real colors.
//
//   bun scripts/show.ts                     every fixture that differs
//   bun scripts/show.ts --all               identical fixtures too
//   bun scripts/show.ts diff-card hint      only fixtures whose name contains these
//   bun scripts/show.ts --theme rose-pine   resolve theme slots through that theme
//   bun scripts/show.ts --theme dark        ... or the stock dark defaults
//   GLASS_BEFORE=/path/to/old/hooks bun scripts/show.ts
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
const themeArg = argv.includes('--theme') ? argv[argv.indexOf('--theme') + 1] : undefined
const want = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--theme')

// ---- theme slots -----------------------------------------------------------

const DARK: Record<string, string> = {
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
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : SLOTS[color]
  if (!hex) return ''
  const n = parseInt(hex.slice(1), 16)
  return `${ESC}[${bg ? 48 : 38};2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`
}
const RESET = `${ESC}[0m`

type Style = { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }
function open(s: Style): string {
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
    ...(p.bold ? { bold: true } : {}),
    ...(p.dimColor ? { dim: true } : {}),
    ...(p.italic ? { italic: true } : {}),
    ...(p.underline ? { underline: true } : {}),
  }
  if (node.type === 'Button') return open({ ...s, dim: true }) + `[${String(p.label ?? '')}]` + RESET
  if (node.type === 'Raster') return open({ ...s, dim: true }) + `<clock>` + RESET
  if (node.type === 'Link') return open({ ...s, underline: true }) + (p.children ?? []).map(c => inline(c, s)).join('') + RESET
  return (p.children ?? []).map(c => inline(c, s)).join('')
}

// rows of a tree: a column Box stacks, a row Box joins; margins indent
function rows(node: Node, inherited: Style = {}): string[] {
  if (typeof node === 'string') return inline(node, inherited).split('\n')
  const p = node.props
  if (p.display === 'none') return []
  if (node.type !== 'Box') return inline(node, inherited).split('\n')
  const s: Style = { ...inherited, ...(typeof p.backgroundColor === 'string' ? { bg: p.backgroundColor } : {}) }
  const kids = p.children ?? []
  const left = typeof p.marginLeft === 'number' ? ' '.repeat(p.marginLeft) : ''
  const top = typeof p.marginTop === 'number' ? p.marginTop : 0
  let out: string[]
  if (p.flexDirection === 'row') {
    const parts = kids.map(k => rows(k, s))
    const height = Math.max(1, ...parts.map(r => r.length))
    out = []
    for (let i = 0; i < height; i++) out.push(parts.map(r => r[i] ?? '').join(''))
  } else {
    out = kids.flatMap(k => rows(k, s))
  }
  if (typeof p.width === 'number' && s.bg) {
    // a tinted box paints its whole width, as the terminal does
    out = out.map(r => r + open({ bg: s.bg }) + ' '.repeat(Math.max(0, p.width as number - visible(r))) + RESET)
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

console.log(dim(`palette ${PALETTE}, theme slots from ${THEME.name}, before ${before ? '0.4.25' : 'none'}`))
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
  console.log(dim('-- before 0.4.25'))
  if (a === null) console.log(dim('   (nothing drawn)'))
  else for (const r of a) console.log(SAME + r)
  console.log(dim('-- after 0.5.0' + (same ? '' : '   (marked rows differ)')))
  if (b === null) console.log(dim('   (nothing drawn)'))
  else b.forEach((r, i) => console.log((a && a[i] === r ? SAME : MARK) + r))
  console.log('')
}
if (identical > 0 && !SHOW_ALL) console.log(dim(`${identical} fixture${identical === 1 ? '' : 's'} unchanged by design; --all shows them too`))
