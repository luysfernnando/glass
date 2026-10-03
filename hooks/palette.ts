// Colors are raw hex; `Text.color` takes a theme key or a raw color.
export type Palette = {
  cmd: string
  sub: string
  flag: string
  str: string
  path: string
  op: string
  num: string
  var: string
  url: string
  comment: string
  /** inline code that is not a shell command */
  code: string
  /** H1 and H2 */
  heading: string
  /** H3 and deeper */
  heading3: string
  /** the reply bullet */
  accent: string
  /** list markers: dot, ring and the open task box */
  bullet: string
  /** ordered list numbers */
  orderedNum: string
  /** heading rules, table borders, horizontal rules */
  rule: string
  /** the thin bar down a quote's left edge */
  quoteBar: string
  /** success: status dots, the done task mark, ok words in output */
  ok: string
  err: string
  warn: string
  /** bold prose, brighter than the dimmed terminal fg */
  bold: string
  /** tint for code cards and the Bottom line card: one visible step above the terminal bg */
  blockBg: string
  /** tool name in a tool row header */
  tool: string
  /** Bottom line callout: bar + title, then the three labels and row text */
  calloutBar: string
  verified: string
  issue: string
  fix: string
  calloutText: string
  /** Claude's own planning note (a paragraph opening with Private), drawn italic */
  private: string
  /** gutter mark beside a paragraph that asks something of the reader */
  mark: string
  /** one step under prose: times, counts, durations, the subject of a done tool row */
  meta: string
  /** scaffolding: tree connectors, folds, hints */
  faint: string
  /** the tint a tree row takes under the pointer */
  rowHover: string
  /** the user row's diamond and name */
  accentUser: string
  /** glass's own code highlighter: keywords, calls, types, strings, numbers */
  codeKw: string
  codeFn: string
  codeType: string
  codeStr: string
  codeNum: string
  /** row tints in a diff: an added line, a removed line */
  addBg: string
  delBg: string
}

export type PaletteName = 'tidepool' | 'codex' | 'rose' | 'undertow' | 'water'

// The owner's own nvim theme, ~/Documents/codes/packages/tidepool.nvim,
// hybrid variant: lifted content over muted scaffolding. Mapped by role:
// strings -> olive, constants/raw -> pine, functions -> iris, builtins -> foam,
// links/dirs -> mint, operators quiet, errors -> love, warn -> gold.
const tidepool: Palette = {
  cmd: '#d2bdff', // iris: the verb of the line, as functions are
  sub: '#6cc0e5', // foam: builtins
  flag: '#96bdff', // parameter blue
  str: '#9cce8b', // olive
  path: '#d6b477', // gold_soft: a warm, calm color of its own, so paths never read as links
  op: '#56738a', // muted operator, by design quiet
  num: '#7bc0ae', // lifted pine
  var: '#6cc0e5', // foam: builtin variables
  url: '#7aa2f7', // mint underline
  comment: '#86a8a8',
  code: '#7bc0ae', // @markup.raw = pine
  heading: '#9cce8b', // olive: the owner's pick over the theme's iris for H2
  heading3: '#e9b873', // @markup.heading.3 = gold
  accent: '#6cc0e5', // foam
  bullet: '#7aa2b5', // punctuation
  orderedNum: '#7aa2b5',
  rule: '#48708c', // muted: line numbers, folds
  quoteBar: '#7bc0ae', // lifted pine: colored, but quieter than foam
  ok: '#9cce8b', // olive
  err: '#e67680', // love
  warn: '#e9b873', // gold
  bold: '#c5d8e6',
  blockBg: '#0e2a3a', // one visible step above the bg (1.23:1)
  tool: '#d083e8', // rose: tags
  calloutBar: '#6cc0e5', // foam
  verified: '#9cce8b', // olive
  issue: '#e67680', // love
  fix: '#d2bdff', // iris
  calloutText: '#c5d8e6',
  private: '#486e6e', // the teal the owner set as CLAUDE_HL_PRIVATE
  mark: '#9cce8b', // olive, the owner's green
  meta: '#7aa2b5', // punctuation
  faint: '#48708c', // muted
  rowHover: '#0e2a3a', // the block tint
  accentUser: '#7bc0ae', // lifted pine
  codeKw: '#7aa2f7', // mint blue: the owner's pick from the engine's reply fence
  codeFn: '#9cce8b', // olive
  codeType: '#7bc0ae', // pine
  codeStr: '#e67680', // love
  codeNum: '#7bc0ae', // pine
  addBg: '#0e2a3a', // the band tint, not a green: the marker and its color say added (colorblind-safe, owner's pick 2026-10-03)
  delBg: '#241c2a', // a dim plum, apart from the band on the blue-violet axis
}

// Read off the frames of Empryo's v3 desktop (the X post of 2026-10-02):
// a dark blue-grey ground, sea-glass green for the live thing, dusty rose
// for errors, cyan for the brand marks. Empryo's own `proxysoul-undertow`
// theme is not public, so every value is a sample, not a token.
const undertow: Palette = {
  cmd: '#8fd3e8', // the brand cyan, lifted
  sub: '#9ab3a8', // sea-glass
  flag: '#c9a7e0', // dusty violet
  str: '#d4c38a', // sand
  path: '#d6b477', // gold
  op: '#6b6e78',
  num: '#9ab3a8',
  var: '#8fd3e8',
  url: '#5ec8d8',
  comment: '#8a8d94',
  code: '#9ab3a8',
  heading: '#e7e6e9',
  heading3: '#c9ccd3',
  accent: '#5ec8d8', // the brand cyan: the assistant mark, the band
  bullet: '#8a8d94',
  orderedNum: '#8a8d94',
  rule: '#3c4043',
  quoteBar: '#9ab3a8',
  ok: '#4fd1a0',
  err: '#e85c6b', // dusty rose
  warn: '#e8a04c',
  bold: '#ffffff',
  blockBg: '#1c1e23',
  tool: '#5ec8d8',
  calloutBar: '#5ec8d8',
  verified: '#4fd1a0',
  issue: '#e85c6b',
  fix: '#c9a7e0',
  calloutText: '#e7e6e9',
  private: '#52535c',
  mark: '#4fd1a0',
  meta: '#8a8d94',
  faint: '#52535c',
  rowHover: '#1e2024',
  accentUser: '#4fd1a0',
  codeKw: '#5ec8d8', // the brand cyan
  codeFn: '#8fd3e8',
  codeType: '#e8a04c',
  codeStr: '#9ab3a8', // sea-glass
  codeNum: '#e8a04c',
  addBg: '#1b2a2f', // Empryo's own row band
  delBg: '#2a2126',
}

// Empryo's `proxysoul-water` theme, exact: the tokens of PROXYSOUL_WATER
// over PROXYSOUL_MAIN in Empryo's src/core/theme/tokens.ts (read
// 2026-10-02). Empryo has no shell-token colors, so the kinds are mapped
// by role onto its brand set: brand for the verb, brandAlt for builtins
// and raw, brandSecondary for flags, warning for paths, amber for
// strings. Text steps are its textPrimary, textSecondary and textMuted;
// textDim is kept for rules only, since textFaint vanishes off Empryo's
// own near-black ground.
const water: Palette = {
  cmd: '#00a2ce', // brand
  sub: '#3bb8d8', // brandAlt
  flag: '#009a8b', // brandSecondary
  str: '#e65f2a', // amber
  path: '#a4a1e8', // periwinkle: water's secondary-text hue with the saturation lifted, so paths sit apart from the cyan code and the mint ok (owner's pick 2026-10-03; sea glass #6ec9ab blurred into both)
  op: '#8e8ca1', // textSecondary
  num: '#3bb8d8', // info
  var: '#009a8b',
  url: '#00a2ce',
  comment: '#8e8ca1',
  code: '#3bb8d8',
  heading: '#e7e7ee', // textPrimary
  heading3: '#3bb8d8',
  accent: '#00a2ce', // accentAssistant
  bullet: '#8e8ca1',
  orderedNum: '#8e8ca1',
  rule: '#3d3b50', // textDim
  quoteBar: '#009a8b',
  ok: '#4fd1a0', // lifted: Empryo's success #0b8b00 is mud on a dark ground
  err: '#e85c6b', // the dusty rose of Empryo's desktop; its #ee0b2a glares
  warn: '#de7c00', // warning
  bold: '#e7e7ee',
  blockBg: '#0e2a3a', // Empryo's bgElevated #0e1a22 is 1.04:1 on night-owl's ground; this is the 1.23:1 step the other palettes use
  tool: '#00a2ce',
  calloutBar: '#00a2ce',
  verified: '#4fd1a0',
  issue: '#e85c6b',
  fix: '#3bb8d8',
  calloutText: '#d4d4dc', // a step under textPrimary, so the labels lead
  private: '#6e6c82', // as faint
  mark: '#009a8b',
  meta: '#8e8ca1', // textSecondary
  faint: '#6e6c82', // textMuted lifted one step: #5c5a6e is 2.7:1 on night-owl's ground
  rowHover: '#0e2a3a', // same step; Empryo's brandDim #0e2030 is 1.11:1 here
  accentUser: '#009a8b',
  codeKw: '#00a2ce',
  codeFn: '#3bb8d8',
  codeType: '#de7c00',
  codeStr: '#e65f2a',
  codeNum: '#3bb8d8',
  addBg: '#0e2a3a',
  delBg: '#241c2a',
}

// Every palette spells out every key: no shared block, so a theme reads whole.
export const PALETTES: Record<PaletteName, Palette> = {
  tidepool,
  undertow,
  water,
  // One Dark, as claude-hl's THEME_CODEX carried it, filled out by role:
  // cyan for the marks and bars, the gutter greys from the theme's own
  // comment and line-number steps.
  codex: {
    cmd: '#6fb3ff',
    sub: '#7fc8b8',
    flag: '#e78fc7',
    str: '#e5c07b',
    path: '#56b6c2',
    op: '#6fb3ff',
    num: '#d19a66',
    var: '#98c379',
    url: '#6fb3ff',
    comment: '#7a9a9a',
    code: '#e5c07b',
    heading: '#c678dd',
    heading3: '#e5c07b', // the theme's yellow, under the purple H2
    accent: '#c678dd',
    bullet: '#7a9a9a',
    orderedNum: '#7a9a9a',
    rule: '#7a9a9a',
    quoteBar: '#7fc8b8', // the sub teal, apart from the purple headings
    ok: '#98c379',
    err: '#e06c75',
    warn: '#e5c07b',
    bold: '#dcdfe4', // the theme's fg, lifted
    blockBg: '#0e2a3a', // the one visible step above the night-owl ground
    tool: '#c678dd',
    calloutBar: '#56b6c2', // cyan
    verified: '#98c379',
    issue: '#e06c75',
    fix: '#c678dd',
    calloutText: '#dcdfe4',
    private: '#4b6a6a', // a teal step under the comment grey
    mark: '#98c379',
    meta: '#8a97a8', // the theme's line-number grey, lifted
    faint: '#4f5b6b', // its gutter grey
    rowHover: '#0e2a3a',
    accentUser: '#98c379',
    codeKw: '#c678dd',
    codeFn: '#61afef',
    codeType: '#e5c07b',
    codeStr: '#98c379',
    codeNum: '#d19a66',
    addBg: '#0e2a3a',
    delBg: '#241c2a',
  },
  // Rose Pine, as claude-hl's THEME_ROSE carried it, filled out from the
  // theme's own set: foam for the marks and bars, iris for the fix, gold
  // for H3, subtle and muted for the two grey steps.
  rose: {
    cmd: '#9ccfd8',
    sub: '#c4a7e7',
    flag: '#ebbcba',
    str: '#f6c177',
    path: '#e0def4',
    op: '#9ccfd8',
    num: '#ea9a97',
    var: '#eb6f92',
    url: '#9ccfd8',
    comment: '#6e6a86',
    code: '#c4a7e7',
    heading: '#c4a7e7',
    heading3: '#f6c177', // gold
    accent: '#c4a7e7',
    bullet: '#6e6a86',
    orderedNum: '#908caa', // subtle
    rule: '#6e6a86',
    quoteBar: '#9ccfd8', // foam
    ok: '#3e8fb0', // pine
    err: '#eb6f92', // love
    warn: '#f6c177',
    bold: '#e0def4', // text
    blockBg: '#0e2a3a',
    tool: '#c4a7e7',
    calloutBar: '#9ccfd8', // foam
    verified: '#9ccfd8', // the theme has no green; foam reads as calm
    issue: '#eb6f92',
    fix: '#c4a7e7', // iris
    calloutText: '#e0def4',
    private: '#6e6a86', // muted
    mark: '#9ccfd8',
    meta: '#908caa', // subtle
    faint: '#6e6a86', // muted
    rowHover: '#0e2a3a',
    accentUser: '#9ccfd8',
    codeKw: '#31748f',
    codeFn: '#ebbcba',
    codeType: '#9ccfd8',
    codeStr: '#f6c177',
    codeNum: '#ea9a97',
    addBg: '#0e2a3a',
    delBg: '#241c2a',
  },
}

export function paletteNamed(name: unknown): Palette {
  if (name === 'codex' || name === 'rose' || name === 'undertow' || name === 'water') return PALETTES[name]
  return PALETTES.tidepool
}
