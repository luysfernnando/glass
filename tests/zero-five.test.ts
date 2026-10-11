// 0.5.0: the summary trailer, server tool rows after the reply, the hint
// line's mode word in theme slots.
import { expect, test } from 'claude-code/testing'
import type { Elements, RenderElement, RenderNode } from 'claude-code'

import { renderHint, renderServerToolRows, renderUserRow } from '../hooks/chrome'
import { G } from '../hooks/glyphs'
import { parseMarkdown } from '../hooks/markdown'
import { PALETTES } from '../hooks/palette'
import { renderReply } from '../hooks/render'

const p = PALETTES.tidepool
const el = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as unknown as RenderElement
const t = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Link: el('Link'), Code: el('Code'), Markdown: el('Markdown') } as unknown as Elements['terminal']

type Node = { type: string; props: Record<string, unknown> & { children?: RenderNode[]; color?: string } }
function strings(node: RenderNode): string[] {
  if (typeof node === 'string') return [node]
  const n = node as unknown as Node
  if (n.type === 'Button') return [String(n.props.label ?? '')]
  return (n.props.children ?? []).flatMap(strings)
}
const flat = (node: RenderNode) => strings(node).join('')
const lines = (node: RenderElement) => (((node as unknown as Node).props.children ?? []) as RenderNode[]).map(flat)
function colorsOf(node: RenderNode, out: string[] = []): string[] {
  if (typeof node === 'string') return out
  const n = node as unknown as Node
  if (typeof n.props.color === 'string') out.push(n.props.color)
  for (const k of n.props.children ?? []) colorsOf(k, out)
  return out
}

test('a compaction summary ends on one faint summary row; a plain reply does not', async () => {
  const blocks = parseMarkdown('Summary so far: three files changed.\n\n- one\n- two')
  const plain = renderReply(t, blocks, p, { first: true, columns: 80, marks: true })
  const summary = renderReply(t, blocks, p, { first: true, columns: 80, marks: true, summary: true })
  const plainRows = lines(plain)
  const rows = lines(summary)
  expect(rows.length).toBe(plainRows.length + 1)
  expect(rows[rows.length - 1]).toBe(G.middot + ' summary')
  const last = ((summary as unknown as Node).props.children as RenderNode[]).at(-1) as RenderNode
  expect((last as unknown as Node).props.marginTop).toBeUndefined()
  expect(colorsOf(last)).toEqual([p.faint])
  expect(flat(plain)).not.toContain('summary')
})

test('server tool rows: the name in tool, the note faint, the duration in meta, none without an end time, an air row above each', async () => {
  const out = renderServerToolRows(t, p, [
    { id: 's1', name: 'advisor', startedAt: 1000, endedAt: 5200 },
    { id: 's2', name: 'advisor', startedAt: 9000 },
  ])
  const rows = lines(out)
  expect(rows.length).toBe(2)
  expect(rows[0]!.startsWith(G.pipe)).toBe(true)
  expect(rows[0]).toContain(G.tee + G.rule + ' ' + G.tick + ' advisor  ran by the API')
  expect(rows[0]).toContain('4.2s')
  // no end time: no duration at the right
  expect(/\d(\.\d)?s$/.test(rows[1]!.trimEnd())).toBe(false)
  expect(/\d(\.\d)?s$/.test(rows[0]!.trimEnd())).toBe(true)
  const colors = colorsOf(out)
  expect(colors).toContain(p.tool)
  expect(colors).toContain(p.faint)
  expect(colors).toContain(p.meta)
  // the mark is meta, not ok: the engine ran nothing for it
  expect(colors).not.toContain(p.ok)
})

test('the dots line: a chevron and Copy as plain keyed Buttons once the turn is done; neither without a handler', async () => {
  const turn = { turnId: 'x', durationMs: 5000, tools: 1, edits: 0, failed: 0, inTokens: 1, cacheTokens: 0, outTokens: 1, costUsd: null, lastToolId: 't1', answer: 'done', startedAt: 0, finishedAt: 5000 }
  const calls = [{ id: 't1', tool: 'Bash', status: 'ok' as const, ms: 800 }]
  const buttons = (node: RenderNode, out: Node[] = []): Node[] => {
    if (typeof node === 'string') return out
    const n = node as unknown as Node
    if (n.type === 'Button') out.push(n)
    for (const k of n.props.children ?? []) buttons(k, out)
    return out
  }
  const pressed: string[] = []
  const withButtons = renderUserRow(t, p, { text: 'hi', submittedAt: 0, startedAt: 0, turn: { turnId: 'x', calls, done: turn }, columns: 80, folded: false, onFold: () => pressed.push('fold'), onCopy: () => pressed.push('copy') })
  const found = buttons(withButtons)
  expect(found.map(b => b.props.key)).toEqual(['fold:x', 'copy:x'])
  expect(found.map(b => b.props.label)).toEqual([G.down, G.copy + ' Copy'])
  for (const b of found) {
    expect(b.props.plain).toBe(true)
    ;(b.props.onPress as () => void)()
  }
  expect(pressed).toEqual(['fold', 'copy'])
  // folded: the chevron points right; live: no Copy yet
  expect(buttons(renderUserRow(t, p, { text: 'hi', submittedAt: 0, startedAt: 0, turn: { turnId: 'x', calls, done: turn }, columns: 80, folded: true, onFold: () => undefined, onCopy: () => undefined }))[0]!.props.label).toBe(G.right)
  expect(buttons(renderUserRow(t, p, { text: 'hi', submittedAt: 0, startedAt: 0, turn: { turnId: 'x', calls, done: null }, columns: 80, onFold: () => undefined, onCopy: () => undefined })).map(b => b.props.key)).toEqual(['fold:x'])
  expect(buttons(renderUserRow(t, p, { text: 'hi', submittedAt: 0, startedAt: 0, turn: { turnId: 'x', calls, done: turn }, columns: 80 })).length).toBe(0)
})

test('the hint line: the mode word names the theme slot for its mode', async () => {
  const mode = (rest: string) => colorsOf(renderHint(t, p, { vim: '-- INSERT --', rest })).at(-1)
  expect(mode('plan mode on')).toBe('planMode')
  expect(mode('accept edits on')).toBe('autoAccept')
  expect(mode('auto mode on')).toBe('warning')
  expect(mode('bypass permissions on')).toBe('warning')
  expect(mode('something else')).toBe(p.meta)
  expect(colorsOf(renderHint(t, p, { vim: '-- INSERT --', rest: 'plan mode on' }))[0]).toBe(p.accentUser)
})
