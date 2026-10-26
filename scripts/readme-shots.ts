// The README's palette screenshots: one demo turn per palette, painted by
// scripts/paint.ts into HTML and shot by headless Chrome.
//
//   bun scripts/readme-shots.ts                 docs/shots/<palette>.png, every palette
//   bun scripts/readme-shots.ts crimson water   only these
//   bun scripts/readme-shots.ts --html          keep the HTML beside each PNG
//   GLASS_EXTRA_PALETTES=/tmp/try.json bun scripts/readme-shots.ts try-a
//                                               a palette under design, from a
//                                               { name: Palette } JSON, not in hooks/
//
// The turn: a user row with its dots line, a Read, a Bash with its painted
// output, an Edit with its diff card, an Agent launch, a reply with prose,
// a TypeScript fence and a Bottom line card, then the background band with
// two agents. The ground is the owner's terminal (Ghostty night-owl,
// `#011627`, foreground `#94a4b6`) in JetBrains Mono Nerd Font; a light
// palette draws on GitHub Light (`#ffffff`, foreground `#1f2328`).
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { makePainter, rowToHtml } from './paint'
import type { Node } from './paint'
import * as chrome from '../hooks/chrome'
import { parseMarkdown } from '../hooks/markdown'
import { PALETTES } from '../hooks/palette'
import type { Palette } from '../hooks/palette'
import { renderReply } from '../hooks/render'
import { G } from '../hooks/glyphs'

const HERE = new URL('.', import.meta.url).pathname
const OUT = join(HERE, '..', 'docs', 'shots')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const COLUMNS = 100
const GROUNDS = { dark: ['#011627', '#94a4b6'], light: ['#ffffff', '#1f2328'] } as const
const FONT_PX = 14
const LINE_PX = 21
const PAD_X = 34
const PAD_Y = 28
const CELL_PX = 8.41 // JetBrains Mono at 14px

const argv = process.argv.slice(2)
const KEEP_HTML = argv.includes('--html')
const want = argv.filter(a => !a.startsWith('--'))

// the theme slots a palette's own theme resolves to: the diff card's tints
// and marks, the mode word, as under `/glass-theme`
function slotsFor(p: Palette): Record<string, string> {
  return {
    success: p.ok, error: p.err, warning: p.warn,
    planMode: p.cmd, autoAccept: p.ok, permission: p.tool,
    diffAdded: p.addBg, diffRemoved: p.delBg, diffAddedWord: p.addBg, diffRemovedWord: p.delBg,
  }
}

const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
const t = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Link: el('Link'), Code: el('Code'), Markdown: el('Markdown'), Raster: el('Raster') }
const c = chrome as unknown as Record<string, (...a: unknown[]) => Node>

// 10:43 on the day of the 0.10.0 release, local time
const AT = new Date(2026, 9, 16, 10, 43).getTime()

const REPLY = [
  '## What changed',
  '',
  'The band opens an agent with `$.ui.view({ agentId })`; the row in view reads `back`.',
  'Run `claude plugin test .` for the dumps; the guard sits in `hooks/register.ts:473`.',
  '',
  '```ts',
  "on('turn.start', async ($, e, next) => {",
  '  if (e.agentId) return next(e) // a subagent\'s turn',
  '  live.turnId = e.turnId',
  '  return next(e)',
  '})',
  '```',
  '',
  '- `view` and `back` are plain Buttons in a keyed Box',
  '- the file column gives up five cells for them',
  '',
  '**Bottom line**',
  'Verified: 87 tests pass on 2.1.301, the band draws live.',
  'Issue: Tab does not reach a band Button; it is click only.',
  'Fix: nothing to do; noted in DEMO.md.',
].join('\n')

const call = (id: string, tool: string, status: string, ms: number | null) => ({ id, tool, status, ms })
const row = (tool: string, input: unknown, id: string) => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false })

function demo(p: Palette): Node {
  const turn = {
    turnId: 'demo', durationMs: 84_000, tools: 4, edits: 1, failed: 0, inTokens: 1_200_000, cacheTokens: 1_020_000, outTokens: 3100,
    costUsd: 0.41, lastToolId: 't4', answer: 'done', startedAt: AT, finishedAt: AT + 84_000,
  }
  const header = c.renderUserRow!(t, p, {
    text: 'add a view button to the band, then check the turn.start guard',
    submittedAt: AT,
    startedAt: AT + 400,
    turn: { turnId: 'demo', calls: [call('t1', 'Read', 'ok', 300), call('t2', 'Bash', 'ok', 400), call('t3', 'Edit', 'ok', 800), call('t4', 'Agent', 'ok', 900)], done: turn },
    columns: COLUMNS,
    folded: false,
    onFold: () => undefined,
    onCopy: () => undefined,
  })
  const tree = t.Box({
    flexDirection: 'column',
    children: [
      c.renderTreeRow!(t, p, row('Read', { file_path: 'hooks/register.ts' }, 't1'), { durationMs: 300 }),
      c.renderTreeRow!(t, p, { ...row('Bash', { command: 'git status --short' }, 't2'), output: { stdout: ' M hooks/chrome.ts\n M hooks/register.ts\n?? tests/band.test.ts\n', stderr: '' } }, { durationMs: 400 }),
      c.renderToolOutput!(t, p, [' M hooks/chrome.ts', ' M hooks/register.ts', '?? tests/band.test.ts'], { columns: COLUMNS, maxLines: 3 }),
      c.renderTreeRow!(t, p, row('Edit', { file_path: 'hooks/chrome.ts' }, 't3'), { durationMs: 800 }),
      c.renderDiff!(t, p, [
        { oldStart: 948, newStart: 952, lines: ['  const modelText = `${shortModel(a.model)}`', '-  const cols = bandColumns(inner)', '+  const cols = bandColumns(inner, o.onView ? VIEW_CELLS : 0)', '+  const inView = o.viewing === a.agentId', '  const rows = shown.map(a => {'] },
      ], { path: 'hooks/chrome.ts', columns: COLUMNS }),
      c.renderTreeRow!(t, p, row('Agent', { description: 'Review the diff', subagent_type: 'general-purpose', prompt: 'Review the band change' }, 't4'), { durationMs: 900 }),
      c.renderAgentLaunch!(t, p, false),
    ],
  })
  const reply = renderReply(...([t, parseMarkdown(REPLY), p, { first: true, columns: COLUMNS, marks: true }] as never[]))
  return t.Box({ flexDirection: 'column', children: [header, tree, reply] })
}

function html(lines: string[], p: Palette): string {
  const [GROUND, FOREGROUND] = GROUNDS[p.ground ?? 'dark']
  const body = lines.map(l => rowToHtml(l, 0.55)).join('\n')
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: ${GROUND}; }
  .term {
    display: inline-block; box-sizing: border-box;
    width: ${Math.round(COLUMNS * CELL_PX + PAD_X * 2)}px;
    padding: ${PAD_Y}px ${PAD_X}px;
    background: ${GROUND}; color: ${FOREGROUND};
    font: ${FONT_PX}px/${LINE_PX}px "JetBrains Mono Nerd Font", "JetBrainsMono Nerd Font", "JetBrains Mono", monospace;
    font-variant-ligatures: none; white-space: pre; -webkit-font-smoothing: antialiased;
  }
</style>
<div class="term">${body}</div>
`
}

function shoot(name: string, p: Palette): void {
  const painter = makePainter({ columns: COLUMNS, slots: slotsFor(p), buttons: 'label' })
  const lines = painter.rows(demo(p)).map(l => l.replace(/\s+$/, ''))
  const page = join(OUT, `${name}.html`)
  const png = join(OUT, `${name}.png`)
  writeFileSync(page, html(lines, p))
  const width = Math.round(COLUMNS * CELL_PX + PAD_X * 2)
  const height = lines.length * LINE_PX + PAD_Y * 2
  const profile = `/tmp/glass-shots-profile-${process.pid}`
  const r = Bun.spawnSync([
    CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-extensions',
    `--user-data-dir=${profile}`, '--force-device-scale-factor=2',
    `--window-size=${width},${height}`, `--screenshot=${png}`, `file://${page}`,
  ], { stdout: 'ignore', stderr: 'pipe' })
  rmSync(profile, { recursive: true, force: true })
  if (!KEEP_HTML) rmSync(page, { force: true })
  if (r.exitCode !== 0 || !existsSync(png)) throw new Error(`chrome failed for ${name}: ${new TextDecoder().decode(r.stderr)}`)
  console.log(`${name}: ${lines.length} rows, ${width}x${height} -> docs/shots/${name}.png`)
}

mkdirSync(OUT, { recursive: true })
// palettes under design come from a JSON file beside the shipped ones
const extraFile = process.env.GLASS_EXTRA_PALETTES
const extra: Record<string, Palette> = extraFile ? (JSON.parse(readFileSync(extraFile, 'utf8')) as Record<string, Palette>) : {}
const all: Record<string, Palette> = { ...PALETTES, ...extra }
const names = Object.keys(all).filter(n => want.length === 0 || want.includes(n))
if (names.length === 0) throw new Error(`no palette named ${want.join(', ')}; have ${Object.keys(all).join(', ')}`)
for (const name of names) shoot(name, all[name]!)
