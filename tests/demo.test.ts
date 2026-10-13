// Before-and-after dumps for DEMO.md: each fixture's rows as text, then the
// distinct colors the tree names. The test sandbox has no file system, so
// the dumps go to the runner's output between `@@DUMP <name>` and `@@END`
// markers; `scripts/demo-dump.sh <before|after>` splits them into
// demo/<target>/<name>.txt. The `before` set was captured on 0.4.25 and
// committed once; `after` is written on every run of the 0.5.0 tree. Not a
// test of behaviour: it only asserts that every fixture produced rows.
import { expect, test } from 'claude-code/testing'
import type { Elements, RenderElement, RenderNode } from 'claude-code'

import { renderBand, renderDiff, renderGroupRow, renderHint, renderServerToolRows, renderTreeRow, renderUserRow } from '../hooks/chrome'
import { parseMarkdown } from '../hooks/markdown'
import { PALETTES } from '../hooks/palette'
import { renderReply } from '../hooks/render'

declare const console: { log: (...args: unknown[]) => void }

const p = PALETTES.tidepool
const el = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as unknown as RenderElement
const t = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Link: el('Link'), Code: el('Code'), Markdown: el('Markdown'), Raster: el('Raster') } as unknown as Elements['terminal']

type Node = { type: string; props: Record<string, unknown> & { children?: RenderNode[] } }

// rows of text: a column Box stacks its children, a row Box joins them,
// a Text joins its children; a Button shows its label in brackets
function rows(node: RenderNode): string[] {
  if (typeof node === 'string') return [node]
  const n = node as unknown as Node
  if (n.props.display === 'none') return ['(display: none)']
  if (n.type === 'Button') return [`[${String(n.props.label ?? '')}]`]
  if (n.type === 'Raster') return [`<raster ${String(n.props.columns)} cells>`]
  const kids = n.props.children ?? []
  if (n.type === 'Box' && n.props.flexDirection !== 'row') {
    const out: string[] = []
    const top = typeof n.props.marginTop === 'number' ? n.props.marginTop : 0
    for (let i = 0; i < top; i++) out.push('')
    for (const k of kids) out.push(...rows(k))
    return out
  }
  // a row: every child's rows side by side, first rows joined
  const parts = kids.map(rows)
  const height = Math.max(1, ...parts.map(r => r.length))
  const out: string[] = []
  for (let i = 0; i < height; i++) out.push(parts.map(r => r[i] ?? '').join(''))
  return out
}

function colors(node: RenderNode, seen: string[] = []): string[] {
  if (typeof node === 'string') return seen
  const n = node as unknown as Node
  for (const k of ['color', 'backgroundColor'] as const) {
    const v = n.props[k]
    if (typeof v === 'string' && !seen.includes(v)) seen.push(v)
  }
  for (const kid of n.props.children ?? []) colors(kid, seen)
  return seen
}

function dump(name: string, tree: RenderElement): [string, string[]] {
  const body = rows(tree).map(r => r.replace(/\s+$/, ''))
  return [name, [...body, '', '-- colors --', ...colors(tree)]]
}

const call = (id: string, tool: string, status: 'ok' | 'failed' | 'running', ms: number | null) => ({ id, tool, status, ms })
const turn = {
  turnId: 'demo', durationMs: 146_000, tools: 4, edits: 1, failed: 1, inTokens: 1_800_000, cacheTokens: 1_620_000, outTokens: 5300,
  costUsd: 0.58, lastToolId: 't4', answer: 'done', startedAt: 0, finishedAt: 146_000,
}

const reply = [
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

test('demo dumps: every fixture produces rows', async () => {
  const row = (tool: string, input: unknown, failed = false, id = 't1') => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: failed, isInterrupted: false })
  const fixtures: [string, string[]][] = [
    dump('reply', renderReply(t, parseMarkdown(reply), p, { first: true, columns: 100, marks: true })),
    // a compaction summary: 0.4.25 ignored the flag, 0.5.0 adds a trailer row
    dump('summary', renderReply(t, parseMarkdown('Summary of the session so far: three files changed.'), p, { first: true, columns: 100, marks: true, summary: true })),
    dump('dots-line', renderUserRow(t, p, {
      text: 'add the notify option',
      submittedAt: 1_000_000,
      startedAt: 1_000_500,
      turn: { turnId: 'demo', calls: [call('t1', 'Read', 'ok', 300), call('t2', 'Bash', 'ok', 800), call('t3', 'Edit', 'failed', 120), call('t4', 'Bash', 'ok', 1200)], done: turn },
      columns: 100,
      // 0.5.0: the chevron and Copy at the right end (drawn as [label])
      folded: false,
      onFold: () => undefined,
      onCopy: () => undefined,
    })),
    dump('tree-rows', t.Box({
      flexDirection: 'column',
      children: [
        renderTreeRow(t, p, row('Read', { file_path: 'hooks/register.ts' }), { last: false, durationMs: 300 }),
        renderTreeRow(t, p, row('Bash', { command: 'git log --oneline -1' }, false, 't2'), { last: false, durationMs: 800 }),
        renderTreeRow(t, p, row('Edit', { file_path: 'hooks/chrome.ts' }, true, 't3'), { last: false, durationMs: 120 }),
        renderGroupRow(t, p, [{ tool: 'Read', input: { file_path: 'a.ts' }, isRunning: false, isErrored: false, isInterrupted: false }, { tool: 'Grep', input: { pattern: 'x' }, isRunning: false, isErrored: false, isInterrupted: false }], { isActive: false, key: 'g1', onExpand: null }),
      ],
    })),
    dump('diff-card', renderDiff(t, p, [
      { oldStart: 268, newStart: 274, lines: ['  const right = x', '-  return t.Box({', '+  return spaced(t, p, t.Box({', '   key: 1'] },
    ], { path: 'hooks/chrome.ts', columns: 100 })),
    dump('hint-modes', t.Box({
      flexDirection: 'column',
      children: [
        renderHint(t, p, { vim: '-- INSERT --', rest: 'plan mode on' }),
        renderHint(t, p, { vim: '-- INSERT --', rest: 'accept edits on' }),
        renderHint(t, p, { vim: '-- INSERT --', rest: 'auto mode on' }),
        renderHint(t, p, { vim: '-- INSERT --', rest: 'bypass permissions on' }),
      ],
    })),
    dump('band', renderBand(t, p, {
      agents: [
        { agentId: 'a1', description: 'Hunt widths', kind: 'Explore', model: 'claude-sonnet-5-5', effort: 'medium', stage: 'Grep', file: 'hooks/width.ts', tokens: 12_400, startedAt: 0 },
        { agentId: 'a2', description: 'Review the diff', kind: 'general-purpose', model: 'claude-opus-5-5', effort: 'high', stage: 'thinking' + String.fromCodePoint(0x2026), file: '', tokens: 900, startedAt: 30_000 },
      ],
      now: 85_000,
      columns: 100,
      open: true,
      onToggle: null,
      tasksCommand: 'tasks',
    })),
    // 0.4.25 drew nothing after the reply (the before dump is the hidden
    // row); 0.5.0 draws the turn's server tool rows there
    dump('server-tools', renderServerToolRows(t, p, [
      { id: 's1', name: 'advisor', startedAt: 1000, endedAt: 5200 },
      { id: 's2', name: 'advisor', startedAt: 9000 },
    ])),
  ]
  for (const [name, lines] of fixtures) {
    console.log(`@@DUMP ${name}`)
    for (const line of lines) console.log(line)
    console.log('@@END')
    expect(lines.length > 0).toBe(true)
  }
  expect(fixtures.length).toBe(8)
})
