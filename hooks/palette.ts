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
  /**
   * gutter mark beside a paragraph that asks something of the reader: the
   * palette's warn, never ok (it is not "done") and never a bar's color
   * (the quote and Bottom line bars are the same glyph)
   */
  mark: string
  /** one step under prose: times, counts, durations, the subject of a done tool row */
  meta: string
  /** scaffolding: tree connectors, folds, hints */
  faint: string
  /** the tint a tree row takes under the pointer */
  rowHover: string
  /** the user row's diamond and name */
  accentUser: string
  /**
   * the prompt box border in the palette's theme, where it should not be
   * `accentUser`; left out, the box takes the person's color (0.14.0)
   */
  promptBorder?: string
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

export type PaletteName = 'tidepool' | 'codex' | 'rose' | 'undertow' | 'water' | 'crimson' | 'tarnish' | 'overprint' | 'ironbow' | 'lagoon' | 'iris' | 'tangerine' | 'prism'

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
  private: '#486e6e', // the teal the owner picked for private notes
  mark: '#e9b873', // warn (gold): a gutter mark reads "read this", apart from ok and the bars
  meta: '#7aa2b5', // punctuation
  faint: '#48708c', // muted
  rowHover: '#0e2a3a', // the block tint
  accentUser: '#7bc0ae', // lifted pine
  codeKw: '#7aa2f7', // mint blue: the owner's pick from the engine's reply fence
  codeFn: '#d2bdff', // iris, the verb's color (0.5.3; olive was both `ok` and the new codeStr)
  codeType: '#7bc0ae', // pine
  codeStr: '#9cce8b', // olive, as a string in prose or a shell fence (0.5.3; love was `err`, so a TS string read as an error)
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
  rule: '#4e5258', // 2.4:1 (0.5.3; #3c4043 was 1.8:1)
  quoteBar: '#9ab3a8',
  ok: '#4fd1a0',
  err: '#e85c6b', // dusty rose
  warn: '#e8a04c',
  bold: '#ffffff',
  blockBg: '#262a31', // 1.3:1, the floor the spec asks (0.5.3; #1c1e23 was 1.13:1)
  tool: '#5ec8d8',
  calloutBar: '#5ec8d8',
  verified: '#4fd1a0',
  issue: '#e85c6b',
  fix: '#c9a7e0',
  calloutText: '#e7e6e9',
  private: '#6a6c76',
  mark: '#e8a04c', // warn
  meta: '#8a8d94',
  faint: '#6a6c76', // 3.6:1 (0.5.3; #52535c was 2.5:1, under the 3:1 a faint step needs)
  rowHover: '#2a2f38', // a step above blockBg (0.5.3; #1e2024 was invisible beside it)
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
  path: '#948ff0', // periwinkle: water's secondary-text hue with the saturation lifted, so paths sit apart from the cyan code, the mint ok and the grey body text (owner's pick 2026-10-03; #a4a1e8 sat too near the text, sea glass #6ec9ab blurred into code and ok)
  op: '#8e8ca1', // textSecondary
  num: '#3bb8d8', // info
  var: '#009a8b',
  url: '#6fb0ff', // sky, underlined: a link apart from the brand cyan that tool, cmd and accent share (0.5.3; five roles on one hex)
  comment: '#8e8ca1',
  code: '#3bb8d8',
  heading: '#e7e7ee', // textPrimary
  heading3: '#3bb8d8',
  accent: '#00a2ce', // accentAssistant
  bullet: '#8e8ca1',
  orderedNum: '#8e8ca1',
  rule: '#5a5870', // textDim lifted: #3d3b50 is 1.69:1 on night-owl's ground and the rules vanished
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
  mark: '#de7c00', // warn: the teal it had was the quote bar's, the same glyph
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
  delBg: '#33222e', // lifted from #241c2a (1.11:1) toward SPEC's 1.2:1 tint floor
}

// Empryo's crimson world ("the heart"), read off empryo.com's own CSS
// (`:root[data-world=crimson][data-theme=dark]`, 2026-10-16). The desktop
// theme `proxysoul-crimson` is not in Empryo's public tokens.ts yet, so
// these are the site's tokens mapped by role as water's are: the pigment
// for the verb, the violet alt for builtins and raw, the pink nucleus for
// flags, amber for strings. Text steps are its ink, ink-soft and ink-faint.
const crimson: Palette = {
  cmd: '#f43a6b', // pigment: the crimson itself
  sub: '#ab7bf0', // pigment-alt: violet
  flag: '#ffb3c8', // nucleus: the pink
  str: '#f2a94c', // the site's warn, as water's amber
  path: '#8fb6e6', // soft sky: the one cool hue the world lacks, so paths sit apart from the crimson verb, the violet code, the pink flags and the amber strings
  op: '#9a8499', // ink-faint
  num: '#ab7bf0', // info
  var: '#ffb3c8',
  url: '#6fa8ff', // sky, underlined, a step brighter than path
  comment: '#9a8499',
  code: '#ab7bf0',
  heading: '#f6eaf1', // ink
  heading3: '#ab7bf0',
  accent: '#f43a6b',
  bullet: '#9a8499',
  orderedNum: '#9a8499',
  rule: '#664468', // the site's #3f2040 is 1.34:1 on the audit ground; lifted to 2.4:1
  quoteBar: '#ffb3c8',
  ok: '#45c98d',
  err: '#ff6a52', // bad: the site's orange-red, apart from the crimson verb
  warn: '#f2a94c',
  bold: '#f6eaf1',
  blockBg: '#301a34', // pigment-deep #2c1022 is 1.09:1 on the audit ground; this is the 1.2:1 step
  tool: '#f43a6b',
  calloutBar: '#f43a6b',
  verified: '#45c98d',
  issue: '#ff6a52',
  fix: '#ab7bf0',
  calloutText: '#dccbd8', // a step under ink
  private: '#7a6679', // as faint
  mark: '#f2a94c', // warn
  meta: '#9a8499', // ink-faint
  faint: '#7a6679', // 3.6:1, between rule and meta
  rowHover: '#3a1f3e', // a step above blockBg
  accentUser: '#ffb3c8',
  codeKw: '#f43a6b',
  codeFn: '#ab7bf0',
  codeType: '#ffb3c8',
  codeStr: '#f2a94c',
  codeNum: '#ab7bf0',
  addBg: '#301a34', // the plum tint, as the other palettes use their band tint
  delBg: '#3a2420', // a dim ember toward `bad`, apart from the plum
}

// glass's own palette (0.11.0), not a port: metals aging. Fresh copper is
// the verb, Claude's mark and the tool name (what is happening now); the
// verdigris it weathers to is the settled things: builtins, raw code, the
// done mark's green cousin, the user's row, the card tint; brass for
// strings, the steel blue of old blades for paths and links, and the violet
// sheen on tarnished silver for flags and variables. Every value was placed
// in OKLCH (one lightness band for the shell kinds, L 0.74-0.83, and one
// chroma step between a role and its quieter twin) and read against the
// audit ground #0d1117 and night-owl #011627; text is bone, a warm
// off-white, never pure.
const tarnish: Palette = {
  cmd: '#e9934c', // copper, L0.74 C0.135 h58
  sub: '#6fcabf', // verdigris, L0.78 C0.09 h185
  flag: '#bea3df', // tarnish, L0.76 C0.09 h305
  str: '#e5c370', // brass, L0.83 C0.11 h88
  path: '#82bad5', // steel, L0.76 C0.07 h230
  op: '#90847a', // a warm grey, quiet by design
  num: '#6fcabf', // verdigris, as raw code
  var: '#bea3df', // tarnish, with the flags
  url: '#7ac8f5', // steel lifted, underlined
  comment: '#928b83',
  code: '#6fcabf',
  heading: '#e5ddd0', // bone
  heading3: '#e5c370', // brass, under the bone H2
  accent: '#e9934c', // copper: Claude's mark, the band
  bullet: '#928b83',
  orderedNum: '#928b83',
  rule: '#405853', // 2.5:1
  quoteBar: '#60afa5', // verdigris a step under sub
  ok: '#67d283', // the green verdigris weathers toward; apart from sub by hue (150 vs 185)
  err: '#f66c6d', // oxblood lifted
  warn: '#f4a437', // amber: more chroma than the brass strings, apart by 18 degrees
  bold: '#efe7d9', // bone, brighter
  blockBg: '#1b2827', // 1.24:1, a dark verdigris
  tool: '#e9934c',
  calloutBar: '#e9934c',
  verified: '#67d283',
  issue: '#f66c6d',
  fix: '#bea3df',
  calloutText: '#d8d0c3', // bone soft
  private: '#5d6d69', // as faint
  mark: '#f4a437', // warn
  meta: '#928b83', // warm grey, 5.6:1
  faint: '#5d6d69', // 3.5:1
  rowHover: '#223130', // a step above the card
  accentUser: '#6fcabf', // the person is the settled one; Claude the copper
  codeKw: '#e9934c',
  codeFn: '#82bad5',
  codeType: '#bea3df',
  codeStr: '#e5c370',
  codeNum: '#6fcabf',
  addBg: '#1b2827', // the verdigris tint
  delBg: '#34211e', // a dark copper, apart from it by hue
}

// glass's own (0.12.0): Risograph inks on black paper. The fluorescent
// inks of a riso print, as the ink charts list them: fluorescent pink for
// the verb, Claude's mark and the headings, aqua for builtins and the
// person's row, fluorescent yellow for flags and numbers, orange strings,
// violet paths, fluorescent green for done, scarlet for failed. The tints
// are an ink overprinted on black: a deep violet card, a wine removed row,
// a teal added row. Loud by design; the owner approved the pink headings.
const overprint: Palette = {
  cmd: '#ff48b0',  // fluorescent pink
  sub: '#5ec8e5',  // aqua
  flag: '#ffe800',  // fluorescent yellow
  str: '#ff6c2f',  // orange
  path: '#9d7ad2',  // violet
  op: '#8f93a0',
  num: '#ffe800',
  var: '#ffe800',
  url: '#62a8e5',
  comment: '#8f93a0',
  code: '#5ec8e5',
  heading: '#ff48b0',
  heading3: '#ffe800',
  accent: '#ff48b0',
  bullet: '#8f93a0',
  orderedNum: '#8f93a0',
  rule: '#4a4f7a',  // indigo, 2.4:1
  quoteBar: '#5ec8e5',
  ok: '#44d62c',  // fluorescent green
  err: '#f65058',  // scarlet
  warn: '#ffb511',  // sunflower
  bold: '#f2f0e6',  // the paper
  blockBg: '#241b45',  // violet ink on black, 1.2:1
  tool: '#ff48b0',
  calloutBar: '#ff48b0',
  verified: '#44d62c',
  issue: '#f65058',
  fix: '#9d7ad2',
  calloutText: '#f2f0e6',
  private: '#5e6390',
  mark: '#ffb511',
  meta: '#8f93a0',
  faint: '#5e6390',  // indigo lifted, 3.3:1
  rowHover: '#2e2458',
  accentUser: '#5ec8e5',
  codeKw: '#ff48b0',
  codeFn: '#5ec8e5',
  codeType: '#ffe800',
  codeStr: '#ff6c2f',
  codeNum: '#9d7ad2',
  addBg: '#0f2a33',  // teal ink on black
  delBg: '#47163a',  // wine ink on black
}

// glass's own (0.12.0): the thermal camera's ironbow gradient, violet
// through magenta, red, orange and yellow to white-hot, with heat standing
// for activity. The verb, Claude's mark and the tool name are yellow, the
// hottest text; builtins orange; flags magenta; strings violet; paths the
// cold blue; headings white-hot. Done is cold, so the status dots and the
// Verified label are blue, not green, and failure is the one red. Placed
// in OKLCH along the gradient (L 0.66 to 0.88 for the shell kinds).
const ironbow: Palette = {
  cmd: '#f9d544',  // yellow, L0.88 h95
  sub: '#fe8c2c',  // orange, h55
  flag: '#e45cbe',  // magenta, h340
  str: '#b093e5',  // violet, h300
  path: '#6b8fe2',  // cold blue, h265
  op: '#8b798f',
  num: '#fe8c2c',
  var: '#e45cbe',
  url: '#77a4f6',
  comment: '#9d8ba2',
  code: '#fe8c2c',
  heading: '#faf5e6',  // white-hot
  heading3: '#f9d544',
  accent: '#f9d544',
  bullet: '#9d8ba2',
  orderedNum: '#9d8ba2',
  rule: '#584b6f',
  quoteBar: '#9274c3',
  ok: '#769cef',  // cold: settled, apart from sub by the whole gradient
  err: '#fc4447',  // the one red
  warn: '#fe8c2c',  // orange, as sub: the mark is never a bar color
  bold: '#faf5e6',
  blockBg: '#282136',  // the cold tint
  tool: '#f9d544',
  calloutBar: '#e45cbe',  // magenta, apart from the orange mark
  verified: '#769cef',
  issue: '#fc4447',
  fix: '#b093e5',
  calloutText: '#e3decf',
  private: '#6d6382',
  mark: '#fe8c2c',
  meta: '#9d8ba2',
  faint: '#6d6382',
  rowHover: '#312941',
  accentUser: '#b093e5',
  codeKw: '#f9d544',
  codeFn: '#fe8c2c',
  codeType: '#e45cbe',
  codeStr: '#b093e5',
  codeNum: '#6b8fe2',
  addBg: '#282136',
  delBg: '#3b1c1c',  // red-black
}

// glass's own (0.13.0): daylight shallows, where water is the night sea.
// Turquoise leads (the verb, Claude's mark, the band, the bar), sky is the
// secondary for code and the person's row, flags are hibiscus, strings sun
// yellow, paths sand, headings and bold white sand; done is palm green,
// failed coral, the card tint deep water. Placed in OKLCH, L 0.76 to 0.88
// for the shell kinds, the brightest band of any palette here.
const lagoon: Palette = {
  cmd: '#40e5e5',  // turquoise, L0.84 h195
  sub: '#70d5ed',  // sky, h215
  flag: '#f786be',  // hibiscus, h350
  str: '#f2d76c',  // sun yellow, h95
  path: '#e3cead',  // sand, h80
  op: '#7e989c',
  num: '#70d5ed',
  var: '#f786be',
  url: '#60ccfc',
  comment: '#7e989c',
  code: '#70d5ed',
  heading: '#f2eee3',  // white sand
  heading3: '#f2d76c',
  accent: '#40e5e5',
  bullet: '#7e989c',
  orderedNum: '#7e989c',
  rule: '#3a5c5e',  // 2.6:1
  quoteBar: '#30b4ad',
  ok: '#87d576',  // palm green
  err: '#fd7562',  // coral
  warn: '#ffa44e',  // mango
  bold: '#f6f2e7',
  blockBg: '#12292c',  // deep water, 1.24:1
  tool: '#40e5e5',
  calloutBar: '#40e5e5',
  verified: '#87d576',
  issue: '#fd7562',
  fix: '#f786be',
  calloutText: '#e2ded3',
  private: '#547275',
  mark: '#ffa44e',
  meta: '#7e989c',
  faint: '#547275',  // 3.6:1
  rowHover: '#1b3235',
  accentUser: '#70d5ed',
  codeKw: '#40e5e5',
  codeFn: '#70d5ed',
  codeType: '#f786be',
  codeStr: '#f2d76c',
  codeNum: '#e3cead',
  addBg: '#12292c',
  delBg: '#36201c',
}

// glass's own (0.13.0): the flower. Indigo petals lead (the verb, Claude's
// mark, the band, the bar), the teal of the leaf's underside is the
// secondary for code and the person's row, the beard is honey so strings
// are honey; flags and `fix` orchid, paths sky, done leaf green, failed a
// rose red. The neutrals carry an indigo cast, so the card tint and the
// rules go violet-grey, which is what moves the page away from the blues.
// Placed in OKLCH, L 0.74 to 0.82 for the shell kinds.
const iris: Palette = {
  cmd: '#92a2ff',  // indigo petal, L0.74 C0.14 h275
  sub: '#63ccc0',  // teal, h185
  flag: '#d997d2',  // orchid, h330
  str: '#e6bd77',  // honey, h80
  path: '#7dc3de',  // sky, h225
  op: '#888b99',
  num: '#63ccc0',
  var: '#d997d2',
  url: '#98bcff',
  comment: '#888b99',
  code: '#63ccc0',
  heading: '#e2e4ef',  // lavender white
  heading3: '#e6bd77',
  accent: '#92a2ff',
  bullet: '#888b99',
  orderedNum: '#888b99',
  rule: '#4c5169',  // 2.4:1
  quoteBar: '#44a49e',
  ok: '#75d78d',  // leaf green
  err: '#f56b7c',  // rose red
  warn: '#f0a646',  // amber
  bold: '#e9eaf5',
  blockBg: '#202436',  // indigo tint, 1.2:1
  tool: '#92a2ff',
  calloutBar: '#92a2ff',
  verified: '#75d78d',
  issue: '#f56b7c',
  fix: '#d997d2',
  calloutText: '#d5d7e2',
  private: '#64687b',
  mark: '#f0a646',
  meta: '#888b99',
  faint: '#64687b',  // 3.4:1
  rowHover: '#292c40',
  accentUser: '#63ccc0',
  codeKw: '#92a2ff',
  codeFn: '#63ccc0',
  codeType: '#d997d2',
  codeStr: '#e6bd77',
  codeNum: '#7dc3de',
  addBg: '#202436',
  delBg: '#351f22',
}

// glass's own (0.14.0): a warm lead on water's cool set, from a brief of
// "crimson's vibrance, water's cyan, tarnish's warmth". Tangerine is the
// verb, the tool name, keywords and the Bottom line bar; orange is cyan's
// complement, so it pops without the edge-vibration a saturated red has on
// a navy ground (crimson in this seat bled; rose pink and violet were
// drawn too and turned down). Water's cyan keeps Claude's mark, the band
// and its tint, and the builtins; the person's row, flags and quote bars
// are crimson's pink, paths water's periwinkle, strings lemon so they sit
// apart from the lead, failed a rose red.
const tangerine: Palette = {
  cmd: '#ff9248',  // tangerine
  sub: '#3bb8d8',  // water's brandAlt
  flag: '#ffb3c8',  // crimson's nucleus pink
  str: '#ecd06f',  // lemon
  path: '#948ff0',  // water's periwinkle
  op: '#8e8ca1',
  num: '#3bb8d8',
  var: '#ffb3c8',
  url: '#6fb0ff',
  comment: '#8e8ca1',
  code: '#3bb8d8',
  heading: '#e7e7ee',
  heading3: '#ffb3c8',
  accent: '#00a2ce',  // water's brand: Claude's mark, the band
  bullet: '#8e8ca1',
  orderedNum: '#8e8ca1',
  rule: '#5a5870',
  quoteBar: '#ffb3c8',
  ok: '#4fd1a0',
  err: '#ff5c7a',  // rose red, apart from the orange lead
  warn: '#ecd06f',
  bold: '#e7e7ee',
  blockBg: '#0e2a3a',  // water's card tint, 1.23:1
  tool: '#ff9248',
  calloutBar: '#ff9248',
  verified: '#4fd1a0',
  issue: '#ff5c7a',
  fix: '#3bb8d8',
  calloutText: '#d4d4dc',
  private: '#6e6c82',
  mark: '#ecd06f',  // warn
  meta: '#8e8ca1',
  faint: '#6e6c82',
  rowHover: '#143444',  // a step above the card
  accentUser: '#ffb3c8',
  codeKw: '#ff9248',
  codeFn: '#3bb8d8',
  codeType: '#ffb3c8',
  codeStr: '#ecd06f',
  codeNum: '#948ff0',
  addBg: '#0e2a3a',
  delBg: '#33222e',
}

// glass's own (0.14.0), from the owner's starship prompt: the
// `gradient_modern` palette of ~/.config/starship.toml, each color in the
// role its prompt segment plays. Coral (color_1, the username segment) is
// the person's row, flags and types; deep orange (color_2, the directory)
// paths; golden yellow (color_3, git) strings; emerald teal (color_4, the
// toolchains) builtins and raw code; vibrant blue (color_5) the verb, tool
// and keywords; soft purple (color_6, the clock) Claude's mark, the band,
// the Bottom line bar and the prompt box. The bright four are the prompt
// character's states: success neon green for done, error red for failed,
// vim-command yellow for warn and the mark; the last orange is H3; white
// (color_fg0) headings and bold. The two dark greys are left out: bg1 is
// 1.09:1 on night-owl's ground, and the owner chose water's tints over bg3
// for the cards and diff rows. The neutral steps are greys, as the prompt
// has none.
const prism: Palette = {
  cmd: '#4d96ff',  // color_5 vibrant blue
  sub: '#43b581',  // color_4 emerald teal
  flag: '#ff6b6b',  // color_1 coral
  str: '#e6c229',  // color_3 golden yellow
  path: '#e28f2a',  // color_2 deep orange
  op: '#8a8a8a',
  num: '#43b581',
  var: '#ff6b6b',
  url: '#7fb3ff',  // the blue lifted, underlined
  comment: '#8a8a8a',
  code: '#43b581',
  heading: '#ffffff',  // color_fg0
  heading3: '#ff9f1a',  // color_10
  accent: '#8c6ff0',  // color_6 soft purple
  bullet: '#8a8a8a',
  orderedNum: '#8a8a8a',
  rule: '#565656',  // 2.5:1
  quoteBar: '#43b581',
  ok: '#32ff7e',  // color_8, the success symbol
  err: '#e84118',  // color_7, the error symbol
  warn: '#fff200',  // color_9, the vim command symbol
  bold: '#ffffff',
  blockBg: '#0e2a3a',  // water's card tint
  tool: '#4d96ff',
  calloutBar: '#8c6ff0',
  verified: '#32ff7e',
  issue: '#e84118',
  fix: '#8c6ff0',
  calloutText: '#dcdcdc',
  private: '#6c6c6c',
  mark: '#fff200',  // warn
  meta: '#9a9a9a',
  faint: '#6c6c6c',  // 3.5:1
  rowHover: '#0e2a3a',  // as water
  accentUser: '#ff6b6b',  // color_1, the username segment
  promptBorder: '#8c6ff0',  // the band's purple, the owner's pick over the person's coral
  codeKw: '#4d96ff',
  codeFn: '#43b581',
  codeType: '#ff6b6b',
  codeStr: '#e6c229',
  codeNum: '#8c6ff0',
  addBg: '#0e2a3a',  // water's tints
  delBg: '#33222e',
}

// Every palette spells out every required key: no shared block, so a theme reads whole.
export const PALETTES: Record<PaletteName, Palette> = {
  tidepool,
  undertow,
  water,
  crimson,
  tarnish,
  overprint,
  ironbow,
  lagoon,
  iris,
  tangerine,
  prism,
  // One Dark, filled out by role:
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
    rule: '#5f7a7a', // a step under meta (0.5.3; the comment grey outranked faint, so table rules beat tree connectors)
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
    mark: '#e5c07b', // warn
    meta: '#8a97a8', // the theme's line-number grey, lifted
    faint: '#62707f', // its gutter grey lifted to 3.7:1 (0.5.3; #4f5b6b was 2.7:1)
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
  // Rose Pine, filled out from the
  // theme's own set: foam for the marks and bars, iris for the fix, gold
  // for H3, subtle and muted for the two grey steps.
  rose: {
    cmd: '#9ccfd8',
    sub: '#c4a7e7',
    flag: '#c4a7e7', // iris (0.5.3; rose went to paths)
    str: '#f6c177',
    path: '#ebbcba', // rose: warm, apart from `bold` (0.5.3; text #e0def4 made a path read as plain bold)
    op: '#9ccfd8',
    num: '#ea9a97',
    var: '#f6c177', // gold with the strings (0.5.3; love was `err`, so $VAR read as an error)
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
    ok: '#5aa5c4', // pine lifted (0.5.3; #3e8fb0 sat a step from codeKw's pine, so done read as a keyword)
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
    mark: '#f6c177', // warn: the foam it had was both bars'
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

/** the palette's name from the option's value: one of the thirteen, tidepool for anything else */
export function paletteNameOf(name: unknown): PaletteName {
  if (name === 'codex' || name === 'rose' || name === 'undertow' || name === 'water' || name === 'crimson' || name === 'tarnish' || name === 'overprint' || name === 'ironbow' || name === 'lagoon' || name === 'iris' || name === 'tangerine' || name === 'prism') return name
  return 'tidepool'
}

export function paletteNamed(name: unknown): Palette {
  return PALETTES[paletteNameOf(name)]
}
