// Every non-ASCII glyph the mod draws, built from code points. The agent
// tool path has dropped private-use literals on the way into a file before
// (the pill caps once shipped as ''), so no glyph outside printable ASCII
// is ever written as a literal in hooks/, comments included. Verify with:
//   grep -rnP "[^\x00-\x7F]" hooks/   -> must print nothing
const cp = (n: number) => String.fromCodePoint(n)

export const G = {
  /** reply and tool-row bullet: BLACK CIRCLE FOR RECORD, U+23FA */
  bullet: cp(0x23fa),
  /** card and quote bar: LEFT HALF BLOCK, U+258C */
  bar: cp(0x258c),
  /** gutter mark beside a paragraph that needs the reader: LEFT ONE QUARTER BLOCK, U+258E */
  mark: cp(0x258e),
  /** rules and table header line: BOX DRAWINGS LIGHT HORIZONTAL, U+2500 */
  rule: cp(0x2500),
  /** list markers: BULLET U+2022, WHITE BULLET U+25E6, BALLOT BOX U+2610, BALLOT BOX WITH CHECK U+2611 */
  dot: cp(0x2022),
  ring: cp(0x25e6),
  box: cp(0x2610),
  check: cp(0x2611),
  /** footer separator: MIDDLE DOT, U+00B7 */
  middot: cp(0x00b7),
  /** Nerd Font powerline rounds, the optional pill caps: U+E0B6 left, U+E0B4 right */
  capL: cp(0xe0b6),
  capR: cp(0xe0b4),
  /** HORIZONTAL ELLIPSIS, U+2026 */
  ellipsis: cp(0x2026),
}
