// Mermaid diagrams and ```figure blocks drawn as colored text, after
// prismantis 0.40.0 (mermaid.tsx, figure.tsx), MIT, Copyright (c) 2026 Nahum
// Litvin; the drawing itself is vendor/mermaid-text.js (beautiful-mermaid,
// patched by prismantis). See THIRD_PARTY.md. What is glass's: the art is
// kept as rows of runs tagged with a palette slot, and render.ts paints
// them with the live palette, so a /config palette change recolors them.
// Glyphs are written as escapes so hooks/ stays ASCII.
import { ganttText, pieText } from './charts'
import type { ChartArt } from './charts'
import type { Palette } from './palette'
import { renderMermaidAscii, setChartSize } from './vendor/mermaid-text.js'
import { cellWidth } from './width'

// a color the painter asks the palette for
export type Slot = 'line' | 'text' | 'arrow' | 'num' | 'dot' | 'bar' | 'barTop' | 'accent' | 'warn' | 'ok' | 'note' | 'dim' | 'strong' | `h${number}`
export type ArtRun = { text: string; slot: Slot }
export type Art = { rows: ArtRun[][]; width: number }

export const FIGURE_ROLES = ['accent', 'warn', 'ok', 'note', 'dim', 'strong'] as const
type FigureRole = (typeof FIGURE_ROLES)[number]

const MAX_LINES = 80
const MAX_SOURCE = 8000
const FIGURE_MAX_LINES = 80
const PAD = '\ufdd0'

// the colors a diagram's boxes, series and slices cycle through
export function diagramPalette(p: Palette): string[] {
  return [...new Set([p.sub, p.cmd, p.str, p.heading3, p.flag, p.num, p.accent])]
}

export function slotColor(p: Palette, slot: Slot): string | undefined {
  switch (slot) {
    case 'line':
      return p.meta
    case 'text':
      return p.calloutText
    case 'arrow':
    case 'accent':
      return p.accent
    case 'num':
      return p.num
    case 'dot':
      return p.faint
    case 'bar':
      return p.sub
    case 'barTop':
      return p.heading3
    case 'warn':
      return p.warn
    case 'ok':
      return p.ok
    case 'note':
      return p.heading3
    case 'dim':
      return p.faint
    case 'strong':
      return p.bold
    default: {
      const pal = diagramPalette(p)
      return pal[Number(slot.slice(1)) % pal.length]
    }
  }
}

// a small cache that forgets its oldest entry
function remember<V>(cache: Map<string, V>, key: string, make: () => V, max = 48): V {
  if (cache.has(key)) return cache.get(key)!
  const v = make()
  cache.set(key, v)
  if (cache.size > max) cache.delete(cache.keys().next().value!)
  return v
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
const graphemes = (s: string): string[] => (segmenter ? [...segmenter.segment(s)].map(g => g.segment) : [...s])
// a row as one entry per terminal column: a wide glyph is followed by ''
const cells = (s: string): string[] => graphemes(s).flatMap(g => (cellWidth(g) === 2 ? [g, ''] : [g]))

const BLOCK = /[\u2588\u2580\u2584]/
const PART = /[\u2590\u258f\u258e\u258d\u258c\u258b\u258a\u2589]/
const LINE = /[\u2500-\u257f\u25c7\u258f]/
const ARROW = /[\u25ba\u25c4\u25b2\u25bc]/

// ---- mermaid ---------------------------------------------------------------

// the chart's drawing area: grows with the terminal, floored by its labels
export function chartSize(columns: number, source = ''): { width: number; height: number } {
  const labels = (/^\s*x-axis\b[^[\n]*\[([^\]\n]*)\]/m.exec(source)?.[1] ?? '').split(',').map(s => s.trim().replace(/^"|"$/g, ''))
  const fit = labels.length * (Math.max(...labels.map(l => l.length)) + 2)
  const width = Math.max(24, Math.min(60, Math.max(Math.floor(columns / 6), fit), columns - 12))
  return { width, height: Math.max(8, Math.min(20, Math.round(width * 0.3))) }
}

// a wide glyph counts one cell to the vendored drawer: give it a pad cell
const padWide = (source: string) => (/^[\x00-\x7F]*$/.test(source) ? source : graphemes(source).map(g => (g.length === 1 && cellWidth(g) === 2 ? g + PAD : g)).join(''))

const unquoteCategories = (source: string) =>
  source.replace(/^(\s*x-axis\b[^[\n]*\[)([^\]\n]*)\]/m, (_, head: string, items: string) => `${head}${items.replace(/"([^"]*)"/g, (_q, s: string) => s.replaceAll(',', ' '))}]`)

// the value above each bar of a one-series chart
function labelBars(art: string, source: string): string {
  const series = source.match(/^\s*(bar|line)\b.*$/gm) ?? []
  const values = /^\s*bar\b[^[\n]*\[([^\]\n]*)\]/m.exec(source)?.[1]?.split(',').map(v => v.trim())
  if (series.length !== 1 || !values || /^\s*xychart(-beta)?\s+horizontal/m.test(source)) return art
  const grid = ['', ...art.split('\n')].map(l => [...l])
  const gutter = (r: number) => /^\s*(-?[\d.]+)[\u2524\u253c]/.exec(grid[r]?.join('') ?? '')?.[1]
  const axis = grid.findLastIndex((_, r) => gutter(r) !== undefined)
  const ticks = [...(grid[axis]?.join('') ?? '').matchAll(/\u252c|\u2580+/g)].map(m => m.index + Math.floor(m[0].length / 2))
  if (ticks.length !== values.length) return art
  const zero = grid.findIndex((_, r) => gutter(r) === '0')
  const top = grid.findIndex((_, r) => gutter(r) !== undefined)
  const base = zero !== -1 ? zero : gutter(top)?.startsWith('-') ? top : axis
  ticks.forEach((x, k) => {
    const filled = grid.flatMap((row, r) => (BLOCK.test(row[x] ?? '') ? [r] : []))
    const y = Number(values[k]) < 0 ? (filled.at(-1) ?? base) + 1 : (filled[0] ?? base) - 1
    const text = [...values[k]!]
    const bar = grid[filled[0] ?? -1] ?? []
    let [left, right] = [x, x]
    while (BLOCK.test(bar[left - 1] ?? '')) left--
    while (BLOCK.test(bar[right + 1] ?? '')) right++
    const from = left + Math.ceil((right - left + 1 - text.length) / 2)
    const row = y < axis ? grid[y] : undefined
    if (!row) return
    while (row.length < from + text.length) row.push(' ')
    if (!text.every((_, i) => /[ \u00b7]/.test(row[from + i] ?? ' '))) return
    text.forEach((ch, i) => (row[from + i] = ch))
  })
  return grid.map(row => row.join('').trimEnd()).join('\n').replace(/^\n/, '')
}

const SIDEWAYS = /^(\s*(?:flowchart|graph)[ \t]+)(LR|RL)\b/
const SUPPORTED = /^(flowchart|graph|statediagram(-v2)?|xychart(-beta)?|sequencediagram|classdiagram|erdiagram|pie|gantt)$/i
const kindOf = (source: string) => source.replace(/^(\s*%%[^\n]*\n)+/, '').trim().split(/\s/)[0] ?? ''

const OWN: Record<string, (source: string, columns: number, colors: number) => ChartArt | null> = {
  pie: (source, columns, colors) => pieText(source, false, columns, colors),
  gantt: (source, columns) => {
    const text = ganttText(source, false, columns)
    return text === null ? null : { text }
  },
}

const INLINE_TAG = /<\/?(?:b|i|u|s|em|strong|del|code|small|sub|sup|span|mark)\b[^<>\n]*>/gi
const prepared = (padded: string) => unquoteCategories(padded.replace(/^(\s*%%[^\n]*\n)+/, '')).replace(/(-->|-\.->|==>|---|-\.-|===)[ \t]+\|/g, '$1|')

const NEUTRAL = '#808080'
const PROBE = { fg: NEUTRAL, border: NEUTRAL, line: NEUTRAL, arrow: NEUTRAL, corner: NEUTRAL, junction: NEUTRAL, accent: '#ff0000', bg: '#000000' }
const SGR = /\x1b\[([\d;]*)m/g

// which series owns each cell of a chart with a legend: the drawer is asked
// for truecolor once, and each distinct color it used is one series
function seriesOf(colored: string): number[][] {
  const hues = colored.split('\n').map(line => {
    const row: (string | undefined)[] = []
    let hue: string | undefined
    let at = 0
    const take = (text: string) => graphemes(text).forEach(() => row.push(hue))
    for (const m of line.matchAll(SGR)) {
      take(line.slice(at, m.index))
      hue = m[1]!.startsWith('38;2;') && m[1] !== '38;2;128;128;128' ? m[1] : undefined
      at = m.index + m[0].length
    }
    take(line.slice(at))
    return row
  })
  const legend = hues.find(row => row.some(Boolean)) ?? []
  const order = [...new Set(legend.filter((h): h is string => h !== undefined))]
  return hues.map(row => row.map(h => (h === undefined ? -1 : order.indexOf(h))))
}

function chartSeries(source: string, columns: number): number[][] | undefined {
  if (!/^\s*xychart/.test(source) || (source.match(/^\s*(bar|line)\b/gm) ?? []).length < 2) return undefined
  const padded = padWide(source)
  const size = chartSize(columns, padded)
  try {
    setChartSize(size.width, size.height)
    return seriesOf(renderMermaidAscii(prepared(padded), { useAscii: false, colorMode: 'truecolor', theme: PROBE, paddingX: 3, paddingY: 1 }))
  } catch {
    return undefined
  }
}

function draw(source: string, columns: number): string | null {
  const isChart = /^\s*xychart/.test(source)
  const padded = padWide(source)
  const size = chartSize(columns, isChart ? padded : '')
  try {
    if (isChart) setChartSize(size.width, size.height)
    const art = renderMermaidAscii(prepared(padded), { useAscii: false, colorMode: 'none', paddingX: 3, paddingY: 1 })
      .replace(/[ \t]+$/gm, '')
      .trimEnd()
      .replace(/\u25b6/g, '\u25ba')
      .replace(/\u25c0/g, '\u25c4')
    return (isChart ? labelBars(art, padded) : art.split('\n').filter(l => !/^[\s\u2502|]*$/.test(l)).join('\n')).replaceAll(PAD, '')
  } catch {
    return null
  }
}

const artWidth = (art: string) => Math.max(...art.split('\n').map(cellWidth))

function mermaidChart(source: string, columns: number, pieColors: number): ChartArt | null {
  source = source.replace(INLINE_TAG, '')
  if (source.length > MAX_SOURCE || source.split('\n').length > MAX_LINES) return null
  const kind = kindOf(source)
  if (!SUPPORTED.test(kind)) return null
  const own = OWN[kind.toLowerCase()]
  if (own) return own(source, columns, pieColors)
  const art = draw(source, columns)
  const text = art === null || artWidth(art) <= columns - 2 || !SIDEWAYS.test(source) ? art : (draw(source.replace(SIDEWAYS, '$1TD'), columns) ?? art)
  return text === null ? null : { text, series: chartSeries(source, columns) }
}

const EDGE_LABEL = /(-[-.=]+\s*)"([^"\n]+)"(\s*[-.=]+>)|\|([^|\n]+)\|/g

function cap(label: string, max: number): string {
  const flat = label.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()
  const chars = graphemes(flat)
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '\u2026' : flat
}

// a wide flowchart gets its edge labels cut, so it may fit the terminal
export const shortenEdgeLabels = (source: string, max: number): string =>
  source.replace(EDGE_LABEL, (_, open, quoted, close, piped) => (quoted !== undefined ? `${open}"${cap(quoted, max)}"${close}` : `|${cap(piped, max)}|`))

// each cell's slot: a box takes the next palette color by its label, a bar
// by its place, a legend series by its owner; lines, arrows and numbers
// have their own
function paint(art: string, series?: number[][]): { grid: string[][]; slots: Slot[][] } {
  const grid = art.split('\n').map(cells)
  const cell = (r: number, c: number) => grid[r]?.[c] ?? ''
  const slots: (Slot | undefined)[][] = grid.map(row => row.map(() => undefined))
  const labels = new Map<string, Slot>()
  const rects: { r: number; c: number; r2: number; c2: number }[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (!/[\u250c\u256d(]/.test(cell(r, c))) continue
      let c2 = c + 1
      while (/[\u2500\u252c\u2534\u253c\u25b2\u25bc]/.test(cell(r, c2))) c2++
      if (!/[\u2510\u256e)]/.test(cell(r, c2)) || c2 === c + 1) continue
      let r2 = r + 1
      while (/[\u2502\u251c\u2524\u253c\u25ba\u25c4]/.test(cell(r2, c))) r2++
      if (!/[\u2514\u2570(]/.test(cell(r2, c)) || !/[\u2518\u256f)]/.test(cell(r2, c2))) continue
      rects.push({ r, c, r2, c2 })
    }
  }
  const inside = (a: (typeof rects)[number], b: (typeof rects)[number]) => a !== b && b.r > a.r && b.r2 < a.r2 && b.c > a.c && b.c2 < a.c2
  for (const box of rects.filter(a => !rects.some(b => inside(a, b)))) {
    const { r, c, r2, c2 } = box
    const label = grid.slice(r + 1, r2).map(row => row.slice(c + 1, c2).join('')).join(' ').trim()
    if (!labels.has(label)) labels.set(label, `h${labels.size}`)
    const slot = labels.get(label)!
    for (let y = r; y <= r2; y++) for (let x = c; x <= c2; x++) if (cell(y, x).trim()) slots[y]![x] = slot
  }
  const bars = [...new Set(grid.flatMap(row => row.flatMap((ch, c) => (BLOCK.test(ch) && row[c - 1] !== ch ? [c] : []))))].sort((a, b) => a - b)
  const ends = bars.map(x => {
    const row = grid.find(row => BLOCK.test(row[x] ?? ''))!
    let end = x
    while (row[end + 1] === row[x]) end++
    return end
  })
  const tops = bars.map(x => {
    const r = grid.findIndex(row => BLOCK.test(row[x] ?? ''))
    return r * 2 + (grid[r]![x] === '\u2584' ? 1 : 0)
  })
  // bars far apart are one series: the tallest stands out, the rest are quiet
  const single = bars.length > 1 && bars.every((x, i) => i === 0 || x - ends[i - 1]! > 2)
  const barSlot = (i: number): Slot => (single ? (tops[i] === Math.min(...tops) ? 'barTop' : 'bar') : `h${i}`)
  const barStart = (row: string[], c: number): number => {
    const ch = row[c] ?? ''
    const solid = BLOCK.test(ch) ? ch : PART.test(ch) && row[c + 1] === '\u2588' ? '\u2588' : PART.test(ch) && row[c - 1] === '\u2588' ? '\u2588' : ''
    if (!solid) return -1
    let start = BLOCK.test(ch) ? c : row[c + 1] === '\u2588' ? c + 1 : c - 1
    while (row[start - 1] === solid) start--
    return start
  }
  series?.forEach((row, r) => row.forEach((owner, c) => owner >= 0 && grid[r]?.[c]?.trim() && (slots[r]![c] = `h${owner}`)))
  grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      if (slots[r]![c] !== undefined) return
      const start = barStart(row, c)
      if (start >= 0) slots[r]![c] = barSlot(bars.indexOf(start))
      else if (ch === '\u00b7') slots[r]![c] = 'dot'
      else if (ARROW.test(ch)) slots[r]![c] = 'arrow'
      else if (LINE.test(ch)) slots[r]![c] = 'line'
      else if (/^\d+[\u2524\u253c]/.test(row.slice(c).join(''))) slots[r]![c] = 'num'
      else slots[r]![c] = 'text'
    }),
  )
  return { grid, slots: slots as Slot[][] }
}

// a row of cells as runs of one slot; a wide glyph's '' cell adds nothing
function runsOf(chars: string[], slots: Slot[]): ArtRun[] {
  const runs: ArtRun[] = []
  chars.forEach((ch, i) => {
    const slot = slots[i] ?? 'text'
    const last = runs.at(-1)
    if (last && last.slot === slot) last.text += ch
    else runs.push({ text: ch, slot })
  })
  return runs
}

function artOf(chart: ChartArt): Art {
  const { grid, slots } = paint(chart.text, chart.series)
  // a pie's slice owners replace the guessed slots
  const rows = grid.map((row, r) => runsOf(row, chart.slices ? row.map((_, c) => (chart.slices![r]?.[c] ?? -1) < 0 ? 'text' : (`h${chart.slices![r]![c]}` as Slot)) : slots[r]!))
  return { rows, width: artWidth(chart.text) }
}

const drawn = new Map<string, Art | null>()

/**
 * A mermaid source as colored rows, or null when it cannot be drawn within
 * `columns` (an unknown kind, a parse failure, too wide): the caller keeps
 * the plain code card then.
 */
export function mermaidArt(source: string, columns: number): Art | null {
  return remember(drawn, `${columns}:${source}`, () => {
    const colors = 7
    for (const max of [Infinity, 24, 12]) {
      const chart = mermaidChart(max === Infinity ? source : shortenEdgeLabels(source, max), columns, colors)
      if (chart === null) return null
      if (artWidth(chart.text) > columns - 2) continue
      return artOf(chart)
    }
    return null
  })
}

// ---- figure ----------------------------------------------------------------

const MARKUP = new RegExp(`\\{(${FIGURE_ROLES.join('|')}):([^{}]*)\\}`, 'g')
const isRole = (name: string | undefined): name is FigureRole => FIGURE_ROLES.some(role => role === name)
// the text forms of the two arrows that may draw as emoji
const textForm = (text: string) => text.replace(/[\u25b6\u25c0]/g, g => (g === '\u25b6' ? '\u25ba' : '\u25c4'))

/** a figure line as runs: `{warn:text}` becomes a run of the `warn` slot */
export function figureRuns(line: string): ArtRun[] {
  const runs: ArtRun[] = []
  let at = 0
  for (const match of line.matchAll(MARKUP)) {
    const [whole, role, text = ''] = match
    if (match.index > at) runs.push({ text: textForm(line.slice(at, match.index)), slot: 'text' })
    if (text && isRole(role)) runs.push({ text: textForm(text), slot: role })
    at = match.index + whole.length
  }
  if (at < line.length) runs.push({ text: textForm(line.slice(at)), slot: 'text' })
  return runs
}

/** a figure line as drawn, markup gone */
export const figureText = (line: string): string => figureRuns(line).map(r => r.text).join('')

const figures = new Map<string, Art | null>()

/**
 * A figure block as colored rows; null when it does not fit `columns`, has
 * too many lines or a control character: the caller keeps a plain card.
 */
export function figureArt(source: string, columns: number): Art | null {
  return remember(figures, `${columns}:${source}`, () => {
    const lines = source.replace(/\t/g, '    ').split('\n')
    while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop()
    while (lines.length > 0 && !lines[0]!.trim()) lines.shift()
    if (lines.length === 0 || lines.length > FIGURE_MAX_LINES) return null
    const rows = lines.map(figureRuns)
    const widest = Math.max(...rows.map(r => cellWidth(r.map(x => x.text).join(''))))
    if (widest > columns - 2) return null
    return { rows, width: widest }
  })
}
