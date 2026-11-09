import { expect, test } from 'claude-code/testing'
import type { Elements, RenderElement, RenderNode } from 'claude-code'

import { figureArt, figureRuns, mermaidArt } from '../hooks/diagram'
import { HINT } from '../hooks/hint'
import { parseMarkdown } from '../hooks/markdown'
import { PALETTES } from '../hooks/palette'
import { renderReply } from '../hooks/render'

const p = PALETTES.tidepool
const el = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as unknown as RenderElement
const t = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Link: el('Link'), Code: el('Code'), Markdown: el('Markdown') } as unknown as Elements['terminal']

function strings(node: RenderNode): string[] {
  if (typeof node === 'string') return [node]
  const props = ((node as { props?: unknown }).props ?? {}) as { children?: RenderNode[]; label?: string }
  if (node.type === 'Button') return [props.label ?? '']
  return (props.children ?? []).flatMap(strings)
}
const draw = (md: string, onCopy?: (text: string) => void) => strings(renderReply(t, parseMarkdown(md), p, { columns: 80, marks: false, onCopy: onCopy as never })).join('|')
const buttons = (node: RenderNode): RenderNode[] => {
  if (typeof node === 'string') return []
  const kids = ((node as { props?: { children?: RenderNode[] } }).props?.children ?? []) as RenderNode[]
  return [...(node.type === 'Button' ? [node] : []), ...kids.flatMap(buttons)]
}

test('a GitHub alert parses to a level and its blocks', async () => {
  for (const level of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
    const [b] = parseMarkdown(`> [!${level}]\n> body text`)
    expect(b).toMatchObject({ kind: 'alert', level: level.toLowerCase() })
  }
  expect(parseMarkdown('> plain quote')[0]!.kind).toBe('quote')
})

test('an alert draws its label and body', async () => {
  const out = draw('> [!WARNING]\n> mind the gap')
  expect(out).toContain('Warning')
  expect(out).toContain('mind the gap')
  expect(out).not.toContain('[!WARNING]')
})

test('mermaid kinds draw as art, a bad one stays a code card', async () => {
  const kinds = ['graph TD\n  A[Start] --> B[End]', 'sequenceDiagram\n  A->>B: hi', 'xychart-beta\n  x-axis [a, b, c]\n  bar [1, 2, 3]', 'pie\n  "x" : 3\n  "y" : 1', 'gantt\n  title T\n  dateFormat YYYY-MM-DD\n  section S\n  Task :a1, 2026-01-01, 3d']
  for (const k of kinds) expect(mermaidArt(k, 78)).not.toBeNull()
  expect(mermaidArt('notadiagram\n  foo', 78)).toBeNull()
  expect(draw('```mermaid\nnotadiagram\n  foo\n```')).toContain('notadiagram')
  expect(draw('```mermaid\ngraph TD\n  A[Start] --> B[End]\n```')).toContain('Start')
})

test('an unclosed mermaid fence stays a code card', async () => {
  const [b] = parseMarkdown('```mermaid\ngraph TD\n  A --> B')
  expect(b).toMatchObject({ kind: 'code', open: true })
})

test('a figure maps roles to slots and drops the markup', async () => {
  expect(figureRuns('a {warn:b} c')).toEqual([{ text: 'a ', slot: 'text' }, { text: 'b', slot: 'warn' }, { text: ' c', slot: 'text' }])
  expect(figureArt('{ok:fine}\n{bogus:x}', 40)?.rows.length).toBe(2)
  expect(figureArt('x'.repeat(100), 40)).toBeNull()
  const out = draw('```figure\n{accent:hello} world\n```')
  expect(out).toContain('hello')
  expect(out).not.toContain('{accent')
})

test('a fenced block has a copy button only when copy is wired', async () => {
  const code = '```sh\nls -la\n```'
  expect(buttons(renderReply(t, parseMarkdown(code), p, { columns: 80, marks: false }))).toHaveLength(0)
  const copied: string[] = []
  const tree = renderReply(t, parseMarkdown(code), p, { columns: 80, marks: false, onCopy: x => copied.push(x) })
  const [button] = buttons(tree) as unknown as { props: { onPress: (press: { surface: string }) => void } }[]
  button!.props.onPress({ surface: 'terminal' })
  expect(copied).toEqual(['ls -la'])
})

test('the hint stays within budget and ASCII', async () => {
  expect(HINT.length).toBeLessThanOrEqual(350)
  expect(/^[\x20-\x7e]*$/.test(HINT)).toBe(true)
})
