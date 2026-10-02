// Terminal cell widths, mirroring the engine's ruler: Claude Code lays out
// with Bun.stringWidth(s, { ambiguousIsNarrow: true }). Every width in the
// mod (table columns, heading rules, ordered gutters) goes through this so
// the tree and the layout engine agree per glyph. Standalone: the hook
// environment has no Bun. ASCII-only source; glyphs come from code points.
const cp = (n: number) => String.fromCodePoint(n)
const VS16 = cp(0xfe0f)
const SGR = new RegExp(cp(0x1b) + '\\[[0-9;]*m', 'g')
const ZERO = new RegExp('^[\\p{Mn}\\p{Me}\\p{Cf}\\p{Zl}\\p{Zp}]$', 'u')
const EMOJI_PRESENTATION = new RegExp('\\p{Emoji_Presentation}', 'u')
const PICTOGRAPHIC = new RegExp('^\\p{Extended_Pictographic}$', 'u')

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

// East Asian Wide and Fullwidth ranges
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
]

function isWide(c: number): boolean {
  return WIDE.some(([lo, hi]) => c >= lo && c <= hi)
}

function graphemeWidth(g: string): number {
  const first = g.codePointAt(0)
  if (first === undefined) return 0
  const head = String.fromCodePoint(first)
  if (ZERO.test(head) || first < 0x20 || (first >= 0x7f && first < 0xa0)) return 0
  // a regional-indicator pair (a flag) measures 1 in the engine
  if (first >= 0x1f1e6 && first <= 0x1f1ff) return 1
  if (g.includes(VS16) && PICTOGRAPHIC.test(head)) return 2
  if (EMOJI_PRESENTATION.test(g)) return 2
  if (isWide(first)) return 2
  return 1
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
