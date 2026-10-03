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
  /** the engine's tool-output connector: DENTISTRY SYMBOL LIGHT VERTICAL AND BOTTOM LEFT, U+23BF */
  connector: cp(0x23bf),
  /** HORIZONTAL ELLIPSIS, U+2026 */
  ellipsis: cp(0x2026),
  /** tree connectors: BOX DRAWINGS LIGHT VERTICAL AND RIGHT U+251C, UP AND RIGHT U+2514, VERTICAL U+2502 */
  tee: cp(0x251c),
  elbow: cp(0x2514),
  pipe: cp(0x2502),
  /** status marks: CHECK MARK U+2713, BALLOT X U+2717, WHITE CIRCLE U+25CB */
  tick: cp(0x2713),
  cross: cp(0x2717),
  hollow: cp(0x25cb),
  /** FISHEYE U+25C9: the assistant header mark and a folded group */
  fisheye: cp(0x25c9),
  /** BLACK DIAMOND U+25C6: the user row and a band row */
  diamond: cp(0x25c6),
  /** DOTTED CIRCLE U+25CC: the band header */
  dotted: cp(0x25cc),
  /** BLACK SMALL SQUARE U+25AA: the footer */
  square: cp(0x25aa),
  /** BLACK RIGHT-POINTING SMALL TRIANGLE U+25B8, DOWN U+25BE: fold chevrons */
  right: cp(0x25b8),
  down: cp(0x25be),
  /** the band's rounded frame: BOX DRAWINGS LIGHT ARC DOWN AND RIGHT U+256D, DOWN AND LEFT U+256E, UP AND RIGHT U+2570, UP AND LEFT U+256F */
  arcTL: cp(0x256d),
  arcTR: cp(0x256e),
  arcBL: cp(0x2570),
  arcBR: cp(0x256f),
  /** the count sign in `Bash x3`: MULTIPLICATION SIGN U+00D7 */
  times: cp(0xd7),
  /** a status dot: BLACK CIRCLE U+25CF */
  disc: cp(0x25cf),
  /** the agent face's smile: UNDERTIE U+203F */
  smile: cp(0x203f),
  /** action icons: TWO JOINED SQUARES U+29C9 (copy), BULLSEYE U+25CE (review, open), CLOCKWISE OPEN CIRCLE ARROW U+21BB (loop), OCR FORK U+2442 */
  copy: cp(0x29c9),
  eye: cp(0x25ce),
  loop: cp(0x21bb),
  fork: cp(0x2442),
}
