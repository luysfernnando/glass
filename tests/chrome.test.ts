import { expect, mock, test } from 'claude-code/testing'
import type { Elements, RenderElement, RenderNode } from 'claude-code'

import { CLOCK_CELLS, callRun, callScope, renderRunRow, editRunKeys, clockCells, renderAgentLaunch, fmtCost, fmtToolTime, renderBashResult, renderDiff, renderEventRow, renderGroupRow, renderMessageRow, renderToolOutput, renderTreeRow, renderUserRow, rel, safeText, setCwd, setHome, shortPath, clip, fmtDuration, renderServerToolRows, renderSkillLoad, toolLabel } from '../hooks/chrome'
import type { RunCall } from '../hooks/chrome'
import { G } from '../hooks/glyphs'
import { highlight, highlightLine, langOf } from '../hooks/highlight'
import { parseMarkdown } from '../hooks/markdown'
import { quoteRows, renderReply } from '../hooks/render'
import type { CodeSpan } from '../hooks/highlight'
import { PALETTES } from '../hooks/palette'
import { cellWidth, clipMiddle, clipPath } from '../hooks/width'

// the sandbox has timers; the engine's es2023 lib does not declare them
declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

const p = PALETTES.tidepool
const cp = (n: number) => String.fromCodePoint(n)

// a plain-data table: the renderers only build trees, so a test can walk
// them without a surface
const el = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as unknown as RenderElement
const t = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Link: el('Link'), Code: el('Code'), Markdown: el('Markdown') } as unknown as Elements['terminal']

// every string in a tree, in drawing order; a Button contributes its label
function strings(node: RenderNode): string[] {
  if (typeof node === 'string') return [node]
  const props = ((node as { props?: unknown }).props ?? {}) as { children?: RenderNode[]; label?: string }
  if (node.type === 'Button') return [props.label ?? '']
  return (props.children ?? []).flatMap(strings)
}
const flat = (node: RenderNode) => strings(node).join('')
// the rows of a column box, each flattened
const lines = (node: RenderElement) => (((node as { props?: { children?: RenderNode[] } }).props?.children ?? []) as RenderNode[]).map(flat)

test('the new glyphs are one cell each', async () => {
  for (const g of [G.tee, G.pipe, G.tick, G.cross, G.hollow, G.fisheye, G.diamond, G.right, G.down, G.arcTL, G.arcTR, G.arcBL, G.arcBR, G.disc, G.times, G.middot, G.ellipsis]) {
    expect(cellWidth(g)).toBe(1)
  }
})

test('formats: tool times in tenths under ten seconds, costs by Empryo rule, text bounded', async () => {
  expect(fmtToolTime(800)).toBe('0.8s')
  expect(fmtToolTime(9000)).toBe('9.0s')
  expect(fmtToolTime(10_000)).toBe('10s')
  expect(fmtToolTime(64_000)).toBe('1m 04s')
  expect(fmtCost(0.0042)).toBe('$0.004')
  expect(fmtCost(0.58)).toBe('$0.58')
  expect(safeText('a\x1b[31mb\r\nc')).toBe('a[31mb\nc')
  expect(safeText('x'.repeat(20), 10).length).toBe(10)
})

const turn = {
  turnId: 'x', durationMs: 146_000, tools: 17, edits: 3, failed: 2, inTokens: 1_800_000, cacheTokens: 1_620_000, outTokens: 5300,
  costUsd: 0.58, lastToolId: 't9', answer: 'done', startedAt: 0, finishedAt: 146_000,
}

test('a user row: its time, then the assistant header and the dots line once the turn runs', async () => {
  const before = flat(renderUserRow(t, p, { text: 'hello', submittedAt: null, startedAt: null, turn: null, columns: 80 }))
  // one titled rule: the name, then the rule out to the measure
  expect(before.startsWith(G.diamond + ' You ' + G.rule)).toBe(true)
  expect(cellWidth(before.split('hello')[0]!)).toBe(78)
  expect(before).toContain('hello')
  expect(before).not.toContain('Claude')
  const calls = [
    { id: 'a', tool: 'Bash', status: 'ok' as const, ms: 800 },
    { id: 'b', tool: 'Bash', status: 'failed' as const, ms: 50 },
    { id: 'c', tool: 'Read', status: 'running' as const, ms: null },
  ]
  // live: the counts by tool, no chevron, no Copy
  const liveRow = flat(renderUserRow(t, p, { text: 'hello', submittedAt: 0, startedAt: 60_000, turn: { turnId: 'x', calls, done: null }, columns: 80 }))
  expect(liveRow).toContain(G.fisheye + ' Claude')
  expect(liveRow).toContain(G.disc + G.cross + ' ' + G.hollow)
  expect(liveRow).toContain('1 failed')
  expect(liveRow).toContain('Bash ' + G.times + '2')
  expect(liveRow).not.toContain(G.down)
  expect(liveRow).not.toContain(G.right)
  expect(liveRow).not.toContain('Copy')
  // done: the totals, still no Copy
  const unfolded = flat(renderUserRow(t, p, { text: 'hello', submittedAt: 0, startedAt: 60_000, turn: { turnId: 'x', calls, done: turn }, columns: 80 }))
  expect(unfolded).not.toContain('Copy')
  expect(unfolded).toContain('17 actions')
  expect(unfolded).toContain('3 edits')
  expect(unfolded).toContain('2 failed')
})

test('a tree row: hollow mark while live, tick and line count once done, the tee on every row', async () => {
  const base = { tool_use_id: 't1', tool: 'Bash', input: { command: 'git status' }, isErrored: false, isInterrupted: false }
  const live = flat(renderTreeRow(t, p, { ...base, isRunning: true }, { last: false, durationMs: null }))
  expect(live.startsWith(G.tee + G.rule + ' ' + G.hollow + ' Bash')).toBe(true)
  expect(live).toContain('git status')
  expect(live).not.toContain('lines')
  const done = flat(renderTreeRow(t, p, { ...base, isRunning: false, output: { stdout: 'a\nb\nc\nd\n', stderr: '' } }, { last: true, durationMs: 800 }))
  expect(done.startsWith(G.arcBL + G.rule + ' ' + G.tick + ' Bash')).toBe(true)
  expect(done).toContain('4 lines')
  expect(done.endsWith('0.8s')).toBe(true)
  // a body the row shows whole is its own count (0.5.3)
  const short = flat(renderTreeRow(t, p, { ...base, isRunning: false, output: { stdout: 'a\nb\nc\n', stderr: '' } }, { last: false, durationMs: 800 }))
  expect(short).not.toContain('lines')
  // a done Bash row keeps its command's token colors
  const doneTree = JSON.stringify(renderTreeRow(t, p, { ...base, isRunning: false }, { last: false, durationMs: 800 }))
  expect(doneTree).toContain(JSON.stringify({ type: 'Text', props: { color: p.cmd, children: ['git'] } }))
  const failed = flat(renderTreeRow(t, p, { ...base, isRunning: false, isErrored: true }, { last: false, durationMs: 50 }))
  expect(failed).toContain(G.cross + ' Bash')
})

test('a folded group: one line per tool, a command by its description, edits by their lines, failures', async () => {
  const calls = [
    { tool: 'Bash', input: { command: 'T=/tmp/x; grep -n foo $T', description: 'Find foo' }, isRunning: false, isErrored: false, isInterrupted: false },
    { tool: 'Edit', input: { file_path: 'a.ts' }, output: { structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['-a', '+b', '+c'] }] }, isRunning: false, isErrored: false, isInterrupted: false },
    { tool: 'Bash', input: { command: 'ls nope' }, isRunning: false, isErrored: true, isInterrupted: false },
  ]
  const folded = flat(renderGroupRow(t, p, calls, { isActive: false, key: 'expand:g1', onExpand: () => {} }))
  expect(folded).toContain('Bash ' + G.times + '2  Find foo ' + G.middot + ' ls nope ' + G.middot + ' 1 failed')
  expect(folded).not.toContain('T=/tmp/x')
  expect(folded).toContain('Edit  a.ts  +2 -1')
  expect(folded).not.toContain('ctrl+o to expand')
  expect(folded).not.toContain('Click')
  const active = flat(renderGroupRow(t, p, [...calls, { tool: 'Read', isRunning: true, isErrored: false, isInterrupted: false }], { isActive: true, key: null, onExpand: null }))
  expect(active).toContain(G.middot + ' running' + G.ellipsis)
  expect(active).not.toContain('Click')
})

test('an event row: a tick and the first line, a cross on a failed task, the duration at the right', async () => {
  const ok = flat(renderEventRow(t, p, 'm1', 'Agent "Hunt widths" finished\nmore detail', { status: 'completed', durationMs: 72_000 }))
  expect(ok.startsWith(G.tee + G.rule + ' ' + G.tick + ' Agent  Hunt widths')).toBe(true)
  expect(ok).not.toContain('more detail')
  expect(ok.endsWith('1m 12s')).toBe(true)
  const bad = flat(renderEventRow(t, p, 'm2', 'Agent died', { status: 'failed' }))
  expect(bad).toContain(G.cross + ' Agent died')
  expect(bad.endsWith('Agent died')).toBe(true)
  // expanded, the body follows the row
  const full = flat(renderEventRow(t, p, 'm3', 'Agent finished\nthe report\nsecond line', { status: 'completed' }, true))
  expect(full).toContain('the report')
  // the body hangs off the trunk: a pipe per line, as a Bash body does
  expect(full).toContain(G.pipe + '\n' + G.pipe + 'the report' + 'second line')
  const msg = flat(renderMessageRow(t, p, 'Explore'))
  expect(msg.startsWith(G.tee + G.rule + ' ' + G.ring + ' Message from @Explore')).toBe(true)
  // no key hint at the right (0.5.3)
  expect(msg.endsWith('@Explore')).toBe(true)
  expect(msg).not.toContain('ctrl+o')
})

test('painted Bash output: the connector, then each line with its words in their colors', async () => {
  const out = renderToolOutput(t, p, ['M hooks/render.ts', '14 passed, 0 failed', 'third', 'fourth'], { columns: 80, maxLines: 3 })
  const text = flat(out)
  expect(text.startsWith(G.pipe + 'M hooks/render.ts')).toBe(true)
  expect(text).toContain(G.pipe + 'third')
  expect(text).not.toContain('fourth')
  expect(text).toContain(G.pipe + G.ellipsis + ' +1 line')
  expect(text).toContain('M hooks/render.ts')
  expect(text).toContain('14 passed, 0 failed')
  // the path and the status words carry their palette colors
  const colors: string[] = []
  const walk = (n: RenderNode) => {
    if (typeof n === 'string') return
    const props = ((n as { props?: unknown }).props ?? {}) as { color?: string; children?: RenderNode[] }
    if (props.color) colors.push(props.color)
    ;(props.children ?? []).forEach(walk)
  }
  walk(out)
  expect(colors).toContain(p.path)
  expect(colors).toContain(p.ok)
  expect(colors).toContain(p.err)
})

// the trees go through the engine's validator: a refused tree would fall
// back to the engine's own drawing in a session
test('mounted: a user row, a tree row, a folded group validate on the terminal', async $ => {
  const user = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'spawn the hunters', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect(await user.find({ type: 'Text', text: /You/ })).toBeDefined()
  await user.unmount()

  const row = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: 'toolu_1', tool: 'Bash', input: { command: 'ls -la' }, isRunning: false, isErrored: false, isInterrupted: false, output: { stdout: 'a\nb\nc\nd\ne\n', stderr: '' } },
  })
  expect(await row.find({ type: 'Text', text: /^Bash$/ })).toBeDefined()
  // the count draws once the body folds past the painted lines (0.5.3)
  expect(await row.find({ type: 'Text', text: /5 lines/ })).toBeDefined()
  await row.unmount()

  const group = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolGroup',
    props: {
      calls: [
        { tool_use_id: 'toolu_2', tool: 'Read', input: { file_path: 'a.ts' }, isRunning: false, isErrored: false, isInterrupted: false },
        { tool_use_id: 'toolu_3', tool: 'Grep', input: { pattern: 'x' }, isRunning: false, isErrored: false, isInterrupted: false },
      ],
      isActive: false,
      isExpanded: false,
    },
  })
  // reads and searches by count alone: no path, no pattern
  expect(await group.find({ type: 'Text', text: /^Read$/ })).toBeDefined()
  expect(await group.find({ type: 'Text', text: /a\.ts/ })).toBeUndefined()
  await group.unmount()

  // a task's notification and another agent's message: both rows carry a
  // hover, so both need a key or the validator refuses them
  const event = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'Agent "Hunt widths" finished', origin: { kind: 'task-notification' }, isExpanded: true, task: { status: 'completed', durationMs: 9000 } },
  })
  expect(await event.find({ type: 'Text', text: /Hunt widths/ })).toBeDefined()
  expect(await event.find({ type: 'Text', text: /9\.0s/ })).toBeDefined()
  await event.unmount()

  // folded, a task that went fine draws nothing (its call's row says it);
  // a failed one keeps its row
  const notice = (status: string) => $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'Agent "Hunt widths" finished', origin: { kind: 'task-notification' }, isExpanded: false, task: { status, durationMs: 9000 } },
  })
  const done = await notice('completed')
  expect(await done.find({ type: 'Text', text: /Hunt widths/ })).toBeUndefined()
  await done.unmount()
  const failed = await notice('failed')
  expect(await failed.find({ type: 'Text', text: /Hunt widths/ })).toBeDefined()
  await failed.unmount()

  const message = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'the report body', origin: { kind: 'peer' }, isExpanded: false, from: { name: 'Explore' } },
  })
  expect(await message.find({ type: 'Text', text: /Message from @Explore/ })).toBeDefined()
  await message.unmount()
})

test('an Edit diff: one number column, a plus row and a minus row in the theme diff slots, code painted', async () => {
  const hunks = [
    { oldStart: 268, newStart: 274, lines: ['  const right = x', '-  return t.Box({', '+  return spaced(t, p, t.Box({', '   key: 1'] },
    { oldStart: 288, newStart: 294, lines: ['-  })', '+  }))'] },
  ]
  const out = renderDiff(t, p, hunks, { path: 'hooks/chrome.ts', columns: 120 })
  const text = flat(out)
  expect(text).toContain('274    const right = x')
  expect(text).toContain('269 -   return t.Box({')
  expect(text).toContain('275 +   return spaced(t, p, t.Box({')
  expect(text).toContain('276     key: 1')
  expect(text).toContain(G.ellipsis)
  expect(text).toContain('288 -   })')
  expect(text).toContain('294 +   }))')
  const colors: string[] = []
  const bgs: string[] = []
  const walk = (n: RenderNode) => {
    if (typeof n === 'string') return
    const props = ((n as { props?: unknown }).props ?? {}) as { color?: string; backgroundColor?: string; borderStyle?: string; children?: RenderNode[] }
    if (props.color) colors.push(props.color)
    if (props.backgroundColor) bgs.push(props.backgroundColor)
    ;(props.children ?? []).forEach(walk)
  }
  walk(out)
  const card = out as { props: { borderStyle?: string; marginLeft?: number } }
  // glass draws the frame: the file in the top border, two edges on every row
  expect(card.props.borderStyle).toBeUndefined()
  const rows = lines(out)
  expect(rows[0]!.startsWith(G.arcTL + G.rule + ' hooks/chrome.ts +2 -2 ' + G.rule)).toBe(true)
  expect(rows[rows.length - 1]!.startsWith(G.arcBL)).toBe(true)
  const w = cellWidth(rows[0]!)
  for (const r of rows) expect(cellWidth(r)).toBe(w)
  for (const r of rows.slice(1, -1)) expect(r.startsWith(G.pipe) && r.endsWith(G.pipe)).toBe(true)
  // a line wider than the card breaks into rows glass counts, each framed
  const long = lines(renderDiff(t, p, [{ oldStart: 1, newStart: 1, lines: ['+' + 'x'.repeat(150)] }], { path: 'a.ts', columns: 80 }))
  expect(long.length).toBe(2 + 3)
  for (const r of long) expect(cellWidth(r)).toBe(76)
  // the frame sits on the trunk column, so its left border is the trunk
  expect(card.props.marginLeft).toBe(2)
  // 0.5.0: the marks and tints name the active theme's diff slots, so the
  // card follows the theme as the engine's own panels do
  // 0.5.3: the marks take success and error; the Word slots are the engine's word backgrounds
  expect(colors).toContain('success')
  expect(colors).toContain('error')
  expect(colors).not.toContain('diffAddedWord')
  expect(colors).toContain(p.codeKw)
  expect(bgs).toContain('diffAdded')
  expect(bgs).toContain('diffRemoved')
  expect(bgs).not.toContain(p.addBg)
})

test('the highlighter: keywords, calls, types, strings, numbers, comments, a block comment carried across lines', async () => {
  const [a, b, c] = highlight('const n: number = fmt(42) // note\n/* open\nclose */ "s"', 'ts')
  const kinds = (spans: CodeSpan[]) => spans.filter(s => s.kind !== 'plain').map(s => `${s.kind}:${s.text}`)
  expect(kinds(a!)).toEqual(['kw:const', 'type:number', 'fn:fmt', 'num:42', 'comment:// note'])
  expect(kinds(b!)).toEqual(['comment:/* open'])
  expect(kinds(c!)).toEqual(['comment:close */', 'str:"s"'])
  // python comments open on a hash; a dotted member is never a keyword
  expect(kinds(highlight('x.type = 1 # done', 'py')[0]!)).toEqual(['num:1', 'comment:# done'])
  expect(langOf('/a/b/hooks/chrome.test.ts')).toBe('ts')
  expect(langOf('Makefile')).toBe('makefile')
  // prose files are English: a markdown diff paints nothing
  expect(kinds(highlight("The contract for Claude Code's transcript.", 'md')[0]!)).toEqual([])
  expect(highlight('## Global', 'md')[0]).toEqual([{ text: '## Global', kind: 'plain' }])
  expect(highlight('', 'md')[0]).toEqual([])
})

test('a Bash result that rewrote files: the body folded past the painted lines, then a header and a card per file', async () => {
  const files = [
    { filePath: '/x/hooks/a.ts', hunks: [{ oldStart: 1, newStart: 1, lines: [' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4'] }] },
    { filePath: '/x/README.md', hunks: [], created: true as const },
  ]
  const out = renderBashResult(t, p, ['ok', 'two', 'three', 'four', 'five'], files, { maxLines: 3, moreFiles: 2, columns: 120 })
  const text = flat(out)
  expect(text.startsWith(G.pipe + 'ok')).toBe(true)
  expect(text).toContain('three')
  expect(text).not.toContain('four')
  expect(text).toContain(G.ellipsis + ' +2 lines')
  expect(text).not.toContain('Updated')
  expect(text).toContain(G.arcTL + G.rule + ' /x/hooks/a.ts +2 -1 ' + G.rule)
  expect(text).toContain('2 - const b = 2')
  expect(text).toContain('2 + const b = 3')
  expect(text).toContain('Created /x/README.md')
  expect(text).toContain(G.ellipsis + ' +2 more files')
})

test('0.4.1: no air inside a run, no time under a tenth, one row per output line, the agent launch line, a Bash group names its command', async () => {
  const base = { tool_use_id: 't1', tool: 'Read', input: { file_path: 'a.ts' }, isRunning: false, isErrored: false, isInterrupted: false }
  const tight = flat(renderTreeRow(t, p, base, { last: false, durationMs: 40, air: false }))
  expect(tight.startsWith(G.tee)).toBe(true)
  expect(tight).not.toContain('0.0s')
  expect(flat(renderTreeRow(t, p, base, { last: false, durationMs: 300 })).startsWith(G.tee)).toBe(true)
  const body = renderToolOutput(t, p, ['x'.repeat(300), 'b'], { columns: 80, maxLines: 3 })
  expect(lines(body).length).toBe(2)
  expect(flat(renderAgentLaunch(t, p, false))).toContain('running in the background')
  // 0.4.25: a loaded skill's body sits on the trunk, with the engine's extras
  expect(strings(renderSkillLoad(t, p, {})).join('')).toBe(G.pipe + 'skill loaded')
  expect(flat(renderSkillLoad(t, p, { allowedTools: ['Read', 'Grep'], model: 'sonnet' }))).toContain('skill loaded ' + G.middot + ' 2 tools allowed ' + G.middot + ' sonnet')
  expect(flat(renderSkillLoad(t, p, { status: 'forked', background: true }))).toContain('running in the background')
  const group = flat(renderGroupRow(t, p, [{ tool: 'Bash', input: { command: 'git status --short' }, isRunning: false, isErrored: false, isInterrupted: false }], { isActive: false, key: null, onExpand: null }))
  expect(group).toContain('git status --short')
})

test('0.4.2: the clock cells decode to the elapsed time, a running row carries the Raster, a dot and its row share a hover scope', async () => {
  const cells = clockCells(64_000, '#8e8ca1')
  const bin = atob(cells)
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  expect(words.length).toBe(CLOCK_CELLS * 3)
  expect(Array.from({ length: CLOCK_CELLS }, (_, i) => String.fromCharCode(words[i * 3]!)).join('')).toBe(' 1m 04s')
  expect(words[1]).toBe(0x8e8ca1)
  expect(words[2]).toBe(0x01000000)
  const tr = { ...t, Raster: el('Raster') } as unknown as Elements['terminal']
  const running = renderTreeRow(tr, p, { tool_use_id: 'toolu_x', tool: 'Bash', input: { command: 'sleep 9' }, isRunning: true, isErrored: false, isInterrupted: false }, { last: false, durationMs: null, clock: cells })
  const found: { type: string; props: Record<string, unknown> }[] = []
  const walk = (n: RenderNode) => {
    if (typeof n === 'string') return
    found.push(n as never)
    ;(((n as { props?: { children?: RenderNode[] } }).props?.children) ?? []).forEach(walk)
  }
  walk(running)
  expect(found.some(n => n.type === 'Raster' && n.props.columns === CLOCK_CELLS && n.props.key === 'clock')).toBe(true)
  expect(found.some(n => n.type === 'Box' && (n.props.hover as { scope?: string } | undefined)?.scope === callScope('toolu_x'))).toBe(true)
  const row = renderUserRow(t, p, { text: 'hi', submittedAt: 0, startedAt: 0, turn: { turnId: 'x', calls: [{ id: 'toolu_x', tool: 'Bash', status: 'running', ms: null }], done: null }, columns: 80 })
  const dots: { type: string; props: Record<string, unknown> }[] = []
  const walk2 = (n: RenderNode) => {
    if (typeof n === 'string') return
    dots.push(n as never)
    ;(((n as { props?: { children?: RenderNode[] } }).props?.children) ?? []).forEach(walk2)
  }
  walk2(row)
  expect(dots.some(n => n.type === 'Text' && (n.props.hover as { scope?: string } | undefined)?.scope === callScope('toolu_x'))).toBe(true)
})

test('mounted live: a running row with its Raster clock validates, and the ticker blits it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  // the world beneath glass: note the call's id, hold the call open
  let id = ''
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  on('tool.call', async (_$, e) => {
    id = e.tool_use_id
    await held
    return { isError: false, result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  const running = Promise.resolve($.tool.call({ tool: 'Bash', command: 'sleep 2' } as never)).catch((err: unknown) => err)
  for (let i = 0; i < 50 && id === ''; i++) await new Promise(resolve => setTimeout(resolve, 10))
  expect(id).not.toBe('')
  const row = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: id, tool: 'Bash', input: { command: 'sleep 2' }, isRunning: true, isErrored: false, isInterrupted: false },
  })
  expect(await row.find({ type: 'Raster' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /Bash/ })).toBeDefined()
  // three ticks: each blits the mounted clock; the row stays glass's
  await clock.advance(3000)
  expect(await row.find({ type: 'Raster' })).toBeDefined()
  await row.unmount()
  release()
  await running
})

// a ten-row box-drawing flow, the shape Claude draws in a bare fence
const boxDiagram = (() => {
  const h = cp(0x2500), v = cp(0x2502), down = cp(0x25bc)
  const box = (label: string) => [
    cp(0x250c) + h.repeat(10) + cp(0x2510),
    v + label.padEnd(10) + v,
    cp(0x2514) + h.repeat(10) + cp(0x2518),
  ]
  return [...box(' order'), '     ' + down, ...box(' payment'), '     ' + down, ...box(' settle')]
})()

// the tinted card a fence draws, found anywhere in a reply tree
function fenceCard(node: RenderNode): RenderElement | undefined {
  if (typeof node === 'string' || !node) return undefined
  const props = ((node as { props?: unknown }).props ?? {}) as { backgroundColor?: string; children?: RenderNode[] }
  if (props.backgroundColor === p.blockBg) return node as RenderElement
  for (const child of props.children ?? []) {
    const hit = fenceCard(child)
    if (hit) return hit
  }
  return undefined
}

const reply = (md: string, columns = 100) => renderReply(t, parseMarkdown(md), p, { columns, marks: false })

// every element in a tree, depth first
function elements(node: RenderNode): { type: string; props: Record<string, unknown> }[] {
  if (typeof node === 'string' || !node) return []
  const n = node as unknown as { type: string; props: Record<string, unknown> }
  return [n, ...((n.props.children ?? []) as RenderNode[]).flatMap(elements)]
}
// the table a one-table reply draws: reply box, block box, table
const tableOf = (md: string, columns = 100) => {
  const block = (reply(md, columns) as unknown as { props: { children: RenderElement[] } }).props.children[0]!
  return (block as unknown as { props: { children: RenderElement[] } }).props.children[0]!
}

test('a box-drawing diagram over eight lines draws as itself: no header row, no line numbers', async () => {
  const card = fenceCard(reply('```\n' + boxDiagram.join('\n') + '\n```'))!
  expect(boxDiagram.length).toBeGreaterThan(8)
  expect(lines(card)).toEqual(boxDiagram)
})

test('a diagram row wider than the card truncates instead of wrapping', async () => {
  const wide = cp(0x250c) + cp(0x2500).repeat(70) + cp(0x2510)
  const card = fenceCard(reply('```\n' + wide + '\n' + cp(0x2502) + '\n```', 40))!
  const rows = ((card as unknown as { props: { children: RenderElement[] } }).props.children)
  for (const row of rows) expect((row as { props: { wrap?: string } }).props.wrap).toBe('truncate-end')
})

test('code over eight lines keeps its header and numbered gutter', async () => {
  const code = Array.from({ length: 10 }, (_, i) => `const a${i} = ${i}`)
  const rows = lines(fenceCard(reply('```ts\n' + code.join('\n') + '\n```'))!)
  expect(rows[0]).toBe('TS10 lines')
  expect(rows[1]).toBe(' 1  const a0 = 0')
})

test('a quoted diagram is as tall as its rows: no header row is counted', async () => {
  const blocks = parseMarkdown('> ```\n' + boxDiagram.map(l => '> ' + l).join('\n') + '\n> ```')
  if (blocks[0]?.kind !== 'quote') throw new Error('expected a quote')
  expect(quoteRows(blocks[0].blocks, 60)).toBe(boxDiagram.length)
})

test('a plain-text fence of prose with one arrow is still text, gutter and all', async () => {
  const prose = Array.from({ length: 10 }, (_, i) => `step ${i} of the runbook`)
  prose[3] = 'then ' + cp(0x2192) + ' retry'
  const rows = lines(fenceCard(reply('```text\n' + prose.join('\n') + '\n```'))!)
  expect(rows[0]).toBe('TEXT10 lines')
})

test('a quoted short fence with a language is as tall as its code: short fences draw no header', async () => {
  const blocks = parseMarkdown('> ```ts\n> const a = 1\n> const b = 2\n> ```')
  if (blocks[0]?.kind !== 'quote') throw new Error('expected a quote')
  expect(quoteRows(blocks[0].blocks, 60)).toBe(2)
})

// a fence drew as a diagram when its rows are cut, not wrapped
const drawnAsDiagram = (lang: string, rows: string[]) => {
  const card = fenceCard(reply('```' + lang + '\n' + rows.join('\n') + '\n```'))!
  return JSON.stringify(card).includes('"truncate-end"')
}

test('plain ASCII diagrams draw as typed: boxes, arrows, trees', async () => {
  expect(drawnAsDiagram('', ['+-------+     +---------+', '| Order | --> | Payment |', '+-------+     +---------+', '    |', '    v', '+--------+', '| Settle |', '+--------+'])).toBe(true)
  expect(drawnAsDiagram('text', ['client ==> api', 'api --> db', 'db <-- cache'])).toBe(true)
  expect(drawnAsDiagram('', ['.', '|-- hooks', '|   |-- render.ts', '|   `-- chrome.ts', '`-- tests'])).toBe(true)
})

test('code, prose and shell output in a bare fence stay code', async () => {
  // one-dash arrows are code's
  expect(drawnAsDiagram('', ['const f = (a) => a + 1', 'p->next = q', 'const g = () => f(2)'])).toBe(false)
  // a pipe in prose, and flags with two dashes
  expect(drawnAsDiagram('', ['cat a.log | grep error', 'git push --force-with-lease', 'npm test -- --watch'])).toBe(false)
  // a diffstat: plus runs then minus runs are not box corners
  expect(drawnAsDiagram('', [' hooks/render.ts     | 57 +++++++++++++++++++++-----', ' tests/parse.test.ts | 24 ++++++++++', ' 2 files changed, 64 insertions(+), 17 deletions(-)'])).toBe(false)
  // a rust error: an arrow and gutter bars, but under half its rows
  expect(drawnAsDiagram('', ['error[E0308]: mismatched types', ' --> src/main.rs:4:18', '  |', '4 |     let x: i32 = "a";', '  |            ---   ^^^ expected `i32`', '  |            |', '  |            expected due to this'])).toBe(false)
})


test('rel: a path in the project is relative, a session temp path keeps what is under the session, a home path gets ~', () => {
  setCwd('/home/u/proj')
  setHome('/home/u')
  expect(rel('/home/u/proj/src/a.ts')).toBe('src/a.ts')
  expect(rel('/tmp/claude-1000/-home-u-proj/cc0711e5-7281-4d3a-88c9-4e042e1edbe0/scratchpad/t.py')).toBe('…/scratchpad/t.py')
  expect(rel('/home/u/.claude/settings.json')).toBe('~/.claude/settings.json')
  expect(rel('/etc/hosts')).toBe('/etc/hosts')
  setCwd('')
  setHome('')
})

test('rel: a Windows path matches the cwd and a Git Bash HOME', () => {
  setCwd('C:\\Users\\u\\proj')
  setHome('/c/Users/u')
  expect(rel('C:\\Users\\u\\proj\\src\\a.ts')).toBe('src/a.ts')
  expect(rel('c:/Users/u/proj/src/a.ts')).toBe('src/a.ts')
  expect(rel('C:\\Users\\u\\.claude\\settings.json')).toBe('~/.claude/settings.json')
  expect(rel('C:\\Users\\u\\AppData\\Local\\Temp\\claude\\C--proj\\2f83c9bc-51ba-44fb-bfd5-5222bf9471f8\\scratchpad\\t.py')).toBe('…/scratchpad/t.py')
  expect(rel('D:\\other\\x.ts')).toBe('D:\\other\\x.ts')
  setCwd('')
  setHome('')
})

test('shortPath: a long path keeps its last two parts, a short one stays', () => {
  setCwd('C:\\Users\\u\\proj')
  expect(shortPath('C:\\Users\\u\\proj\\src\\a.ts')).toBe('src/a.ts')
  expect(shortPath('C:\\Users\\u\\proj\\modules\\agents\\claude\\mods\\agent-hud\\hooks\\register.tsx')).toBe('…/hooks/register.tsx')
  setCwd('')
})

test('edit runs: back-to-back edits join, text or another tool between splits, a file joins across', () => {
  const order = [
    { id: 'a', tool: 'Write', afterText: false },
    { id: 'b', tool: 'Edit', afterText: false },
    { id: 'c', tool: 'Bash', afterText: false },
    { id: 'd', tool: 'Edit', afterText: false },
    { id: 'e', tool: 'Edit', afterText: true },
    { id: 'f', tool: 'Edit', afterText: false },
  ]
  const edits = [
    { id: 'a', key: 'a', file: '/r/x.ts' },
    { id: 'b', key: 'b', file: '/r/y.ts' },
    { id: 'd', key: 'd', file: '/r/z.ts' },
    { id: 'e', key: 'e', file: '/r/w.ts' },
    { id: 'f', key: 'f', file: '/r/v.ts' },
  ]
  expect(editRunKeys(edits, order, 'a')).toEqual(['a', 'b'])
  expect(editRunKeys(edits, order, 'd')).toEqual(['d'])
  expect(editRunKeys(edits, order, 'e')).toEqual(['e', 'f'])
  // a Bash edit of x.ts joins x.ts's run, and through it the streak
  const withBash = [...edits, { id: 'c', key: 'c:/r/x.ts', file: '/r/x.ts' }]
  expect(editRunKeys(withBash, order, 'c:/r/x.ts')).toEqual(['a', 'b', 'c:/r/x.ts'])
  expect(editRunKeys(edits, order, 'nope')).toEqual([])
})

test('a run of calls: one row with every call, the subject of the one running, a cross when one failed', () => {
  const order = [
    { id: 'a', afterText: true },
    { id: 'b', afterText: false },
    { id: 'c', afterText: false },
    { id: 'd', afterText: true },
  ]
  expect(callRun(order, 'b').map(c => c.id)).toEqual(['a', 'b', 'c'])
  expect(callRun(order, 'd').map(c => c.id)).toEqual(['d'])
  expect(callRun(order, 'x')).toEqual([])
  const calls: RunCall[] = [
    { id: 'a', tool: 'Bash', subject: 'List files', status: 'ok' },
    { id: 'b', tool: 'Bash', subject: 'Run tests', status: 'running' },
    { id: 'c', tool: 'Edit', subject: 'a.ts', status: 'ok' },
  ]
  const o = { key: 'run:a', isOpen: false, last: false, lines: { add: 3, del: 1 }, durationMs: null, onToggle: () => {} }
  const live = flat(renderRunRow(t, p, calls, o))
  expect(live.startsWith(G.tee + G.rule + ' ' + G.hollow)).toBe(true)
  expect(live).toContain(`Bash ${G.times}2 ${G.middot} Edit  Run tests  +3 -1`)
  const done = calls.map(c => ({ ...c, status: 'ok' as const }))
  const ok = flat(renderRunRow(t, p, done, { ...o, last: true, durationMs: 1200 }))
  expect(ok.startsWith(G.arcBL + G.rule + ' ' + G.tick)).toBe(true)
  expect(ok).toContain('a.ts')
  expect(ok.endsWith('1.2s')).toBe(true)
  const bad = flat(renderRunRow(t, p, [{ ...done[0]!, status: 'failed' }, done[1]!], o))
  expect(bad).toContain(G.cross)
  expect(bad).toContain('1 failed')
})

test('a run with a call in the background: hollow mark and a count, no tick and no time', () => {
  const calls: RunCall[] = [
    { id: 'a', tool: 'Bash', subject: 'Wait then print', status: 'background' },
    { id: 'b', tool: 'Agent', subject: 'List hooks', status: 'ok' },
  ]
  const row = flat(renderRunRow(t, p, calls, { key: 'run:a', isOpen: false, last: false, lines: { add: 0, del: 0 }, durationMs: 900, onToggle: () => {} }))
  expect(row.startsWith(G.tee + G.rule + ' ' + G.hollow)).toBe(true)
  expect(row).toContain(`${G.middot} 1 in background`)
  expect(row).not.toContain(G.tick)
  expect(row).not.toContain('0.9s')
})

test('a Bottom line head forms with the colon inside the bold too', async () => {
  for (const head of ['**Bottom line**', '**Bottom line**:', '**Bottom line:**']) {
    expect(parseMarkdown(head + '\n- Verified: a\n- Issue: b\n- Fix: c')[0]?.kind).toBe('callout')
  }
})

test('durations past an hour: hours and minutes, whole in the clock', async () => {
  expect(fmtDuration(59 * 60_000)).toBe('59m 00s')
  expect(fmtDuration(7_200_000)).toBe('2h 00m')
  expect(fmtDuration(3_900_000)).toBe('1h 05m')
  const bytes = Uint8Array.from(atob(clockCells(7_200_000, '#ffffff')), ch => ch.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const text = Array.from({ length: CLOCK_CELLS }, (_, i) => String.fromCharCode(words[i * 3]!)).join('')
  expect(text).toBe(' 2h 00m')
  // past 99h 59m the clock holds there, its first digit kept
  const capped = new Uint32Array(Uint8Array.from(atob(clockCells(100 * 3_600_000, '#ffffff')), ch => ch.charCodeAt(0)).buffer)
  expect(Array.from({ length: CLOCK_CELLS }, (_, i) => String.fromCharCode(capped[i * 3]!)).join('')).toBe('99h 59m')
})

test('an output line is a string the API takes: bounded, no control characters, the last pass of a carriage return', async () => {
  const json = '{"a":' + '1,'.repeat(8000) + '1}'
  const longest = Math.max(...strings(renderToolOutput(t, p, [json], { columns: 80, maxLines: 3 })).map(s => s.length))
  expect(longest).toBeLessThanOrEqual(1000)
  const ctl = flat(renderToolOutput(t, p, ['a' + cp(8) + 'b' + cp(7) + 'c'], { columns: 80, maxLines: 3 }))
  expect(/[\x00-\x08\x0b-\x1f]/.test(ctl)).toBe(false)
  expect(flat(renderToolOutput(t, p, ['50%\r100%\r'], { columns: 80, maxLines: 3 }))).toBe(G.pipe + '100%')
})

test('an event row: no time under a tenth of a second, keyed by its message', async () => {
  for (const ms of [1, 50, 99]) expect(flat(renderEventRow(t, p, 'm', 'Task done', { status: 'completed', durationMs: ms }))).not.toContain('0.')
  expect(flat(renderEventRow(t, p, 'm', 'Task done', { status: 'completed', durationMs: 100 })).endsWith('0.1s')).toBe(true)
  const rowKeys = (id: string) => elements(renderEventRow(t, p, id, 'Agent "x" finished', { status: 'completed' })).map(n => n.props.key).filter(Boolean)
  expect(rowKeys('m1')).not.toEqual(rowKeys('m2'))
})

test('a comment-only line in a shell fence draws as a comment', async () => {
  expect(highlightLine('# note', 'bash')).toEqual([{ text: '# note', kind: 'comment' }])
  expect(highlightLine('  # note', 'sh')).toEqual([{ text: '  ', kind: 'plain' }, { text: '# note', kind: 'comment' }])
  expect(highlightLine('ls # x', 'bash').at(-1)).toEqual({ text: '# x', kind: 'comment' })
})

test('a quoted Bottom line on a narrow terminal: the quote bar is as tall as the card', async () => {
  const md = '> **Bottom line**\n> - Verified: ' + 'word '.repeat(9) + '\n> - Issue: b\n> - Fix: c'
  const all = elements(reply(md, 50))
  const bar = (color: string) => all.find(n => n.type === 'Text' && n.props.color === color && String((n.props.children as unknown[])[0]).startsWith(G.mark))!
  const height = (color: string) => String((bar(color).props.children as unknown[])[0]).split('\n').length
  // the card's bar runs its rows; the title line sits above it
  expect(height(p.quoteBar)).toBe(height(p.calloutBar) + 1)
  expect(height(p.calloutBar)).toBe(4)
})

test('no Text string past 10000 characters: a long run goes as several', async () => {
  const longest = (node: RenderNode) => Math.max(0, ...strings(node).map(s => s.length))
  const cases = ['word '.repeat(3000), '```ts\n' + 'x'.repeat(15000) + '\n```', '`' + 'y'.repeat(15000) + '`', 'see ' + 'a/'.repeat(7000) + 'b.ts']
  for (const md of cases) {
    const tree = reply(md)
    expect(longest(tree)).toBeLessThanOrEqual(10000)
    expect(strings(tree).join('').length).toBeGreaterThanOrEqual(14000)
  }
})


test('0.4.22: a fence under a list item draws as a card under the text, and the quote bar counts it', async () => {
  const md = '1. Install:\n   ```bash\n   npm i\n   ```\n2. Run it'
  const tree = reply(md)
  const card = fenceCard(tree)
  expect(card).toBeDefined()
  expect(lines(card!)).toEqual(['npm i'])
  // the card sits under the item text, in from the marker
  const holder = elements(tree).find(n => n.type === 'Box' && (n.props.children as RenderNode[])?.[0] === card)
  expect(holder?.props.marginLeft).toBe(3)
  // the text row itself has no newline-ridden code span left in it
  expect(flat(tree)).not.toContain('```')
  const quoted = parseMarkdown(md.split('\n').map(l => '> ' + l).join('\n'))
  if (quoted[0]?.kind !== 'quote') throw new Error('expected a quote')
  // two item rows, one code row, and one row of air each side of the card (0.5.2)
  expect(quoteRows(quoted[0].blocks, 100)).toBe(5)
})

test('0.4.22: a blank line in a short fence is a row of its own', async () => {
  const card = fenceCard(reply('```ts\nconst a = 1\n\nconst b = 2\n```'))!
  const rows = (card as unknown as { props: { children: { props: { children: unknown[] } }[] } }).props.children
  expect(rows.length).toBe(3)
  expect(rows[1]!.props.children).toEqual([' '])
})

test('0.4.22: a gutter mark reads prose only: a question mark in code or in a URL never marks', async () => {
  const marked = (md: string) => {
    const first = (renderReply(t, parseMarkdown(md), p, { columns: 100, marks: true }) as unknown as { props: { children: RenderElement[] } }).props.children[0]!
    return flat(first).startsWith(G.mark)
  }
  expect(marked('Use `foo?.bar` to chain the call.')).toBe(false)
  expect(marked('See https://x.com/?q=1 for the docs.')).toBe(false)
  expect(marked('See [the docs](https://x.com/?q=1) for it.')).toBe(false)
  expect(marked('Did the build pass?')).toBe(true)
  expect(marked('Run the tests on your machine.')).toBe(true)
})

test('0.4.22: numeric columns take signs, currency and units, and the header sits over its numbers', async () => {
  const rows = lines(tableOf('| item | delta | cost |\n|---|---|---|\n| a | -3 | $12 |\n| bb | +1.5k | 80% |\n| c | 12ms |  |'))
  expect(rows[0]).toBe('item  delta  cost')
  expect(rows[2]).toBe('a        -3   $12')
  expect(rows[3]).toBe('bb    +1.5k   80%')
  // an empty last cell leaves only the column gap behind it
  expect(rows[4]!.trimEnd()).toBe('c      12ms')
  // a word column stays left, header included
  const words = lines(tableOf('| name | n |\n|---|---|\n| a | 1 |\n| bb | 22 |'))
  expect(words[0]).toBe('name   n')
})

test('MCP tool names split into a server and a name, prefixes dropped, one underscore at most', () => {
  expect(toolLabel('mcp__figma__get_design_context')).toEqual({ server: 'figma', name: 'get_design_context' })
  expect(toolLabel('mcp__plugin_jev-reach_chrome-devtools__take_screenshot')).toEqual({ server: 'chrome-devtools', name: 'take_screenshot' })
  expect(toolLabel('mcp__claude_ai_Forecast_MCP__get_project_status')).toEqual({ server: 'forecast', name: 'get_project_status' })
  expect(toolLabel('mcp__claude_ai_Claude_Docs__batch')).toEqual({ server: 'claude-docs', name: 'batch' })
  expect(toolLabel('mcp__x__a___b')).toEqual({ server: 'x', name: 'a_b' })
  expect(toolLabel('Bash')).toEqual({ server: null, name: 'Bash' })
  expect(toolLabel('some__tool')).toEqual({ server: null, name: 'some_tool' })
})

// the 0.5.2 tests walk trees as plain data: `elements()` lists every node
type El = { type: string; props: Record<string, unknown> }
const kidsOf = (n: El) => (n.props.children ?? []) as RenderNode[]
const asEl = (n: RenderNode) => n as unknown as El

test('0.5.2: ordered numbers right-align, a child hangs off its parent text, a card under an item has air', async () => {
  const blocks = parseMarkdown('9. nine\n10. ten\n    - child\n11. Run:\n    ```\n    npm i\n    ```\n12. after')
  const tree = renderReply(t, blocks, p, { first: false, columns: 80, marks: false })
  const list = elements(tree).find(n => n.type === 'Box' && kidsOf(n).length === 5 && kidsOf(n).every(k => typeof k !== 'string' && k.type === 'Box'))
  expect(list).toBeDefined()
  const rows = kidsOf(list!).map(asEl)
  const rowBox = (n: El): El => (n.props.flexDirection === 'row' ? n : asEl(kidsOf(n)[0]!))
  const marker = (n: El) => flat(kidsOf(rowBox(n))[0]!)
  expect(marker(rows[0]!)).toBe(' 9. ')
  expect(marker(rows[1]!)).toBe('10. ')
  // the child's marker sits at the parent's text column: 4 cells in
  expect(rowBox(rows[2]!).props.marginLeft).toBe(4)
  expect(marker(rows[2]!)).toBe(G.ring + ' ')
  // the card under item 11 and the item after it each get one row of air
  const card = asEl(kidsOf(rows[3]!)[1]!)
  expect(card.props.marginTop).toBe(1)
  expect(card.props.marginLeft).toBe(4)
  expect(rowBox(rows[4]!).props.marginTop).toBe(1)
  expect(rowBox(rows[1]!).props.marginTop).toBeUndefined()
})

test('0.5.2: a card or table under a heading keeps its blank row, a paragraph does not', async () => {
  const top = (md: string) => kidsOf(asEl(renderReply(t, parseMarkdown(md), p, { first: false, columns: 80, marks: false }))).map(b => asEl(b).props.marginTop)
  expect(top('## Title\ntext')).toEqual([0, 0])
  expect(top('## Title\n```\nx\n```')).toEqual([0, 1])
  expect(top('## Title\n| a | b |\n| --- | --- |\n| 1 | 2 |')).toEqual([0, 1])
  expect(top('## Title\n**Bottom line**\nVerified: yes')).toEqual([0, 1])
})

test('0.5.2: a numeric column survives a placeholder and a longer unit', async () => {
  const dash = String.fromCodePoint(0x2014)
  const md = '| cost | p95 | rate |\n| --- | --- | --- |\n| $12 | 1.2s | 3GB |\n| ' + dash + ' | 340ms | 4.5MB/s |'
  // a table row is a Box of cell Texts
  const body = elements(reply(md, 80)).filter(n => n.type === 'Box' && n.props.flexDirection === 'row' && /GB|MB/.test(flat(n as unknown as RenderNode))).map(n => flat(n as unknown as RenderNode))
  expect(body.length).toBe(2)
  // right-aligned: the cells of each column end on one cell
  expect(body[0]!.trimEnd().endsWith('3GB')).toBe(true)
  expect(body[1]!.trimEnd().endsWith('4.5MB/s')).toBe(true)
  expect(body[0]!.indexOf('$12') + 3).toBe(body[1]!.indexOf(dash) + 1)
})

test('0.5.2: the dots line carries the tree inset on its right; a server row time is faint', async () => {
  const dots = renderUserRow(t, p, {
    text: 'x', submittedAt: 1_000_000, startedAt: 1_000_500, columns: 80, folded: false, onFold: () => undefined, onCopy: () => undefined,
    turn: { turnId: 'd', calls: [{ id: 't1', tool: 'Read', status: 'ok', ms: 300 }], done: { turnId: 'd', durationMs: 1, tools: 1, edits: 0, failed: 0, inTokens: 0, cacheTokens: 0, outTokens: 0, costUsd: 0, lastToolId: 't1', answer: '', startedAt: 0, finishedAt: 1 } },
  })
  const dotsRow = elements(dots).find(n => typeof n.props.key === 'string' && n.props.key.startsWith('dots:'))
  expect(dotsRow?.props.marginRight).toBe(2)
  const server = renderServerToolRows(t, p, [{ id: 's1', name: 'advisor', startedAt: 0, endedAt: 4200 }])
  const times = elements(server).filter(n => n.type === 'Text' && flat(n as unknown as RenderNode) === '4.2s')
  expect(times.length).toBe(1)
  expect(times[0]!.props.color).toBe(p.faint)
})

test('the tick stays ok on tree and event rows, a failure err; headers keep their color (muting was turned down 2026-10-11)', async () => {
  const base = { tool_use_id: 't1', tool: 'Read', input: { file_path: 'a.ts' }, isRunning: false, isErrored: false, isInterrupted: false }
  const tick = elements(renderTreeRow(t, p, base, { last: false, durationMs: 300 })).find(n => n.type === 'Text' && flat(n as unknown as RenderNode) === G.tick + ' ')
  expect(tick?.props.color).toBe(p.ok)
  const cross = elements(renderTreeRow(t, p, { ...base, isErrored: true }, { last: false, durationMs: 300 })).find(n => n.type === 'Text' && flat(n as unknown as RenderNode) === G.cross + ' ')
  expect(cross?.props.color).toBe(p.err)
  const ev = elements(renderEventRow(t, p, 'm1', 'Agent "x" finished', { status: 'completed', durationMs: 5000 })).find(n => n.type === 'Text' && flat(n as unknown as RenderNode) === G.tick + ' ')
  expect(ev?.props.color).toBe(p.ok)
  // the header names keep their color (a neutral bold name was turned down)
  const header = renderUserRow(t, p, { text: 'x', submittedAt: 1_000_000, startedAt: 1_000_500, columns: 80, folded: false, turn: null })
  expect(elements(header).find(n => n.type === 'Text' && flat(n as unknown as RenderNode) === G.diamond + ' You')?.props.color).toBe(p.accentUser)
  expect(elements(header).find(n => n.type === 'Text' && flat(n as unknown as RenderNode) === G.fisheye + ' Claude')?.props.color).toBe(p.accent)
})

test('quoted prose keeps the prose color (a meta step was turned down 2026-10-11); bold and code keep theirs', async () => {
  const tree = renderReply(t, parseMarkdown('> quoted **bold** and `glass`'), p, { first: false, columns: 80, marks: false })
  const texts = elements(tree).filter(n => n.type === 'Text' && typeof n.props.color === 'string')
  const colorsOf = (s: string) => texts.filter(n => flat(n as unknown as RenderNode) === s).map(n => n.props.color)
  expect(colorsOf('quoted ')).toEqual([])
  expect(colorsOf('bold')).toEqual([p.bold])
  expect(colorsOf('glass')).toEqual([p.code])
})

test('0.5.3: the highlighter: keywords by language, Rust lifetimes, YAML keys', async () => {
  const kinds = (spans: CodeSpan[]) => spans.filter(s => s.kind !== 'plain').map(s => `${s.kind}:${s.text}`)
  // `range` is a Go keyword, a call in Python; `values` is SQL's, a call in TS
  expect(kinds(highlightLine('for i in range(10):', 'py'))).toEqual(['kw:for', 'kw:in', 'fn:range', 'num:10'])
  expect(kinds(highlightLine('for i := range xs {', 'go'))).toEqual(['kw:for', 'kw:range'])
  expect(kinds(highlightLine('const v = values(x)', 'ts'))).toEqual(['kw:const', 'fn:values'])
  expect(kinds(highlightLine('SELECT a FROM t', 'sql'))).toEqual([])
  expect(kinds(highlightLine('select a from t', 'sql'))).toEqual(['kw:select', 'kw:from'])
  // a lifetime is not a string; a char literal still is
  // a lifetime keeps the string color but ends at its word
  expect(kinds(highlightLine("fn f<'a>(x: &'a String) -> &'a str {", 'rs'))).toEqual(['kw:fn', "str:'a", "str:'a", 'type:String', "str:'a"])
  expect(kinds(highlightLine("let c = 'a';", 'rs'))).toEqual(['kw:let', "str:'a'"])
  // a JSON key is a string and keeps the string color; a YAML key paints as a call
  expect(kinds(highlightLine('  "name": "glass",', 'json'))).toEqual(['str:"name"', 'str:"glass"'])
  expect(kinds(highlightLine('  - file_path: hooks/a.ts', 'yaml'))).toEqual(['fn:file_path'])
  expect(kinds(highlightLine('version: 2 # note', 'yml'))).toEqual(['fn:version', 'num:2', 'comment:# note'])
})
