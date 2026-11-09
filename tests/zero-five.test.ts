// 0.5.0: the summary trailer, server tool rows after the reply, the hint
// line's mode word in theme slots.
import { expect, test } from 'claude-code/testing'
import type { Elements, RenderElement, RenderNode } from 'claude-code'

import { renderHint, renderServerToolRows } from '../hooks/chrome'
import { G } from '../hooks/glyphs'
import { parseMarkdown } from '../hooks/markdown'
import { PALETTES } from '../hooks/palette'
import { copyControl, renderReply } from '../hooks/render'
import type { Copyable, CopyFormat } from '../hooks/render'

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
  const plain = renderReply(t, blocks, p, { columns: 80, marks: true })
  const summary = renderReply(t, blocks, p, { columns: 80, marks: true, summary: true })
  const plainRows = lines(plain)
  const rows = lines(summary)
  expect(rows.length).toBe(plainRows.length + 1)
  expect(rows[rows.length - 1]).toBe(G.middot + ' summary')
  const last = ((summary as unknown as Node).props.children as RenderNode[]).at(-1) as RenderNode
  expect((last as unknown as Node).props.marginTop).toBeUndefined()
  expect(colorsOf(last)).toEqual([p.faint])
  expect(flat(plain)).not.toContain('summary')
})

test('server tool rows: the name plain, the note faint, the duration in meta, none without an end time, no air row (fork rows run tight)', async () => {
  const out = renderServerToolRows(t, p, [
    { id: 's1', name: 'advisor', startedAt: 1000, endedAt: 5200 },
    { id: 's2', name: 'advisor', startedAt: 9000 },
  ])
  const rows = lines(out)
  expect(rows.length).toBe(2)
  expect(rows[0]!.startsWith(G.tick)).toBe(true)
  expect(rows[0]).toContain(G.tick + ' advisor  ran by the API')
  expect(rows[0]).toContain('4.2s')
  // no end time: no duration at the right
  expect(/\d(\.\d)?s$/.test(rows[1]!.trimEnd())).toBe(false)
  expect(/\d(\.\d)?s$/.test(rows[0]!.trimEnd())).toBe(true)
  const colors = colorsOf(out)
  // the name keeps the row's default color: the fork dropped the tool hue
  expect(colors).not.toContain(p.tool)
  expect(colors).toContain(p.faint)
  expect(colors).toContain(p.meta)
  // the mark is meta, not ok: the engine ran nothing for it
  expect(colors).not.toContain(p.ok)
})

test('the hover copy control: one Button per format, a hidden panel the marker reveals, nothing without a handler', async () => {
  const what: Copyable = { md: '**hi**', html: () => '<b>hi</b>', text: () => 'hi' }
  const walk = (node: RenderNode, out: Node[] = []): Node[] => {
    if (typeof node === 'string') return out
    const n = node as unknown as Node
    out.push(n)
    for (const k of n.props.children ?? []) walk(k, out)
    return out
  }
  expect(copyControl({ t, p, copy: undefined }, what, 'row')).toEqual([])
  expect(copyControl({ t, p, copy: () => undefined }, { ...what, md: ' ' }, 'row')).toEqual([])
  const got: [string, CopyFormat][] = []
  const parts = copyControl({ t, p, copy: (w, f) => got.push([w.md, f]) }, what, 'row')
  expect(parts.length).toBe(2)
  const nodes = parts.flatMap(x => walk(x))
  const buttons = nodes.filter(n => n.type === 'Button')
  expect(buttons.map(b => b.props.label)).toEqual(['markdown', 'html', 'text'])
  for (const b of buttons) {
    expect(b.props.plain).toBe(true)
    ;(b.props.onPress as (x: { surface: string }) => void)({ surface: 'terminal' })
  }
  expect(got.map(g => g[1])).toEqual(['md', 'html', 'text'])
  // the panel starts hidden and shows under the marker's scope
  const panel = nodes.find(n => n.props.display === 'none')!
  const scope = (panel.props.hover as { scope: string; display: string })
  expect(scope.display).toBe('flex')
  const marker = nodes.find(n => (n.props.hover as { scope?: string } | undefined)?.scope === scope.scope && n !== panel)
  expect(marker).toBeDefined()
  // the low place pins to the bottom
  const low = copyControl({ t, p, copy: () => undefined }, what, 'low').flatMap(x => walk(x))
  expect(low.some(n => n.props.bottom === 0)).toBe(true)
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
