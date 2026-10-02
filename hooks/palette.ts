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
  /** heading rules, table borders, quote bars, horizontal rules */
  rule: string
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
}

export type PaletteName = 'tidepool' | 'codex' | 'rose'

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
}

// Tuned to the night-owl terminal: bg #011627, fg #94a4b6. Callout colors
// are the ones claude-hl settled on (CLAUDE_HL_BOTTOM_LINE in the zshrc).
const SHARED = {
  bold: '#d6deeb',
  blockBg: '#0e2a3a',
  calloutBar: '#5eead4',
  verified: '#bef264',
  issue: '#ff9e8a',
  fix: '#f0abfc',
  calloutText: '#d6deeb',
  orderedNum: '#8b5ba6',
  heading3: '#d6deeb',
  private: '#486e6e',
  mark: '#bef264',
}

// Same values as claude-hl's THEME_CODEX / THEME_ROSE, so the look carries over.
export const PALETTES: Record<PaletteName, Palette> = {
  tidepool,
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
    accent: '#c678dd',
    bullet: '#7a9a9a',
    rule: '#7a9a9a',
    ok: '#98c379',
    err: '#e06c75',
    warn: '#e5c07b',
    tool: '#c678dd',
    ...SHARED,
  },
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
    accent: '#c4a7e7',
    bullet: '#6e6a86',
    rule: '#6e6a86',
    ok: '#3e8fb0',
    err: '#eb6f92',
    warn: '#f6c177',
    tool: '#c4a7e7',
    ...SHARED,
  },
}

export function paletteNamed(name: unknown): Palette {
  if (name === 'codex' || name === 'rose') return PALETTES[name]
  return PALETTES.tidepool
}
