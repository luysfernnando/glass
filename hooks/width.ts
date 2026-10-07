// Terminal cell widths, mirroring the engine's ruler: Claude Code lays out
// with Bun.stringWidth(s, { ambiguousIsNarrow: true }). Every width in the
// mod (table columns, heading rules, ordered gutters) goes through this so
// the tree and the layout engine agree per glyph. Standalone: the hook
// environment has no Bun. ASCII-only source; glyphs come from code points.
//
// The rules below were read off Bun 1.3 (2026-10-07, /tmp probe against
// Bun.stringWidth): a grapheme is summed per code point, marks (Mn, Me, Mc)
// and the invisible formats (ZWJ, ZWNJ, bidi marks, BOM, tags) count 0, a
// VS16 lifts a one-cell Emoji-property base (digits, #, *, (c), the
// text-default symbols) to 2, a keycap is 1, a flag pair is 1, a ZWJ
// sequence counts its head, and a jamo vowel or tail after a head counts 0.
const cp = (n: number) => String.fromCodePoint(n)
const VS16 = 0xfe0f
const ZWJ = 0x200d
const KEYCAP = 0x20e3
const SGR = new RegExp(cp(0x1b) + '\\[[0-9;]*m', 'g')
const MARK = /^[\p{Mn}\p{Me}\p{Mc}]$/u
const EMOJI = /^\p{Emoji}$/u
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

// East Asian Wide and Fullwidth ranges the Emoji_Presentation property does
// not already cover (assigned code points; Bun follows EastAsianWidth.txt)
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3041, 0x3247],
  [0x3250, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x17000, 0x187f7],
  [0x18800, 0x18cd5],
  [0x18d00, 0x18d08],
  [0x1aff0, 0x1affe],
  [0x1b000, 0x1b122],
  [0x1b132, 0x1b132],
  [0x1b150, 0x1b152],
  [0x1b155, 0x1b155],
  [0x1b164, 0x1b167],
  [0x1b170, 0x1b2fb],
  [0x1f200, 0x1f202],
  [0x1f210, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f250, 0x1f251],
  [0x1f260, 0x1f265],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
]

function isWide(c: number): boolean {
  return WIDE.some(([lo, hi]) => c >= lo && c <= hi)
}

// the format characters Bun counts as nothing; the other Cf (a soft hyphen,
// a word joiner, the bidi controls) take a cell there. The Thai and Lao
// SARA AM and the halfwidth voiced marks sit in Bun's zero table too.
function isInvisible(c: number): boolean {
  return (c >= 0x200b && c <= 0x200f) || c === 0xfeff || (c >= 0xe0000 && c <= 0xe007f) || c === 0xe33 || c === 0xeb3 || c === 0xff9e || c === 0xff9f
}

const isRegional = (c: number) => c >= 0x1f1e6 && c <= 0x1f1ff
const isModifier = (c: number) => c >= 0x1f3fb && c <= 0x1f3ff
// a jamo vowel or tail: one cell alone, none after a head or a syllable
const isJamoTail = (c: number) => (c >= 0x1160 && c <= 0x11ff) || (c >= 0xd7b0 && c <= 0xd7ff)

function codePointWidth(c: number): number {
  if (c < 0x20 || (c >= 0x7f && c < 0xa0)) return 0
  if (isInvisible(c) || isModifier(c)) return 0
  const s = cp(c)
  if (MARK.test(s)) return 0
  if (EMOJI_PRESENTATION.test(s) || isWide(c)) return 2
  return 1
}

function graphemeWidth(g: string): number {
  const points = [...g].map(ch => ch.codePointAt(0)!)
  const head = points[0]
  if (head === undefined) return 0
  if (points.includes(KEYCAP)) return 1
  if (isRegional(head)) return 1
  let n = 0
  for (let i = 0; i < points.length; i++) {
    const c = points[i]!
    if (c === ZWJ) break
    let w = codePointWidth(c)
    // a selector lifts a one-cell Emoji-property base to the emoji form
    if (w === 1 && points[i + 1] === VS16 && EMOJI.test(cp(c))) w = 2
    if (i > 0 && isJamoTail(c)) w = 0
    n += w
  }
  return n
}

/** cells `s` takes on the terminal, SGR escapes ignored */
export function cellWidth(s: string): number {
  const clean = s.replace(SGR, '')
  if (segmenter) {
    let n = 0
    for (const { segment } of segmenter.segment(clean)) n += graphemeWidth(segment)
    return n
  }
  let n = 0
  for (const ch of clean) n += graphemeWidth(ch)
  return n
}

// HORIZONTAL ELLIPSIS, U+2026, as glyphs.ts has it (width.ts stays standalone)
const ELLIPSIS = cp(0x2026)

/** the longest head of `s` within `n` cells */
function headCells(s: string, n: number): string {
  let out = ''
  for (const ch of s) {
    if (cellWidth(out + ch) > n) break
    out += ch
  }
  return out
}

/** the longest tail of `s` within `n` cells */
function tailCells(s: string, n: number): string {
  const chars = [...s]
  let out = ''
  for (let i = chars.length - 1; i >= 0; i--) {
    if (cellWidth(chars[i] + out) > n) break
    out = chars[i] + out
  }
  return out
}

/** cut to `n` cells in the middle: the head and the tail stay, an ellipsis between */
export function clipMiddle(s: string, n: number): string {
  if (cellWidth(s) <= n) return s
  if (n <= 0) return ''
  const head = Math.ceil((n - 1) / 2)
  return headCells(s, head) + ELLIPSIS + tailCells(s, n - 1 - head)
}

/** a path cut to `n` cells, its file name kept whole when it fits: `hooks/...render.ts` */
export function clipPath(s: string, n: number): string {
  if (cellWidth(s) <= n) return s
  const base = s.slice(s.lastIndexOf('/') + 1)
  if (base === s || cellWidth(base) + 2 > n) return clipMiddle(s, n)
  return headCells(s, n - cellWidth(base) - 2) + ELLIPSIS + '/' + base
}
