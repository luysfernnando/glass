# glass: render spec

The contract for how glass draws Claude Code's transcript on the terminal.
Code follows this file; undocumented deviations are bugs.

One file, one state. This is the consolidated contract as of 0.5.0
(2026-10-11): the pass-by-pass history of 0.1 to 0.4.25 is folded into the
sections it amended, and a rule that was tried and rejected stays as a short
note beside the rule that replaced it, with its date, so nobody re-proposes
it. The previous file is in git history (commit e4cd939, 0.4.25). New rules
for 0.5.0 are marked **(0.5.0)**; an item marked **unverified live** has a
mounted test and awaits a session.

## Objective

Glass is a Claude Code mod (function-hooks plugin) that redraws the
terminal transcript the way a desktop client draws a chat: colored shell
commands in prose, a Bottom line card, content-fit code cards, borderless
tables, gutter marks beside paragraphs that need the reader, prompt and reply bubbles with a hover copy control, one
activity line under each reply that opens into cards, a background
band for live subagents. The owner is its first user; anyone on a dark terminal is its
audience. Engine floor: Claude Code 2.1.295 (0.5.0 reads APIs that arrived
in 2.1.288 to 2.1.295; see Engine floor under 0.5.0).

## Commands

- `claude plugin validate .` — the manifest and the module's source as the
  engine reads them.
- `npx -p typescript tsc -p .` — type-check, after the engine has laid
  `.claude-plugin/types` on a live load (a bare `npx tsc` fetches an
  unrelated package).
- `claude plugin test .` — `tests/*.test.ts` in the engine's sandbox.
- `LC_ALL=C grep -rn '[^ -~]' hooks/` — must print nothing (BSD grep has no
  `-P`).
- `scripts/check.sh` — all of the above plus the manifest version check; CI
  runs it.
- `claude --plugin-dir /path/to/glass` — a session on the working tree.
  Disable the installed copy first: two enabled plugins with one name and
  the engine skips one's hooks (2.1.296 notes it in `/plugin`).
- Release: bump `version` in `.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json` together, commit, `claude plugin tag .`,
  push, `claude plugin update glass@glass`, restart.

## Project structure

```
hooks/
  register.ts   hooks module: every on(...), the atoms, module records
  chrome.ts     turn chrome: bubbles, activity line, call cards, diff card, band
  html.ts       (0.20.0) blocks to HTML and plain text, for the copy formats
  clipboard.ts  (0.20.0) the platform clipboard helpers for text/html
  render.ts     reply blocks: paragraphs, lists, fences, tables, cards
  markdown.ts   the streaming markdown parser (blocks, inline spans)
  shell.ts      command tokenizer, prose command spans, vocabulary
  paths.ts      path and URL detection
  prose.ts      gutter-mark heuristics, write intent
  highlight.ts  fence highlighter
  output.ts     painted tool output lines
  palette.ts    Palette type, the five palettes, paletteNamed
  theme.ts      (0.5.0) palette -> engine theme slots, theme JSON
  width.ts      cellWidth, clip helpers (the one ruler)
  glyphs.ts     every non-ASCII glyph, by code point
  hooks.json    { "modules": ["./register.ts"] }
types/index.d.ts   the $.state contract (PluginState.glass)
tests/             parse.test.ts, chrome.test.ts, (0.5.0) theme.test.ts, demo.test.ts
scripts/check.sh   every check in one run
scripts/paint.ts   (0.10.0) the demo painter: a tree to SGR rows, rows to HTML
scripts/show.ts    the fixtures before and after, painted in the terminal
scripts/readme-shots.ts  (0.10.0) the README's palette screenshots, headless Chrome
scripts/demo-dump.sh     the text dumps under demo/
demo/              (0.5.0) before/ and after/ text dumps for review
docs/shots/        (0.10.0) one demo turn per palette, 100 columns on the owner's ground
.claude-plugin/    plugin.json, marketplace.json, types/ (engine-written, ignored)
```

## Code style

- TypeScript, no build step: the engine loads `hooks/register.ts` as is.
- Every non-ASCII glyph is built with `String.fromCodePoint` in
  `hooks/glyphs.ts`. No literal or `\u` escape outside ASCII anywhere in
  `hooks/`, comments included. (The tool path that writes files has dropped
  private-use glyphs before.)
- One width ruler: `cellWidth()` in `hooks/width.ts`, mirroring the engine's
  `Bun.stringWidth(s, { ambiguousIsNarrow: true })`, Bun 1.3's drift
  included (marks and invisible formats are nothing, a VS16 lifts a
  text-default symbol to two, a jamo tail is nothing, Indic conjuncts sum
  per code point, the wide table gains Tangut and the enclosed ideographic
  block). Never code-point length.
- Loader rules learned live: a helper that takes `$` is a function declared
  at the top of the module, never a closure inside `register`; a streaming
  event's hook is `async function*`; a `Box` with a `hover` style carries a
  `key`, or the validator refuses the tree and the engine draws its own row
  (this hid the event rows for two demos); a `Button` never sits inside a
  `Text`; props are set conditionally, never passed as `undefined`.
- A tree that would be refused reverts the whole message to the engine's
  renderer, so: reply text is normalized on entry (CRLF to LF, C0 controls
  other than tab and newline removed); Text and Code strings stay under
  10000 characters (a longer run goes as several strings in one Text);
  a cut, whether a split or `safeText`'s ellipsis, never splits a
  surrogate pair (0.16.1; the engine fixed the same in its tool output
  previews in 2.1.309); `Link` only gets `https:` or `http://localhost` hrefs. Known limit: a
  reply tree past the engine's 100,000 serialized characters is refused
  whole and drawn by the engine.
- Render hooks for call rows (`ToolUse`, `ToolResult`, `ToolGroup`) read no
  atom: a read in a render hook subscribes the row, and every write then
  redraws every row of the turn, which stranded duplicate rows above the
  viewport (2026-10-03). They read module records written by the hooks
  (call -> turn, call -> wall time, /expand); `/expand`,
  `/collapse` call `$.ui.invalidate('ui.render')`. A
  hot reload empties the records until the next turn. The activity line (it reads the
  open atom) and the `TurnDuration` row subscribe (one row each per span).
- A reply streams with no `ui.render` dispatch: the engine draws the
  streamed text, and glass's `AssistantMessage` hook runs once, as the
  reply ends. On the main screen (tmux by default, `isFullscreen: false`)
  a reply taller than the screen then prints twice, the engine's streamed
  copy left in scrollback above glass's (2026-10-12, 2.1.296, `--debug`
  run). `CLAUDE_CODE_NO_FLICKER=1` puts tmux on the fullscreen layout and
  the duplicate goes (live, 2026-10-12). Handing tall replies back to the
  engine on the main screen was not taken: it drops the styling.
- A finished reply's parse is kept (the newest 64 by text), so resizes and palette changes do not parse every reply again. Links, URLs
  and code words are matched in place.
- Commit subjects name the version and the rule, as the log does:
  `0.4.25: a loaded skill's result is one line`.

## Global

- Measure `M = columns - 2`, full width, recomputed per draw: the reply
  runs as wide as the engine's own tool output, so nothing reads as a hole
  on the right. (A 100-column cap was tried and rejected on a 190-column
  terminal, 2026-10-02. The engine's `maxProseWidth` setting of 2.1.282 is
  not honored, by this decision; revisit only if the owner asks.)
- Rhythm: `marginTop: 1` on every block except the first of a text block
  and any text block right under a heading (a fence, a table or a Bottom
  line under a heading keeps its blank: a tint or a second bold row glued
  to the heading read as one crowded block, 2026-10-11). Never
  `marginBottom`, never spacer
  boxes. The first block of a reply keeps `marginTop: 1`. No reply bullet:
  the assistant header carries it.
- Tint only on the two cards, code fences and the Bottom line (`blockBg`,
  >= 1.2:1 over the terminal bg). Cards hug their content: width = widest
  row plus padding, floor 60 cells, cap M. Inline code has no tint.
- Four text steps: `text` (prose, the terminal's own foreground; not a
  `Palette` key, by design) and the palette keys
  `meta` (times, counts, durations, args of a done row), `faint`
  (connectors, folds, hints, the fence header), `bold`. No `dimColor` in a
  reply: it lands on a different step per terminal theme.
- Never `wrap: 'truncate*'` in the reply body. A width mistake must wrap,
  never lose text. Stated exceptions: call subjects, output lines and
  diagram rows, each named where it lives.
- Hierarchy rule, as Empryo's: bright for the live thing, muted one step for
  the done thing, faint for scaffolding, saturated color only on status
  marks. No key reminders in the transcript (`ctrl+o`, `shift+tab`): the
  hint line, the group rows, the Message row and the diff fold note all
  gave theirs up (0.5.3 for the last two).

## Inline

- Plain text default color, with these prose passes:
  - Command spans in prose paint only with evidence: a known command word
    followed by a flag, path, string, number or operator, or preceded by a
    runner prefix (`Ran`, `$`). `git push --follow-tags` paints; `git
    status` in a sentence, `make sure`, `go ahead` do not. For command
    words that are also plain English (`sleep`, `code`, `time`, `open`,
    `find`...) a bare number is not evidence. Stop words and a
    three-bare-word budget end a span. (`proseSpans` in `hooks/shell.ts`.)
  - Paths anywhere: rooted (`/`, `./`, `../`, `~/`), a known extension by
    any case, a dotfile, a conventional name (`Makefile`, `Dockerfile`),
    router segments in balanced brackets (`app/[id]/page.tsx`), in `path`
    (color only, no underline: the underline is the link's mark); a `:line`
    or `:line:col` suffix in `num`. Paths under the
    session's directory draw relative. URLs (`https`, `ssh://`, `git@`,
    `www.`) in `url` underlined. (`hooks/paths.ts`.)
  - A single quote opens a string only at a word's start, and an apostrophe
    between two letters never closes one (2026-10-03: `diff card's frame`
    painted `diff` as a command and the rest as a string).
- A paragraph opening with `Private` or `Privately` is Claude's own
  planning note: drawn whole, italic, in `private`.
- A paragraph that needs the reader gets a gutter mark: `▎` in `mark`
  (each palette's `warn`: it asks the reader to look, so it is not `ok`'s
  "done", and apart from the quote and callout bars) in the two cells
  other blocks leave blank. Needs the reader = a question mark in prose, an
  imperative opener, or an attention phrase (the tables in
  `hooks/prose.ts`). A `?` inside backticks or a link target never counts.
  Never on list items, headings, code or cards. Off for the whole turn
  when the prompt asked for writing (`write`, `draft`, ... among its first
  six words).
- `**bold**` bold in `bold`. `*italic*` italic. `~~strike~~` strikethrough.
- Links: `https` and `http://localhost` become `Link` with the label in
  `url` underlined; any other href draws as that styled text only.
  `![alt](src)` draws as the link its alt names, the bang gone; a link
  title stays out of the text.
- Inline code is color only, as Claude Desktop and the Codex TUI draw it.
  Contents, in order: a URL whole (no whitespace, an href the Links rule
  takes) as a Link, the span its label, so a wrapped one is one click (the
  engine's renderer does this since 2.1.302); else shell spans when
  `shellSpans()` recognizes a known command head (each token in its kind
  color); else a path in `path`; else `code`. (Tinted pills with padding
  and Nerd Font caps were tried and rejected as noise, 2026-10-02.)
- A U+FE0F after a text-default symbol (U+26A0 and kin) is dropped: the
  terminal draws the emoji form 2 cells while the engine counts 1.
- Streaming: unclosed `` ` ``, `**`, `*`, `[` stay literal. Code colors
  apply on the closing backtick.

## Blocks

- Paragraph: `Box width M` holding one wrapping Text.
- Headings: H1 bold `heading`; H2 bold, one step from `heading` toward
  `meta`; H3 and deeper bold `heading3`. No rules, no `#`. (A trailing rule
  was dropped with the full-width measure: a 188-cell rule is heavy.)
- Lists: markers `•` (top), `◦` (nested), `☐`, `☑`; `☑` in `ok`, the rest in
  `bullet`. Ordered numbers in `orderedNum`, right-aligned to the widest
  marker at their depth, so `9.` and `10.` end on one column. Nesting is
  the rank of an item's indent among the indents seen so far (`1. a` then
  `   - b` is one level down, as CommonMark reads it; `floor(spaces / 2)`
  put a four-space child two levels down). A child's marker sits under its
  parent's text column, so under `1. Install` the `◦` lands under the `I`
  (0.5.2; `depth*2` hung it off the period). Items run to the measure.
  Zero rows between items, except one row each side of a card under an
  item: text touching a tint read as a glitch. A fence indented under an
  item is the item's own block: a card under the item's text, in from the
  marker, as wide as the text at most. A fence at the margin ends the list.
- Fence: a `blockBg` card, `paddingX 1`, sized to its widest line (floor
  60, cap M). Tabs expand to four spaces (the terminal skips a tab's cells
  without the tint). A blank line is one space so its row draws. Header
  row only from nine lines: `faint` uppercase language left, `faint` `N
  lines` right; a `faint` gutter from line 1 once over 8 lines. The body is
  glass's own highlighter (`hooks/highlight.ts`): keywords `codeKw`, calls
  `codeFn`, types `codeType`, strings `codeStr`, numbers and constants
  `codeNum`, comments `comment` (0.5.3: keywords by language family, since
  one shared set painted Python's `range(10)` and TypeScript's `values(x)`
  as keywords; a Rust lifetime `'a` keeps `codeStr` but ends at its word,
  so it never swallows the line to the next quote; a YAML word
  before a colon is a key in `codeFn`, while a JSON key is a string and
  keeps `codeStr`, the owner's orange); shell fences through `shellSpans` in the
  prose keys, so a command reads the same in a fence and in prose, a
  comment-only line in `comment`; prose fences (`md`, `txt`, `rst`,
  `adoc`...) paint nothing. `fenceShape` decides diagram, gutter, header
  and width once, for the card and the quote bar alike, so the two cannot
  drift. A diagram draws as typed: a fence with no language (or `text`,
  `txt`, `ascii`, `diagram`) whose non-empty rows are at least half arrow,
  box-drawing, block or shape glyphs, or their ASCII stand-ins (`+--`,
  `|--`, `-->`, `<==`, a row boxed in `|`, a connector row), has no header
  and no gutter, and its rows cut at the card edge (`truncate-end`). One-
  dash arrows and a diffstat's `+++---` never count. (The engine's `Code`
  paints with its own theme, rejected 2026-10-03; its `Markdown` leaf was
  tried next and dropped for the same reason.)
- Table: no vertical borders. Bold `bold` header, one `rule` row of `─`
  segments joined by two spaces, body rows joined by two spaces, cells
  padded by `cellWidth`. Numeric columns (a `~`, `<`, `>` or `≈`, a sign, a
  currency mark, digits, then a percent, `x` or `×`, or a unit of up to
  four letters with a per-unit tail, `4.5MB/s`; empty cells and the
  placeholders `-`, `–`, `—`, `n/a`, `?`, `…` ignored, since one dash
  flipped a whole column left) right-align with
  their header unless the separator names a side; a bare `---` names none.
  `&nbsp;` is a space. A table wider than its measure squeezes its widest
  column a cell at a time, down to 4, a squeezed cell cut in the middle;
  only a table too wide even then falls back to the engine's `Markdown`
  with the raw lines. The separator must match the header's cell count; a
  bare `---` under a line with `|` is a rule. A table start interrupts a
  paragraph. Streaming reflows widths per committed row; jitter accepted.
- Quote: the prose in the prose color (a `meta` step, as Claude Desktop and
  GitHub mute a quote, was tried and turned down 2026-10-11: the owner
  found it flat), a `quoteBar` `▎` on every row of the quote (the row count from the
  same wrapping the engine applies, fence headers counted only when drawn,
  wrapped code lines counted, a squeezed table counted as glass draws it,
  an over-wide table estimated as raw html is), one space, the inner
  blocks at `M - 2` with a blank row between them, no tint. (A dim `▌`
  drawn once per inner block was too thick and vanished on wrapped rows,
  2026-10-02. Box has no single-side border, so the bar is a glyph column.)
- Bottom line card: detection is monotonic. Once the head line is
  `**Bottom line**`, `**Bottom line**:` or `**Bottom line:**` the block is a
  card for the rest of the stream. Every following line, or the items of a
  list right after a title-only card, is a row; `Verified:`, `Issue:` and
  `Fix:` take their label and color, any other row a blank 8-cell label.
  The bold `calloutBar` title sits above the card as a plain line; only the
  labelled rows are inside the tinted box (title inside was the first
  design, moved out 2026-10-02). Card = `Box backgroundColor blockBg`
  sized to its longest row (floor 60, cap M); a `calloutBar` `▎` on every
  row. Compact: no padding rows, no blank rows (both tried, too bulky).
  Labels padded to 8 then two spaces; row text in `calloutText`.
- **(0.18.0)** Prompt tip card: a quote whose first line is
  `**<glyph> Prompt tip:** reason` (glyph optional, colon in or out of the
  bold) is drawn as the Bottom line card, not a quote. The reason is the
  `Why` row; every later line, joined, is the `Try` row (the rewritten
  prompt). Title `✎ Prompt tip`; title, bar and `Why` in `mark` so it never
  reads as a Bottom line; `Try` label and text in `ok`, the text
  italic, so the rewrite reads as the better version (0.18.1; 0.18.0 used
  `accentUser`, which in prism is coral beside the error red and read as a
  failure). Labels padded to
  3. Monotonic like the Bottom line: the head line alone is a card. Any
  other quote stays a quote. Approved by screenshot 2026-10-29.
- Rule: `─` repeated to min(M, 60) in `rule`.
- Raw html: the engine's `Markdown`.
- **(0.5.0)** Summary reply: an `AssistantMessage` whose props carry
  `isSummary` is a compaction summary. Glass draws it as any reply and ends
  it with one row ` · summary` in `faint`, `marginTop 0`, at the prose
  indent, as the engine's own faint mark reads. Never a card, never passed
  back to the engine (the row would lose glass's styling). The flag is
  read-only: the hook passes it on untouched.

## Turn chrome

The transcript drawn as the Empryo v3 desktop draws a turn, inside the
engine's row order, which glass cannot change: user row, then tool rows
and reply blocks interleaved as the model made them, then the
`TurnDuration` row, then task-notification rows.

### Bubbles (`UserMessage` origin `composer`, `AssistantMessage`)

Ported from prismantis 0.40.0 (MIT; THIRD_PARTY.md) with its defaults:
`promptStyle bubble`, `replyStyle auto`, `bubbleLabels small`.

- The prompt is a right-aligned small label `You ●` (`promptBorder`, else
  `accentUser`, bold) over a round-bordered box tinted 12% of that color
  into `blockBg`, `paddingX 1`, as wide as its widest line plus border and
  padding, capped at three quarters of the viewport (`CHAT_SHARE`). The
  `prompt.submit` clock is not drawn (prismantis `clock off`).
- The reply is a round `faint` frame on `blockBg`; the first bubble of a
  turn carries a small `● Claude` label (`accent`, bold) above it, later
  bubbles of the same turn none. The turn's header rule `◆ You` and the
  `◉ Claude` header are gone.
- Rows with other origins (`task-notification`, `peer`, ...) see Events
  below; `isExpanded` false passes to the engine.

### Copy control (hover)

- Every bubble, fence and art card ends in a small marker (`⧉`) that is
  the hover target of a hidden panel: `display: 'none'` with
  `hover: { scope, display: 'flex' }`, so the buttons appear when the
  pointer is on the marker or the panel. Three `Button`s: `markdown`,
  `html`, `text`. No `copy` capability, or an empty source, draws nothing.
- Markdown and text go through `$.ui.copy({ text, surface })`. HTML goes to
  the system clipboard as `text/html` with a plain-text companion:
  Linux CopyQ, else `wl-copy --type text/html` on Wayland, else
  `xclip -t text/html`; macOS `osascript` (public.html); Windows
  PowerShell (CF_HTML, ASCII-escaped stdin). Over SSH, or with no helper,
  the plain text is copied instead and a toast says so. Toasts: `Copied as
  Markdown`, `Copied as HTML`, `Copied as plain text`, `Copy failed`.
- The conversion (`hooks/html.ts`) works on the parsed blocks, so a table
  keeps head and body, a fence its language, inline marks their tags.
  Not ported: image copy (PNG) of prismantis.

### The activity line (under each reply bubble)

- There is no tool tree. A span is the run of calls between two reply
  bubbles (`callRun` over the turn's call order); activity between two
  bubbles belongs under the preceding one. The span's head call draws ONE
  line, a single `Button` (so the whole line is the press target) with
  `Text` children for color, indented to the bubble:
  - running: chevron, a spinner `Raster` and the running call's subject;
  - done: `N actions · M edits · K failed` in `meta`, the failure count in
    `err`, `N in background` when calls detached, the span's time at the
    right;
  - the chevron is `▸` closed, `▾` open.
- The other calls of the span draw `display: none` while the span is
  closed, and so does every `ToolResult` (a Read picture or a screenshot
  also waits for the line to open). Nothing a call prints draws inline:
  not Bash output, Read or Grep snippets, tracebacks, `(No output)` or
  errors, in the main transcript or in a subagent's view. Calls outside
  the turn record (a subagent's transcript) form their own span (the
  engine's group, or the call alone) under the same rules.
- A press on the line toggles `run:<head id>` in the `expanded` atom;
  `/expand` opens every span, `/collapse` closes them. Opened, each call
  draws as a card: a round `faint` frame on `blockBg` with a header row
  (mark, tool, subject, time) and its output inside, cut to `CARD_LINES`
  (4) lines with a `+N lines` count. Bash, Grep, Glob, Read, and
  MCP calls alike; Edit and Write keep their header plus the diff card; a
  call with no output draws the header alone. Never a `└` or `│` row.
- `TurnDuration` draws `display: none`. The right-aligned `Ran ... ·
  Searched ...` line of prismantis is not drawn: the activity line
  replaces it.
- Backgrounded Agent and Bash launches, loaded skills and server tool rows
  are calls like any other: they count in the line, and draw only in the
  opened span.

### Call output

- **(0.6.0)** An MCP result carrying a PNG (chrome-devtools
  `take_screenshot`, a Figma screenshot) draws the picture (in an opened span) in
  place of the engine's text body, so the person sees what Claude read:
  an `Image` of the base64 bytes (at most 2 MiB), else the stored copy the
  engine names in its `[Image: source: <path>, ...]` block. Bytes first: a
  file source drew its alt in Ghostty under tmux (live, 2026-10-12), and
  the engine draws a file source only once the terminal says it reads this
  machine's files. Aspect kept, at most 100 columns and 24 rows (or 60% of the
  screen's rows), alt `screenshot WxH`. A JPEG or WebP keeps the engine's
  body: `Image` takes PNG or raw pixels only. A grouped row draws it under
  its `ToolUse` row, as the diff card does. Needs Ghostty or kitty,
  outside tmux: inside it the engine draws no Image (2.1.296,
  `kittyGraphics=no (env: inside tmux or screen)`; forced on with
  `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` the picture still never reached
  Ghostty), and a mod cannot draw one itself (the engine refuses kitty's
  placeholder cell U+10EEEE in a Text, and a Raster takes BMP glyphs
  only), so inside tmux the engine's text body stays and the group stays
  folded (2026-10-12). **(0.6.1)** Unless `CLAUDE_CODE_FORCE_TERMINAL_IMAGES`
  is set: the person vouches that pictures get through. **(0.17.0)**
  sluice passes the engine's kitty codes through as they are, so pictures
  draw there with no switch (live, Ghostty 1.4, engine 2.1.312).
  **(0.7.0)** `userConfig.screenshots` (boolean; owner's request
  2026-10-12) turns all of it off: every screenshot row keeps the
  engine's text body, in tmux and out, and a group no longer opens for
  one. It follows `/config` live. **(0.17.1)** Off by default (owner's
  pick 2026-10-28: a devtools run takes a screenshot each step, and drawn
  they buried the turn's result); only `true` (or `"true"`) turns it on. Shape proved live with a probe mod
  2026-10-12.
  **(0.8.0)** Every picture Claude looked at, owner's pick 2026-10-12 after
  30 days of transcripts showed 119 of 411 screenshots were JPEG (drawn as
  text until now) and 329 image Reads (180 temp files Claude made, 143
  project files, 6 the owner's own):
  - Any format the model reads: PNG within 2 MiB draws as bytes; JPEG,
    WebP, GIF or a bigger PNG is converted once with macOS `sips` to a PNG
    (as it is, then 75%, 50%, 35% of its own longest side, until it
    weighs 2 MiB or less; never larger than it came), from the bytes
    Claude read (written through stdin, never argv, never the file on
    disk, which may have changed), into a private
    `$TMPDIR/glass-pictures-<uid>` (mode 700, files a day old go), kept
    per session keyed by those bytes: a file read twice draws what each
    read saw (0.17.0). No `sips` (Linux): the engine's text row stays.
    Conversions run one at a time, each with its own 8 s from when it
    starts (not while it waits its turn); one past that frees the queue
    and leaves the cache, so the next draw tries again. Each run writes
    its own scratch files (a random suffix) and removes them; the PNG is
    moved into place under the bytes' name, where a later load (a resume,
    a reload) reads it back with no `sips`.
  - A group opens for an MCP screenshot only once it converts and draws;
    one glass cannot draw (`image/bmp`, no `sips`) keeps the group folded
    (0.17.0).
  - A Read of an image file draws too, but only one per group: the newest
    image read the person did not name in one of their own prompts and
    that can draw (a JPEG with no `sips` gives way to an older PNG, 0.17.0;
    a picture they fed Claude is never drawn back). Named means the prompt
    holds the path, the same under `~`, the other side of macOS's
    `/private` links (`/tmp`, `/var`, `/etc`), or the file's name as a word
    of its own (0.17.0: Claude reads `/tmp/x.png` as `/private/tmp/x.png`
    and `x.png in this folder` with its folder, live 2026-10-28).
    A folded group draws it under the group row and stays folded; an open
    group under that Read's row, and only that one: a Read chosen while the
    group was shorter gives way (0.17.0); `/expand` draws every image read.
  - Which files the person named, and each Read's file (0.17.0): a
    `ToolResult` row carries no input, so each Read's `file_path` is kept
    by `tool_use_id` from `tool.call`, the ToolUse and ToolGroup rows, and
    the conversation. Before its first Read picture a load reads the
    conversation once (`$.session.messages()`): a resumed session's
    prompts and reads count. Every user message there counts as named
    (a task notification's too, which only keeps a picture back); from
    `prompt.submit` every prompt counts but those a machine wrote
    (`task-notification`, `peer`, `peer-send-message`, `projects-relay`,
    `coordinator`, `observer`, `observer-activity`, `auto-continuation`).
    Up to 4096 prompts, no 48 cap. A Read whose file is unknown, or a
    load whose conversation read failed, keeps the engine's row; a failed
    read tries again on the next draw. A draw waits on the read 2 s at
    most (then the engine's row; a later draw finds it done), and once
    done no draw waits again. Only a Read of an image waits on it: a
    text Read, and a group with no Read picture, never do.
  - Claude Code draws a finished turn's rows again at commit, and each
    fresh draw sends its picture again (seen live: one Read sent twice).
    Bytes only; the screen shows one picture.
- A picture (a Read of an image, an MCP screenshot) draws only once its
  span is open, like any output; `userConfig.screenshots` still gates it.

### The diff card (Edit, Write, a Bash that rewrote files)

- `structuredPatch` drawn by glass in place of the engine's panel. A
  rounded `faint` frame, the
  file named in its top border, `╭─ SPEC.md +1 -1 ───╮` (`Created`,
  `Deleted` before the path when so), drawn row by row by glass, no Box
  border. Every code line breaks at the card's room by the engine's
  ruler, mid-word as delta does, so no row wraps and every row carries its
  own two edges; the text Box is `truncate-end` as a guard only. (An
  absolute Text over a Box border was clipped or covered the first code
  row: the engine never lets a child paint the border row. A title as the
  first row inside the frame read plain. 2026-10-03.) Sized to the hunks
  (floor 60, cap `columns - 4`), `paddingX 1`.
- One number column in `faint` (`meta` on a tinted row): the new number on
  a kept or added line, the old on a removed one. `+` in `ok` on an `addBg`
  row, `-` in `err` on a `delBg` row; the tints are not green and red but
  the band tint and a dim plum, so marker and color carry the meaning for
  colorblind readers (owner's pick, 2026-10-03). Code painted by the
  highlighter with the language from the path; tabs expand to four
  spaces; one context line before a hunk's first change and one after its
  last, context between changes stays, numbers keep counting; an ellipsis
  row between hunks. Past 200 rows the rest folds to `… +N lines`.
- A Write that created its file (`type: 'create'`) draws its whole
  `content` as added lines. Rows of a group the engine unfolded raise no
  `ToolResult`, so the `ToolUse` hook draws the card under such a row.
- A Bash result whose command rewrote files (`bashEditDiff`) is drawn
  whole by glass: the body as a short one is, folded past 3 lines, then
  per file one row of air and the card; a file with no hunks keeps a
  header `Updated <path> +a -b` (verb `meta`, path `path`, counts `ok`
  and `err`); `moreFiles` ends it as `… +N more files`.
  In an opened span the call's card draws the command's `description` as
  its subject and the files under it as cards; closed, the activity line
  counts them as edits.
- **(0.5.0)** Colors: the card's tints come from the active theme's
  `diffAdded` and `diffRemoved`, its `+` and `-` marks and the header's
  counts from the theme's `success` and `error` (0.5.3: the `diff*Word`
  slots are the engine's word-level backgrounds, not text colors, so the
  marks never read them), wherever the engine resolves a theme key, so the
  card matches the engine's own diff panels under any theme. Under a glass
  theme (below) those slots are the palette's `addBg`, `delBg`, `ok`, `err`,
  so the owner's colorblind-safe pick holds. Under the stock dark theme the
  card goes green and red with the engine's panels: that is the trade of
  following the theme, accepted 2026-10-11.

### Group rows (`ToolGroup`)

- The engine's folded run of reads and searches is part of the span: its
  calls count in the activity line, the group's row is the line when it
  heads the span and `display: none` otherwise. Open, the group is passed
  to the engine as expanded and its calls draw as cards. No per-group
  button, and a group no longer opens by itself for an error or a picture.

### Events after the turn (`UserMessage`, origin `task-notification`)

- One flat row, no connector: `✓ Agent  <description>  1m 12s` when the
  text opens `Agent "<description>" finished` (the name in `tool`, the
  description in `meta`), else the text's first line in `meta`; `✓` in `ok`
  unless `task.status` reads as failed, then `✗` in `err`; duration from
  `task.durationMs`, none under 100 ms. `isExpanded` true passes to the
  engine; the remaining lines draw one per row in `meta`, clipped.

### `TurnDuration`

- The engine's `Baked for 12s` line draws `display: none`: the activity
  line carries the counts. The server tool rows (the advisor) draw there as
  flat rows after the reply: `✓ advisor  ran by the API  4.2s`, mark `✓` in
  `meta`, name in `tool`, the note and duration in `faint`; the duration is
  `endedAt - startedAt`, none when `endedAt` is absent. A subagent's server
  tools are not drawn. `turns[].serverTools` records `id`, `name`,
  `startedAt`, `endedAt` from `turn.step`'s `serverToolUses`.

### Spinner

- Not glass's: agent-hud draws the whole terminal line (what Claude is
  doing, the turn's time and counts), so a suffix from here never showed
  (2026-10-07).

### The hint line under the prompt (`PromptHint`)

- The engine's hint loses its key reminders, `(shift+tab to cycle)` and
  `· ← for agents`. What stays: `-- INSERT --` in `accentUser`, then the
  permission mode by meaning. Live, the engine draws its own mode pill
  first, then `·`, then glass's text; the owner accepted INSERT after the
  mode (2026-10-04). A hint with nothing to drop (`? for shortcuts`, `esc
  to interrupt`) keeps the engine's line and its live pills. The owner's
  status line is a separate script (`statusLine`) and out of reach.
- **(0.5.0)** The mode word's color is the theme's: plan `planMode`,
  accepting edits `autoAccept`, auto and bypass `warning`, else `meta`.
  (It was the palette's `accent`, `ok`, `warn`; under a glass theme those
  slots carry the same palette colors, so nothing moves for a glass-theme
  user, and a rose-pine user sees their own mode colors.)

### Background band (`AbovePrompt`)

- Shown while any subagent runs; passed to the engine whenever
  `hasSurvey`. The band is one site for every plugin, so glass always
  calls `next(e)`: with no agent running it returns what the plugins
  beneath drew, and with agents its frame draws above that.
- A rounded frame the band wide in `accent`, the model column in `accent`
  too, the faces in `warn` (a faint frame with a `meta` model column was
  tried and turned down, 2026-10-11: the owner likes the colored band),
  drawn with arc and rule glyphs since a border cannot carry a title: top edge `╭─ ◌ background · N ▾ ─── 1m 25s
  ─╮`, one row per agent `│ ◆ (●‿●) name  model · effort  stage  tokens
  file │` in fixed columns (20, 22, 14, 8, the rest), `+N more`, bottom
  edge `╰─ They outlive this turn ─── /tasks ─╯` (the `/tasks` hint only
  when `$.command.list()` has it). The face smiles while the agent thinks
  and lowers its eyes while it runs a tool. Stage is the last tool the
  agent called (MCP names as the call rows draw them), or `thinking…`. Tokens
  are the sum of the agent's `turn.step` usages read off each stop chunk;
  effort is the step's. The chevron (a `key` of `band:toggle`, `plain`,
  `dimColor`, lit by hover, as the line's press target is) closes the
  frame to one strip. It sits in a keyed Box (`band:chevron`): a hover
  with no keyed Box around it makes the engine refuse the whole tree and
  draw nothing, which is why the band was invisible from 0.5.2 to 0.5.3
  (found in the debug log, 2026-10-12). Per-agent cost
  stays out: no price table in the API. Agent identity: `agent.spawn`
  gives `description`, `subagentType`, `model`; `agentId` from awaiting
  `next(e)`; removed at that agent's `turn.complete`.
- Sized to `bodyColumns`, never `viewport.columns`, four cells short so
  the engine's `[-]` mark sits beside the top-right arc. Fits from 84
  columns; narrower, the file column goes first, then the model, the
  name, the tokens and the stage give up cells; the closed strip drops its
  oldest faces. The file column draws relative to the session's directory
  and cuts in the middle, keeping the file name.
- **(0.10.0)** A `view` Button at the right end of every agent row (a
  `key` of `band:view:<agentId>` on the Button and its Box, `plain`,
  `dimColor`, lit by hover, as the chevron) puts that agent's transcript
  in the main view through `$.ui.view({ agentId })`; the site's
  `e.props.view.agentId` names the agent in view, whose row draws `back`
  (`$.ui.view({})`) and its name in `accent`. The button's five cells come
  off the file column. The call is spelled at the call site through a
  cast of `$`, as the notification's is: the validator refuses `$.ui`
  bound to a value, and an engine without the method (before 2.1.300)
  throws into a toast that names the version. A press the engine declines
  (`{ deny }`: the agent is gone, the view moved, no view here) toasts
  `glass: <reason>`.

### **(0.5.0)** Notifications

- `$.ui.notify(text, { title: 'glass' })` fires only for what the engine
  stays silent on; the engine's own idle notification already covers a
  finished turn, and no API tells a mod whether the terminal is focused.
  Two cases:
  - A background agent finished after its turn: an agent's
    `turn.complete` arriving while no main-loop turn is live, read from
    the `liveTurn` atom (0.5.1: module memory reset on a mid-turn reload
    and fired this inside a live turn; state survives the reload). Text:
    `<description> · <duration>` (description clipped to 60 cells).
  - A turn ended with failures: at the main loop's `turn.complete` with
    `live.failed > 0`. Text: `N calls failed · <tool of the last failed
    call>`.
- When `isSent` is false the text goes to `$.ui.toast` instead. The call is
  guarded (`typeof $.ui.notify === 'function'`) so an older engine toasts.
- `userConfig.notify` (boolean, default true) turns both off; it follows
  `/config` live through a `config.set` hook, as the palette does.
- Glass never notifies from a render hook or a timer, and never on hearing
  a `ui.notify` event (two mods echoing is the documented failure).

### State

Atoms, all under `plugin: 'glass'`: `turns` (last 48: `turnId`,
`durationMs`, `tools`, `edits`, `failed`, `inTokens`, `cacheTokens`,
`outTokens`, `costUsd`, `lastToolId`, `answer`, `startedAt`, `finishedAt`,
**(0.5.0)** `serverTools`), `prompts` (text, submit and start times, turn
id; last 48), `calls` (turn id -> main-loop calls with status and wall
time), `agents` (live subagents), `band` (`open` or `closed`), `liveTurn`
(the main-loop turn id while one runs, else null; 0.5.1). Module
records (call -> turn, call -> wall time, a turn's call order, unfolded
group calls, `expandAllNow`) keep the last 48 turns, as the
atoms do. Each atom is declared in `types/index.d.ts`; `claude plugin
validate` holds the module to it.

## Palette

- `tidepool` (default) maps the owner's nvim theme by role: strings olive,
  numbers and inline code pine, commands iris, builtins foam, paths gold,
  links mint; its code keys are the engine's reply-fence colors the owner
  liked. `codex` carries One Dark; `water` Empryo's proxysoul-water
  tokens (`rule #5a5870`, `delBg #33222e` after the live check).
  **(0.15.0)** `rose` (rose-pine) and `undertow` (sampled off Empryo's desktop frames)
  are gone: both read muted beside glass's own palettes. A saved
  `rose` or `undertow` falls back to `tidepool`. **(0.10.0)** `crimson` is Empryo's
  crimson world ("the heart"), the tokens of empryo.com's own CSS
  (`:root[data-world=crimson][data-theme=dark]`, 2026-10-16) mapped by
  role as water's are: pigment `#f43a6b` for the verb, the marks and the
  bars, the violet alt for builtins and raw, the pink nucleus for flags,
  `var`, `quoteBar` and `accentUser`, amber for strings; its desktop
  theme `proxysoul-crimson` is not in Empryo's public tokens.ts yet.
  Derived against the audit ground: `rule #664468` (the site's `#3f2040`
  is 1.34:1), `blockBg #301a34` (pigment-deep is 1.09:1), `faint #7a6679`
  (3.6:1), `path` a soft sky `#8fb6e6`, the one cool hue the world lacks,
  `delBg #3a2420` an ember apart from the plum tint.
- **(0.11.0)** `tarnish` is glass's own palette, not a port: metals aging.
  Copper (`cmd`, `accent`, `tool`, `calloutBar`, `codeKw`) is what happens
  now; the verdigris it weathers to (`sub`, `num`, `code`, `accentUser`,
  the card tint) is what has settled; brass strings, steel paths and
  links, the violet sheen of tarnished silver for flags, variables and
  `fix`; bone text, never pure white. Every value was placed in OKLCH:
  the nine shell kinds in one lightness band (L 0.74 to 0.83), a quieter
  twin one chroma step under its role, greys and tints read against
  `#0d1117` and night-owl `#011627` and lifted to the floors (rule 2.5:1,
  faint 3.5:1, blockBg 1.24:1). Named after a search: "Verdigris" and
  "Patina" exist as 16-color schemes in the iTerm2 gallery; "tarnish" did
  not. First in the option list; the default stays `tidepool`.
- **(0.12.0)** Two more of glass's own. `overprint`: Risograph inks on
  black paper, the fluorescent pink, aqua, fluorescent yellow, orange,
  violet, fluorescent green and scarlet of the ink charts, the tints an
  ink overprinted on black (violet card, wine removed row, teal added
  row); loud by design, pink headings approved by the owner. `ironbow`:
  the thermal camera gradient with heat for activity, yellow verb and
  mark, orange builtins, magenta flags, violet strings, cold-blue paths,
  white-hot headings; done is cold (blue status dots, blue Verified),
  failure the one red; the mark is orange and the callout bar magenta so
  the mark stays off every bar. Both drawn through `GLASS_EXTRA_PALETTES`
  first (a `{ name: Palette }` JSON `scripts/readme-shots.ts` merges in),
  approved by screenshot 2026-10-16, then added here.
- **(0.13.0)** Two more, from a brief of "the cool family water belongs
  to, not water again". `lagoon`: daylight shallows, turquoise lead, sky
  secondary, hibiscus flags, sun-yellow strings, sand paths, white-sand
  text, palm green and coral, deep-water tint; the brightest shell band
  (L 0.76 to 0.88). `iris`: the flower, indigo-petal lead, leaf-underside
  teal secondary, honey strings (the beard), orchid flags, sky paths,
  neutrals with an indigo cast so the card tint and rules go violet-grey.
  Turned down the same day: `noctiluca` (a glowing cyan: too close to
  water), `labradorite` (blue lead with copper paths: the owner preferred
  lagoon). Both placed in OKLCH and approved by screenshot.
- **(0.14.0)** `tangerine`, from a brief of "crimson's vibrance, water's
  cyan, tarnish's warmth". A first draft put crimson in the lead seat over
  water's set; the owner found the red bled on the navy ground. Tangerine,
  rose pink and violet leads were drawn side by side through
  `GLASS_EXTRA_PALETTES` and tangerine was approved by screenshot
  2026-10-16: orange is cyan's complement, so it pops without the bleed.
  Tangerine takes the verb, tool, keywords and callout bar; water's cyan
  keeps the accent, band, card tint and builtins; crimson's pink takes the
  person's row, flags and quote bar; strings and warn are lemon, apart from
  the lead; failed is a rose red.
- **(0.14.0)** `prism`, from the owner's starship prompt
  (`gradient_modern` in `~/.config/starship.toml`), each color in its
  segment's role: coral (username) the person's row, flags and types;
  orange (directory) paths; gold (git) strings; emerald teal (toolchains)
  builtins and raw code; blue the verb, tool and keywords; purple (clock)
  Claude's mark, the band and the callout bar; the prompt character's
  bright four for done, failed, warn and H3; white headings. The prompt's
  two dark greys are left out: bg1 is 1.09:1 on night-owl's ground, and
  bg3 as a neutral grey card sat heavy on the navy, so the owner took
  water's tints for the cards and diff rows. Approved by screenshot
  2026-10-16. Prism is the first palette to set the optional
  `promptBorder`: the owner wanted the prompt box in the band's purple
  while the row stays coral.
- **(0.15.1)** Prism's strings (`str` and `codeStr`) are Blue Martina
  `#12cbc4` from Flat UI's NL palette, not the prompt's gold `#e6c229`:
  gold sat at 10.6:1 and a JSON diff, keys and values both strings, glared
  yellow. Martina is 9.0:1, cool, and a hue prism had no other use for.
  Merchant Marine `#0652dd` (2.8:1, sank), Mediterranean Sea (4.5:1,
  muted) and Android Green (9.7:1, warm, among prism's greens) were drawn
  beside it; the owner picked Martina 2026-10-17.
- **(0.15.2)** A JSON key is its own highlighter kind, painted in the
  palette's optional `jsonKey`, else in `codeStr` as before (water's orange
  keys stay). Prism sets coral `#ff6b6b` keys, so a key reads apart from
  its value, and its strings move from Martina to Mediterranean Sea
  `#1289a7` lifted in OKLCH (hue and chroma kept) to `#4eb4d3`: 7.0:1 on
  the owner's real ground. Their Ghostty runs at `background-opacity =
  0.96` with blur, and the ground measured off a screenshot is `#0a1f30`,
  not night-owl's `#011627`, so every color reads about 10% under its
  night-owl contrast. No other prism key uses `#4eb4d3`. Approved by
  screenshot 2026-10-17. Every palette supplies the full
  `Palette` type: the prose and shell keys, `meta`, `faint`, `rowHover`,
  `accentUser`, `text`, `bold`, `blockBg`, `tool`, the callout keys, the
  code keys and the diff tints. A test keeps `mark` apart from `ok`,
  `quoteBar` and `calloutBar` in every palette.
- **(0.16.0)** The light pair, `prism-light` and `tangerine-light`: prism
  and tangerine by role for a light terminal. A palette's optional
  `ground: 'light'` gives its theme the engine's `light` base and steps the
  diff word tints toward black (`deepen`, 10%) where a dark palette lifts
  them toward white. Drawn for GitHub Light (`#ffffff`, fg `#1f2328`), the
  light ground of VS Code, the macOS Terminal and GitHub; every text role
  holds 4.5:1 there and on One Light `#fafafa`, Solarized Light `#fdf6e3`
  and Catppuccin Latte `#eff1f5`. Scaffolding keeps the dark floors: rule
  2.4:1, faint 3.4 to 3.5:1. Neons and pastels go down along their hue;
  the yellows (prism's warn, tangerine's lemon) cannot reach 4.5:1 on
  white and become a dark gold. The card and diff tints are water's tint
  and a plum step under white, 1.13:1 and 1.18:1; on Latte the card tint
  reads as the ground. The README shots draw a light palette on GitHub
  Light. The owner picked the pair; the ground is the most common light one.
- **(0.5.3)** Palette fixes from the color audit (contrast against
  `#0d1117`): undertow's `faint`, `rule`, `blockBg` and `rowHover` lifted
  to their floors (faint 3.6:1, blockBg 1.3:1, hover a step above the card);
  codex `faint` to 3.7:1 and `rule` a step under `meta` (it outranked
  `faint`, so table rules beat the rules); tidepool `codeStr` is `str`
  (it was `err`: a TypeScript string read as an error) and `codeFn` the
  verb's iris; water `url` a sky blue apart from the brand cyan that
  `tool`, `cmd`, `accent` and `codeKw` share; rose `path` rose (it was
  `bold`), `flag` iris, `var` gold (it was `err`), `ok` a lifted pine (it
  sat a step from `codeKw`). Water's other shared cyans (`sub`, `num`,
  `code`, `heading3`, `codeFn`) are Empryo's own and stay.
- Left out on purpose: an inline-code background (rejected as noise),
  a foreground remap, more themes (catppuccin, tokyonight, dracula,
  gruvbox, nord: add on request), and a user-set command list (edit
  `COMMANDS` in `hooks/shell.ts`).
- The palette option follows `/config` live: a `config.set` hook on
  `glass.palette` swaps the module's palette after the engine stores the
  value; rows already on screen keep theirs.

### **(0.5.0)** Theme keys and glass themes

Two directions, settled 2026-10-11.

- Forward: glass names a theme slot, not a hex, where it mirrors an engine
  panel: the diff card's tints (`diffAdded`, `diffRemoved`) and marks
  (`success`, `error`) and the hint line's mode word (`planMode`,
  `autoAccept`, `warning`). Nowhere else: the palettes are
  tuned sets and a theme key beside them risks contrast clashes.
- Reverse: every palette has a theme. `hooks/theme.ts` holds one fixed
  table from `Palette` roles to engine slots and writes a theme JSON
  (`{ name, base: 'dark', overrides }`) for a palette:

  | slot | palette role |
  | --- | --- |
  | `success`, `error`, `warning` | `ok`, `err`, `warn` |
  | `claude` | `accent` |
  | `permission` | `tool` (the engine's codespans take it too) |
  | `planMode` | `cmd` |
  | `autoAccept` | `ok` (0.5.3: the engine's own is a green; `warn` made it one color with `warning`) |
  | `promptBorder` | `accentUser` (0.10.1: it was `rule`, a grey step in water, codex and rose, so the box looked uncolored beside crimson's plum; the prompt box is the person's, as the user row is; 0.14.0: a palette's optional `promptBorder` wins, prism's is the band purple) |
  | `bashBorder` | `cmd` (0.10.1: the verb's color for `!` mode) |
  | `secondaryBorder` | `rule` |
  | `text` | left to the base: prose is the terminal's own foreground |
  | `secondaryText` | `meta` |
  | `inactive`, `subtle` | `faint` |
  | `suggestion` | `url` |
  | `userMessageBackground`, `bashMessageBackgroundColor` | `blockBg` |
  | `userMessageBackgroundHover` | `rowHover` |
  | `thinking` | `private` |
  | `diffAdded`, `diffRemoved` | `addBg`, `delBg` |
  | `diffAddedDimmed`, `diffRemovedDimmed` | `addBg`, `delBg` |
  | `diffAddedWord`, `diffRemovedWord` | `addBg`, `delBg` lifted 18% toward white (0.5.3: the engine paints these behind a changed word; `ok` and `err` there were bright blocks behind text) |

  Slots with no role (`remember`, `merged`, `ide`, `inverseText`, the
  rainbow and shimmer slots) inherit the base. The two slots the owner
  tuned by hand in August (`userMessageBackground`, `secondaryText`) are
  set from the palette, by decision: a palette that colors the transcript
  and leaves the user bubble stock gray reads unfinished.
- `/glass-theme` (registered at `session.start`, as `/expand` is):
  writes `~/.claude/themes/glass-<palette>.json` for the current palette
  with `$.fs.write` (`HOME` from `$.env.get`), then `$.config.set({ key:
  'theme', value: 'custom:glass-<palette>' })`; answers as a transcript
  line, as `/expand` does (the engine prefixes it with `glass:`):
  `theme glass-<palette> on` or, when the set is denied, `wrote
  ~/.claude/themes/glass-<palette>.json. A plugin cannot select a custom
  theme, so pick glass-<palette> in /theme.` (The `/theme` picker lists
  custom themes; confirmed live 2026-10-11.) Refused without a write
  when `HOME` is unset or relative, or when an entry under that name is a
  link or not a regular file. It never writes any other file in `themes/`:
  the owner's `rose-pine.json` is theirs. The palette-switch re-sync
  below reports the same line as a toast.
- Switching the palette in `/config` while the active theme is a glass
  theme (`theme` reads `custom:glass-*` in `$.config.list()`) rewrites and
  re-sets the theme to the new palette, so the two never disagree. Any
  other active theme is left alone.
- Known limits. Confirmed 2026-10-11 on 2.1.296: `config.set` refuses a
  `custom:` value from a plugin (the row takes only `auto`, `dark`,
  `light` and their daltonized and ansi forms), so `/glass-theme` writes
  the file and answers by pointing at `/theme`, whose picker lists custom
  themes; glass never edits settings.json itself. The palette-switch
  re-sync therefore only rewrites the file; selection stays the person's. Still to confirm
  live: whether `$.config.list()` reports a `custom:glass-*` value (the
  re-sync's trigger), and whether the engine's codespans under a `custom:`
  theme take `permission` (they fell back to stock in 2.1.241). Body
  prose and tool-result bodies never take a theme: the terminal fg and
  stock gray, by the engine.

### **(0.5.0)** Buttons

- 2.1.288 fixed a mod's button running another's action after a redraw,
  and 2.1.295 gave Buttons children and a `primary` variant. The 0.2 and
  0.3 Buttons in transcript rows (chevron, Copy) never received a press
  live. One live retest decides (DEMO.md, step B): a plain `Button` in the
  plain `Button` that toasts on press. Pass: the Buttons ship (0.20.0 uses
  them for the activity line and the copy formats). Fail: nothing ships and the Buttons bullet there becomes
  history. The group fold button stays out either way.
- No `variant: 'primary'` anywhere: a transcript has no main action.

### **(0.5.0)** Engine floor

- Floor 2.1.295 in the README. Degradation below it, by construction:
  `$.ui.notify` is guarded; `isSummary` and `serverToolUses` are optional
  props; Buttons use `label` only; theme keys resolve on any engine that
  has the slots (they predate the typing). No runtime version check.

## Glyphs

`hooks/glyphs.ts`, by code point: `▎` U+258E, `•` U+2022, `◦` U+25E6, `☐`
U+2610, `☑` U+2611, `─` U+2500, `│` U+2502, `╭` U+256D, `╮`
U+256E, `╰` U+2570, `╯` U+256F, `✓` U+2713, `✗` U+2717, `○` U+25CB, `◉`
U+25C9, `◌` U+25CC, `▸` U+25B8, `▾` U+25BE, `…` U+2026, `·`
U+00B7, `×` U+00D7, the faces' `●` U+25CF and `‿` U+203F, **(0.5.0)** `⧉`
U+29C9 (the copy marker). Each gets a `cellWidth` fixture.
Only glyphs the mod draws live here.

## Testing strategy

- `tests/parse.test.ts`: the parser's edge cases, streaming callout,
  tables, fences under list items, the width ruler against Bun's drift.
- `tests/chrome.test.ts`: mounted renders (prompt and reply bubbles, the
  activity line collapsed, running, done, failed and open, call cards, an event row, the band with
  six agents, a running row with its Raster clock and three ticks), the
  diff card, painted output, glyph widths, palette separation.
- **(0.5.0)** `tests/theme.test.ts`: every palette produces a theme whose
  every value is a 7-character hex, every slot in the table present, the
  file name `glass-<palette>.json`; the forward keys are the literal slot
  names. `tests/chrome.test.ts` gains: the summary trailer row; a server
  tool row from a turn record, with and without `endedAt`; the
  `TurnDuration` row `display: none` with no server tools; the activity
  line validates mounted. Hook behaviour (the notify
  cases) is checked through `mock.clock` and the kit's engine where the
  kit reaches it; what it cannot reach is a DEMO.md step.
- `tests/demo.test.ts` writes `demo/<before|after>/*.txt` text dumps of the
  fixtures DEMO.md names; the `before/` set is captured on 0.4.25 before
  any 0.5.0 change and committed once.
- Live, after every release, the DEMO.md checklist in Ghostty.

## Boundaries

- Always: run `scripts/check.sh` before a commit; keep both manifests at
  one version; build glyphs from code points; read no atom in a call row
  hook; call `next(e)` on the band; keep `/expand` and `/collapse`
  working without any Button.
- Ask first: adding a userConfig option; any new notification case; a new
  palette; writing anywhere outside `~/.claude/themes/glass-*.json`;
  changing a rule this file marks as the owner's request or pick.
- Never: write or edit the owner's own theme file; notify from a render
  hook, a timer or a `ui.notify` hook; add per-prompt work that slows the
  prompt; pass a transcript row back to the engine to get a feature (the
  styling goes with it); draw with `dimColor` in a reply; use
  `truncate*` on reply text.

## Not drawn, and why

- HISTORY folding of old turns: the engine owns transcript folding.
- Side call rows, `Effort: auto → xhigh` rows, per-agent cost: Empryo
  internals with no event or field in this API.
- Icons per tool kind: the ASCII rule and font variance; the tool name in
  `tool` color is the icon.
- `Review` and `Till pass` footer actions: product features, not drawing.
- Past turns dimmed and lifted on hover: the API allows it
  (`Text.hover.dimColor` with a `scope` per message), but it costs one
  state read per text block, and `dimColor` over colored spans is
  unverified. Try after 0.5.0 ships; drop if it flickers.
- Tool-result bodies in a theme color: the engine draws them stock gray
  wherever glass does not draw the body.

## Open live checks

Carried from earlier passes, each a DEMO.md step: the skill-loaded call in an opened span (0.4.25); the band four cells short of the `[-]` mark; the
narrow-band column order; a blank fence line's row; the hint string
carrying `-- INSERT --`. For 0.5.0: the Button press; `config.set` of a
`custom:` theme; codespans under a glass theme; the notify channel's
`isSent`; the tall-reply duplicate rows (engine fixes in 2.1.289 and
2.1.290 may have closed it: reproduce before filing); a tabbed fence after
the engine's own tab-stop change in 2.1.295. For 0.10.0: the `view`
press on a band row, `back` on the row in view, Esc from the agent view;
a `deny` toast when the agent has finished; the activity line's counts under
a turn that spawns subagents (2.1.299 raises `turn.start` for them; 0.9.1
guards it); crimson's `blockBg` and `rule` on the owner's ground.
