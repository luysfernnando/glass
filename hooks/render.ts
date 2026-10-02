// Draws a parsed reply as an element tree, following SPEC.md: full-width
// prose, one rhythm rule, color-only inline code, two content-fit tinted
// cards, one glyph family (see glyphs.ts), one width ruler (see width.ts).
import type { Elements, RenderElement, RenderNode } from 'claude-code'

import { G } from './glyphs'
import { inlineText } from './markdown'
import type { Align, Block, CalloutRow, Inline, ListItem } from './markdown'
import type { Palette } from './palette'
import { bareWord, isUrl, pathLike } from './paths'
import { isPrivateNote, needsAttention } from './prose'
import { proseSpans, shellSpans } from './shell'
import type { Span, SpanKind } from './shell'
import { cellWidth } from './width'

type Table = Elements['terminal']

type Ctx = {
  t: Table
  p: Palette
  /** the prose measure in cells */
  m: number
  /** the terminal's width */
  columns: number
}

export type RenderOptions = {
  /** draw the bullet that opens a reply */
  bullet: boolean
  columns: number
  /** gutter marks beside paragraphs that need the reader; off when the prompt asked for writing */
  marks: boolean
}

const LABEL_WIDTH = 8
const LABEL_COLOR: Record<string, keyof Palette> = {
  Verified: 'verified',
  Issue: 'issue',
  Fix: 'fix',
}

// the API bounds a Text or Code string at this many characters
const MAX_TEXT = 10000
// a tinted card never gets narrower than this
const CARD_MIN = 60

// inside backticks a path needs a slash or a `:line` suffix:
// `hooks/render.ts:88`, `src/main.rs`, `~/.zshrc`; not `shell.ts`
const PATH_RE = /^(?:~|\.{1,2})?[\w.-]*(?:\/[\w.-]+)+\/?(?::\d+(?::\d+)?)?$|^[\w.-]+\.\w+:\d+(?::\d+)?$/

export function measure(columns: number): number {
  return Math.max(20, columns - 2)
}

// cells a run of inlines takes once drawn
function inlineWidth(inlines: Inline[]): number {
  return inlines.reduce((n, node) => {
    switch (node.kind) {
      case 'text':
      case 'link':
      case 'code':
        return n + cellWidth(node.text)
      default:
        return n + inlineWidth(node.children)
    }
  }, 0)
}

// a card hugs its content: the widest row plus padding, floored, capped
function cardWidth(c: Ctx, content: number): number {
  return Math.min(c.m, Math.max(CARD_MIN, content))
}

export function renderReply(t: Table, blocks: Block[], p: Palette, o: RenderOptions): RenderElement {
  const c: Ctx = { t, p, m: measure(o.columns), columns: o.columns }
  const rows: RenderElement[] = []
  let prev: Block['kind'] | null = null
  blocks.forEach((b, i) => {
    const el = renderBlock(c, b)
    if (i === 0 && o.bullet) {
      // the engine's own message row keeps a blank above the bullet; without
      // it the reply sits glued to the tool output before it
      rows.push(
        t.Box({
          flexDirection: 'row',
          marginTop: 1,
          children: [
            t.Text({ color: p.accent, children: [G.bullet + ' '] }),
            t.Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: [el] }),
          ],
        }),
      )
    } else {
      // one rhythm rule: a blank above every block except the first and any
      // block right under a heading
      const marginTop = i === 0 || prev === 'heading' ? 0 : 1
      // a paragraph that asks something of the reader gets a gutter mark in
      // the two cells every other block leaves blank
      const marked = o.marks && b.kind === 'paragraph' && !isPrivateNote(inlineText(b.inlines)) && needsAttention(inlineText(b.inlines))
      if (marked) {
        rows.push(
          t.Box({
            flexDirection: 'row',
            marginTop,
            children: [t.Text({ color: p.mark, children: [G.mark + ' '] }), t.Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: [el] })],
          }),
        )
      } else {
        rows.push(t.Box({ flexDirection: 'column', marginLeft: 2, marginTop, children: [el] }))
      }
    }
    prev = b.kind
  })
  return t.Box({ flexDirection: 'column', children: rows })
}

function renderBlock(c: Ctx, b: Block): RenderElement {
  const { t, p, m } = c
  switch (b.kind) {
    case 'paragraph': {
      // Claude's own planning note, drawn italic in a quiet color so the
      // real answer stands out
      if (isPrivateNote(inlineText(b.inlines))) {
        return t.Box({ width: m, children: [t.Text({ wrap: 'wrap', italic: true, color: p.private, children: [inlineText(b.inlines)] })] })
      }
      return t.Box({ width: m, children: [t.Text({ wrap: 'wrap', children: renderInlines(c, b.inlines) })] })
    }
    case 'heading':
      return t.Text({
        bold: true,
        color: b.level >= 3 ? p.heading3 : p.heading,
        children: renderInlines(c, b.inlines),
      })
    case 'code':
      return renderFence(c, b.lang, b.source)
    case 'list':
      return renderList(c, b.items)
    case 'rule':
      return t.Text({ color: p.rule, children: [G.rule.repeat(Math.min(m, CARD_MIN))] })
    case 'raw':
      return t.Markdown({ text: b.text.slice(0, MAX_TEXT) })
    case 'quote':
      return renderQuote(c, b.blocks)
    case 'table':
      return renderTable(c, b.header, b.align, b.rows, b.raw)
    case 'callout':
      return renderCallout(c, b.title, b.rows)
  }
}

// tinted card sized to its code: dim language left and line count right in
// the header row, the engine's highlighter below, a gutter once long
function renderFence(c: Ctx, lang: string, source: string): RenderElement {
  const { t, p } = c
  const code = source.replace(/\n$/, '')
  const codeLines = code === '' ? [] : code.split('\n')
  const lines = codeLines.length
  const gutter = lines > 8
  const widest = Math.max(0, ...codeLines.map(cellWidth))
  const header = cellWidth(lang) + (gutter ? cellWidth(`${lines} lines`) + 2 : 0)
  const width = cardWidth(c, Math.max(widest, header) + 2 + (gutter ? String(lines).length + 2 : 0))
  const children: RenderElement[] = []
  if (lang || gutter) {
    children.push(
      t.Box({
        flexDirection: 'row',
        children: [
          t.Text({ dimColor: true, children: [lang ? lang.toUpperCase() : ''] }),
          t.Box({ flexGrow: 1, children: [] }),
          ...(gutter ? [t.Text({ dimColor: true, children: [`${lines} lines`] })] : []),
        ],
      }),
    )
  }
  // the API caps a Code source at MAX_TEXT: split long sources at line
  // boundaries into consecutive elements, the gutter numbering carrying on
  let start = 1
  for (const chunk of chunkLines(code, MAX_TEXT)) {
    children.push(
      t.Code({
        source: chunk,
        ...(lang ? { language: lang } : {}),
        ...(gutter ? { startLine: start } : {}),
      }),
    )
    start += chunk.split('\n').length
  }
  return t.Box({
    flexDirection: 'column',
    width,
    backgroundColor: p.blockBg,
    paddingLeft: 1,
    paddingRight: 1,
    children,
  })
}

function chunkLines(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  let buf = ''
  for (const line of text.split('\n')) {
    const next = buf ? `${buf}\n${line}` : line
    if (next.length > max && buf) {
      out.push(buf)
      buf = line.slice(0, max)
    } else {
      buf = next.length > max ? next.slice(0, max) : next
    }
  }
  if (buf) out.push(buf)
  return out
}

function renderList(c: Ctx, items: ListItem[]): RenderElement {
  const { t, p, m } = c
  const ordered = items.filter(it => /^\d/.test(it.marker))
  const numWidth = Math.max(0, ...ordered.map(it => cellWidth(it.marker)))
  const marker = (it: ListItem): RenderElement => {
    // a done task is the one list mark that gets a color, as in tidepool
    if (it.task === 'done') return t.Text({ color: p.ok, children: [G.check + ' '] })
    if (it.task === 'todo') return t.Text({ color: p.bullet, children: [G.box + ' '] })
    if (/^\d/.test(it.marker)) return t.Text({ color: p.orderedNum, children: [it.marker.padEnd(numWidth) + ' '] })
    return t.Text({ color: p.bullet, children: [(it.depth > 0 ? G.ring : G.dot) + ' '] })
  }
  return t.Box({
    flexDirection: 'column',
    children: items.map(it =>
      t.Box({
        flexDirection: 'row',
        // nested items end at the measure like everything else
        width: Math.max(10, m - it.depth * 2),
        marginLeft: it.depth * 2,
        children: [
          marker(it),
          t.Box({
            flexGrow: 1,
            flexShrink: 1,
            children: [t.Text({ wrap: 'wrap', children: renderInlines(c, it.inlines) })],
          }),
        ],
      }),
    ),
  })
}

function renderQuote(c: Ctx, blocks: Block[]): RenderElement {
  const { t, p, m } = c
  const rows: RenderElement[] = []
  blocks.forEach((b, i) => {
    if (i > 0) rows.push(t.Text({ color: p.rule, children: [G.bar] }))
    rows.push(
      t.Box({
        flexDirection: 'row',
        children: [
          t.Text({ color: p.rule, children: [G.bar + ' '] }),
          t.Box({
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
            width: m - 2,
            children: [renderBlock({ ...c, m: m - 2 }, b)],
          }),
        ],
      }),
    )
  })
  return t.Box({ flexDirection: 'column', children: rows })
}

// row-separator table: bold header, one rule, two-cell gaps, no verticals;
// numeric columns right-align unless the markdown says otherwise; a table
// wider than the terminal falls back to the engine's renderer
function renderTable(c: Ctx, header: Inline[][], align: Align[], rows: Inline[][][], raw: string): RenderElement {
  const { t, p } = c
  const cols = header.length
  const widths = Array.from({ length: cols }, (_, col) =>
    Math.max(1, inlineWidth(header[col] ?? []), ...rows.map(r => inlineWidth(r[col] ?? []))),
  )
  const total = widths.reduce((a, w) => a + w, 0) + 2 * (cols - 1)
  if (total > c.columns - 4) return t.Markdown({ text: raw.slice(0, MAX_TEXT) })
  const numeric = (col: number) =>
    rows.length > 0 && rows.every(r => /^[\d.,]+%?$/.test(inlineText(r[col] ?? [])))
  const cell = (inlines: Inline[], col: number, isHeader: boolean): RenderElement => {
    const pad = Math.max(0, (widths[col] ?? 0) - inlineWidth(inlines))
    const a: Align = align[col] ?? (numeric(col) ? 'right' : 'left')
    const left = isHeader ? 0 : a === 'right' ? pad : a === 'center' ? Math.floor(pad / 2) : 0
    const last = col === cols - 1
    const right = last && left === 0 ? 0 : pad - left
    return t.Text({
      ...(isHeader ? { bold: true, color: p.bold } : {}),
      children: [' '.repeat(left), ...renderInlines(c, inlines), ' '.repeat(right) + (last ? '' : '  ')],
    })
  }
  const line = (cells: Inline[][], isHeader: boolean) =>
    t.Box({
      flexDirection: 'row',
      children: Array.from({ length: cols }, (_, col) => cell(cells[col] ?? [], col, isHeader)),
    })
  return t.Box({
    flexDirection: 'column',
    children: [
      line(header, true),
      t.Text({ color: p.rule, children: [widths.map(w => G.rule.repeat(w)).join('  ')] }),
      ...rows.map(r => line(r, false)),
    ],
  })
}

// lines a run of inlines takes when wrapped at `width`, the way the engine
// wraps: at spaces, a word wider than the line broken across lines
function wrappedLines(inlines: Inline[], width: number): number {
  if (width < 1) return 1
  let lines = 0
  for (const raw of inlineText(inlines).split('\n')) {
    lines++
    let col = 0
    for (const word of raw.split(' ')) {
      const w = cellWidth(word)
      if (w === 0 && col === 0) continue
      const need = col === 0 ? w : col + 1 + w
      if (need <= width) {
        col = need
      } else if (w > width) {
        // a word wider than the line starts on a fresh line and is chopped
        if (col > 0) lines++
        lines += Math.ceil(w / width) - 1
        col = w % width || width
      } else {
        lines++
        col = w
      }
    }
  }
  return lines
}

// The Bottom line card, sized to its longest row. A thin continuous bar
// down the left edge: a quarter-block glyph on every row of the card, the
// row count computed from the same wrapping the engine applies. A line of
// padding above and below, then the label column and the text.
function renderCallout(c: Ctx, title: string, rows: CalloutRow[]): RenderElement {
  const { t, p } = c
  const rowWidth = (r: CalloutRow) => 2 + LABEL_WIDTH + 2 + inlineWidth(r.inlines) + 1
  const width = cardWidth(c, Math.max(2 + cellWidth(title), ...rows.map(rowWidth)))
  const textWidth = width - 2 - LABEL_WIDTH - 2 - 1
  // padding, title, then each row with a blank above it, padding
  const height = 1 + 1 + rows.reduce((n, r) => n + 1 + wrappedLines(r.inlines, textWidth), 0) + 1
  return t.Box({
    flexDirection: 'row',
    width,
    backgroundColor: p.blockBg,
    children: [
      t.Box({ width: 1, children: [t.Text({ color: p.calloutBar, children: [Array(height).fill(G.mark).join('\n')] })] }),
      t.Box({
        flexDirection: 'column',
        flexGrow: 1,
        flexShrink: 1,
        paddingLeft: 1,
        paddingTop: 1,
        paddingBottom: 1,
        children: [
          t.Text({ bold: true, color: p.calloutBar, children: [title] }),
          ...rows.map(r =>
            t.Box({
              flexDirection: 'row',
              // one blank between the rows, so each reads as its own point
              marginTop: 1,
              children: [
                t.Text({ bold: true, color: p[LABEL_COLOR[r.label] ?? 'calloutText'], children: [r.label.padEnd(LABEL_WIDTH) + '  '] }),
                t.Box({
                  flexGrow: 1,
                  flexShrink: 1,
                  paddingRight: 1,
                  children: [t.Text({ color: p.calloutText, wrap: 'wrap', children: renderInlines(c, r.inlines) })],
                }),
              ],
            }),
          ),
        ],
      }),
    ],
  })
}

export type ToolRow = {
  tool: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

// A tool row's header: status dot, tool name, then the call's subject.
// Bash commands are tokenized like inline code, one command per line; file
// tools show their path. The engine stops drawing its own dot once a hook
// draws the row, so the dot is ours and carries the status.
export function renderToolHeader(t: Table, p: Palette, row: ToolRow): RenderElement {
  const { tool, input } = row
  const dot = row.isRunning ? p.comment : row.isErrored || row.isInterrupted ? p.err : p.ok
  const args = (input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : null)
  const head = [t.Text({ color: dot, children: [G.bullet + ' '] }), t.Text({ color: p.tool, children: [tool] }), t.Text({ children: ['  '] })]

  const command = tool === 'Bash' ? str('command') : null
  if (command) {
    const paint = (s: Span): RenderNode => (s.kind === 'plain' ? s.text : t.Text({ color: p[s.kind], children: [s.text] }))
    const lines = splitCommandLines(shellSpans(command, true) ?? [{ text: command, kind: 'plain' }])
    return t.Box({
      flexDirection: 'row',
      children: [
        ...head,
        t.Box({
          flexDirection: 'column',
          flexGrow: 1,
          flexShrink: 1,
          children: lines.map(l => t.Text({ wrap: 'wrap', children: l.map(paint) })),
        }),
      ],
    })
  }

  const path = str('file_path') ?? str('path') ?? str('notebook_path')
  const url = str('url')
  const other = str('pattern') ?? str('query') ?? str('description') ?? str('skill') ?? str('prompt') ?? str('command')
  const subject: RenderNode[] = []
  if (other && !path) subject.push(other)
  if (path) subject.push(t.Text({ color: p.path, children: [path] }))
  if (url) subject.push(t.Text({ color: p.url, underline: true, children: [url] }))
  if (other && path) subject.push(t.Text({ dimColor: true, children: ['  ' + other] }))
  return t.Box({
    flexDirection: 'row',
    children: [...head, t.Box({ flexGrow: 1, flexShrink: 1, children: [t.Text({ wrap: 'wrap', children: subject })] })],
  })
}

// one command per line: break before && and ||, after ;, and at every
// newline the command itself contains
function splitCommandLines(spans: Span[]): Span[][] {
  const flat: Span[] = []
  for (const s of spans) {
    const parts = s.text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) flat.push({ text: '\n', kind: 'plain' })
      if (part) flat.push({ text: part, kind: s.kind })
    })
  }
  const lines: Span[][] = [[]]
  const current = () => lines[lines.length - 1]!
  const hasContent = (l: Span[]) => l.some(x => x.text.trim() !== '')
  for (const s of flat) {
    if (s.text === '\n') {
      if (hasContent(current())) lines.push([])
      continue
    }
    const isChain = s.kind === 'op' && (s.text === '&&' || s.text === '||')
    if (isChain && hasContent(current())) lines.push([])
    current().push(s)
    if (s.kind === 'op' && s.text === ';') lines.push([])
  }
  return lines
    .map(l => {
      while (l.length && l[0]!.text.trim() === '') l.shift()
      while (l.length && l[l.length - 1]!.text.trim() === '') l.pop()
      return l
    })
    .filter(l => l.length > 0)
}

function renderInlines(c: Ctx, inlines: Inline[]): RenderNode[] {
  const { t, p } = c
  return inlines.flatMap((n): RenderNode[] => {
    switch (n.kind) {
      case 'text':
        return renderProse(c, n.text)
      case 'bold':
        return [t.Text({ bold: true, color: p.bold, children: renderInlines(c, n.children) })]
      case 'italic':
        return [t.Text({ italic: true, children: renderInlines(c, n.children) })]
      case 'strike':
        return [t.Text({ strikethrough: true, children: renderInlines(c, n.children) })]
      case 'link':
        return [renderLink(c, n.text, n.href)]
      case 'code':
        return [renderCode(c, n.text)]
    }
  })
}

// Prose outside backticks, painted the way claude-hl painted it: command
// spans once there is evidence (`git push --follow-tags`, never `make
// sure`), then paths and URLs anywhere (`README.md`, `~/.zshrc`,
// `src/main.rs:42` with its line number in the number color).
function renderProse(c: Ctx, text: string): RenderNode[] {
  const { t, p } = c
  const out: RenderNode[] = []
  const spans = proseSpans(text)
  let pos = 0
  const colored = (s: string, kind: SpanKind): RenderNode => (kind === 'plain' ? s : t.Text({ color: p[kind], children: [s] }))
  for (const s of spans) {
    if (s.start > pos) out.push(...renderWords(c, text.slice(pos, s.start)))
    out.push(colored(text.slice(s.start, s.end), s.kind))
    pos = s.end
  }
  if (pos < text.length) out.push(...renderWords(c, text.slice(pos)))
  return out
}

// paths and URLs in a run of plain prose
function renderWords(c: Ctx, text: string): RenderNode[] {
  if (!/[/.@]/.test(text)) return [text]
  const { t, p } = c
  const out: RenderNode[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push(buf)
    buf = ''
  }
  for (const part of text.split(/(\s+)/)) {
    const { lead, word, tail } = bareWord(part)
    if (!word) {
      buf += part
      continue
    }
    if (isUrl(word)) {
      buf += lead
      flush()
      out.push(t.Text({ color: p.url, underline: true, children: [word] }))
      buf += tail
      continue
    }
    const path = pathLike(word)
    if (path) {
      buf += lead
      flush()
      out.push(t.Text({ color: p.path, children: [path.path] }))
      if (path.lineno) out.push(t.Text({ color: p.num, children: [path.lineno] }))
      buf += tail
      continue
    }
    buf += part
  }
  flush()
  return out
}

function renderLink(c: Ctx, label: string, href: string): RenderElement {
  const { t, p } = c
  const styled = t.Text({ color: p.url, underline: true, children: [label] })
  const safe = safeHref(href)
  return safe ? t.Link({ href: safe, children: [styled] }) : styled
}

// the Link element refuses the whole tree on a bad href, so be strict
function safeHref(href: string): string | null {
  try {
    const u = new URL(href)
    const ok = u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost')
    if (!ok || u.username || u.password || u.href.length > 2048) return null
    if (!/^[\x21-\x7e]+$/.test(u.href)) return null
    return u.href
  } catch {
    return null
  }
}

// Inline code is color only, as Claude Desktop and the Codex TUI draw it:
// shell tokens in their kind colors, paths in the path color underlined,
// anything else in the code color. No tint, no padding.
function renderCode(c: Ctx, code: string): RenderElement {
  const { t, p } = c
  const spans = shellSpans(code)
  if (spans) {
    return t.Text({
      children: spans.map(s => (s.kind === 'plain' ? s.text : t.Text({ color: p[s.kind], children: [s.text] }))),
    })
  }
  if (PATH_RE.test(code)) return t.Text({ color: p.path, children: [code] })
  return t.Text({ color: p.code, children: [code] })
}
