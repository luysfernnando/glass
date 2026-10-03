# glass: render spec

The contract for how glass draws Claude Code's transcript on the terminal.
Code follows this file; undocumented deviations are bugs. Settled by a
design panel and an investigation round on 2026-10-02.

## Global

- Measure `M = columns - 2`, full width, recomputed per draw: the reply
  runs as wide as the engine's own tool output, so nothing reads as a hole
  on the right. (A 100-column cap was tried and rejected on a 190-column
  terminal.) Prose, lists and cards never exceed M.
- One width ruler: `cellWidth()` in `hooks/width.ts`, mirroring the engine's
  `Bun.stringWidth(s, { ambiguousIsNarrow: true })`. Never code-point length.
- Glyph encoding: every non-ASCII glyph comes from `hooks/glyphs.ts`, built
  with `String.fromCodePoint`. No literal or `\u` escape outside ASCII in
  `hooks/`, comments included. Check: `grep -rnP "[^\x00-\x7F]" hooks/` prints
  nothing.
- Rhythm: `marginTop: 1` on every block except the first of a text block and
  any block right under a heading. Never `marginBottom`, never spacer boxes.
  The first block of a reply adds `marginTop: 1` above the bullet.
- Tint only on the two cards, code fences and the Bottom line (`blockBg`,
  >= 1.2:1 over the terminal bg). Cards hug their content: width = widest
  row plus padding, floor 60 cells, cap M. Inline code has no tint.
- `dimColor` only on fence headers and the footer. Never on prose.
- Never `wrap: 'truncate*'` in the reply body. A width mistake must wrap,
  never lose text.
- A tree that would be refused reverts the whole message to the engine's
  renderer. So: reply text is normalized on entry (CRLF to LF, C0 controls
  other than tab and newline removed), Text and Code strings stay under
  10000 characters (long fences split at line boundaries, gutter numbering
  carrying on), `Link` only gets `https:` or `http://localhost` hrefs, props
  are set conditionally rather than passed as `undefined`.

## Inline

- Plain text default color, with claude-hl's prose passes ported:
  - Command spans in prose paint only with evidence: a known command word
    followed by a flag, path, string, number or operator, or preceded by a
    runner prefix (`Ran`, `$`). `git push --follow-tags` paints; `git
    status` in a sentence, `make sure`, `go ahead` do not. Stop words and a
    three-bare-word budget end a span. (`proseSpans` in `hooks/shell.ts`.)
  - Paths anywhere: rooted (`/`, `./`, `../`, `~/`), a known extension
    (`README.md`) or a dotfile (`.gitignore`) in `path` underlined; a
    `:line` or `:line:col` suffix in `num`. URLs (`https`, `ssh://`,
    `git@`, `www.`) in `url` underlined. (`hooks/paths.ts`.)
- A paragraph opening with `Private` or `Privately` is Claude's own
  planning note: drawn whole, italic, in `private`.
- A paragraph that needs the reader gets a gutter mark: `▎` in `mark` in
  the two cells other blocks leave blank. Needs the reader = a question
  mark, an imperative opener, or an attention phrase (asks, things not
  done, risks), the tables in `hooks/prose.ts`. Never on list items,
  headings, code, cards or the first block under the bullet. Off for the
  whole turn when the prompt asked for writing (`write`, `draft`, …
  among its first six words).
- `**bold**` bold in `bold`. `*italic*` italic. `~~strike~~` strikethrough.
- Links: `https` and `http://localhost` become `Link` with the label in
  `url` color underlined; any other href draws as that styled text only.
- Inline code is color only, as Claude Desktop and the Codex TUI draw it.
  No tint, no padding, no caps. Contents, in order: shell spans when
  `shellSpans()` recognizes a known command head (each token in its kind
  color); else a path (`PATH_RE`) in `path` underlined; else `code` color.
  (Tinted pills with padding and Nerd Font caps were tried and rejected as
  noise; a tint alone is what none of the reference apps rely on.)
- Streaming: unclosed `` ` ``, `**`, `*`, `[` stay literal. Code colors
  apply on the closing backtick.

## Blocks

- Paragraph: `Box width M` holding one wrapping Text.
- Headings: H1 and H2 bold `heading`; H3 and deeper bold `heading3`. No
  rules, no `#`. Hierarchy comes from color and the blank line above.
  (A trailing rule was dropped with the full-width measure: a 188-cell
  rule is heavy, and the reference apps draw none.)
- Lists: markers `•` (top), `◦` (nested), `☐`, `☑`; `☑` in `ok`, the rest in
  `bullet`. Ordered numbers in `orderedNum`, padded to the widest marker.
  Items are `M - depth*2` wide, indented `depth*2`. Zero rows between items.
- Fence: a `blockBg` card, `paddingX 1`, sized to its widest line (floor
  60, cap M). Header row only when a language is present or the block
  exceeds 8 lines: dim uppercase language left, dim `N lines` right. The
  body is glass's own highlighter (`hooks/highlight.ts`): one row per
  line, keywords in `codeKw`, calls in `codeFn`, types in `codeType`,
  strings in `codeStr`, numbers and constants in `codeNum`, comments in
  `comment`; shell fences through `shellSpans`. A `faint` gutter from
  line 1 once over 8 lines. (The engine's `Code` paints with its own theme,
  which the owner rejected 2026-10-03; its `Markdown` leaf was tried
  next and dropped for the same reason.)
- Table: no vertical borders. Bold `bold` header, one `rule` row of `─`
  segments joined by two spaces, body rows joined by two spaces, cells
  padded with spaces measured by `cellWidth` (pills counted). Numeric
  columns right-align unless the markdown alignment says otherwise. A table
  wider than `columns - 4` falls back to the engine's `Markdown` with the
  raw lines. The separator row must match the header's cell count; a bare
  `---` under a line with `|` is a rule. A table start interrupts a
  paragraph. Streaming reflows widths per committed row; jitter accepted.
- Quote: a `quoteBar`-colored `▎` on every row of the quote (the row count
  estimated from the engine's wrapping, as the Bottom line card does), one
  space, the inner blocks at `M - 2` with a blank row between them, no tint.
  (A dim `▌` half block drawn once per inner block was the first design: too
  thick, and the bar vanished on wrapped and list rows. Changed 2026-10-02.
  Box has no single-side border, so the bar is a glyph column.)
- Bottom line card: detection is monotonic. Once the head line is
  `**Bottom line**` the block is a card for the rest of the stream. Every
  following line, or the items of a list right after a title-only card, is
  a row; `Verified:`, `Issue:` and `Fix:` take their label and color, any
  other row gets a blank 8-cell label. Card = `Box backgroundColor blockBg`
  sized to its longest row (floor 60, cap M); a `calloutBar`-colored `▎`
  on every row, the row count from the same word wrap the engine applies.
  Compact: no padding rows and no blank rows. (Full padding plus a blank
  between every row was tried and judged too bulky; so was a blank after
  wrapped rows only.)
  The bold `calloutBar` title sits ABOVE the card as a plain line; only the
  labelled rows are inside the tinted box (title inside the box was the
  first design, moved out 2026-10-02 by request). Labels padded to 8 then
  two spaces; row text in `calloutText`, wrapping under itself.
- Rule: `─` repeated to min(M, 60) in `rule`.
- Raw html: the engine's `Markdown`.

## Tool rows

- Header row = a blank row above, status dot (`ok` green, `err` red on
  error or interrupt, `comment` while running), then `Tool(subject)` as one
  wrapping line, as the engine and claude-hl draw it: tool name in `tool`
  (rose), parentheses dim. Bash: the command tokenized with the head
  trusted, flowing on one line. (Breaking chained commands one per line was
  tried and reverted by the owner.) File tools: path in `path`; URLs
  underlined in `url`; other arguments dim after a comma.
- (Superseded by the second pass: every Bash body is glass's, under the
  trunk.) Bash result bodies of at most 3 lines are redrawn (`hooks/output.ts`,
  `renderToolOutput`): the dim `⎿` connector, then each line painted as
  claude-hl painted tool output: commands with evidence, paths and URLs,
  error, warning and success words, numbers and durations, check and cross
  marks, git status codes. Longer output keeps the engine's collapsed body
  and its ctrl+o expansion untouched. (Rewriting `output` with SGR codes
  was tried first: the engine strips them, nothing showed.)
- Reply text: a U+FE0F after a text-default symbol (U+26A0 and kin) is
  dropped, since the terminal draws the emoji form 2 cells while the
  engine counts 1 and the next character is drawn over.
- Open: in an expanded group (ctrl+o, `--verbose`) the engine draws the
  result inline in the `ToolUse` row; the header-only tree may drop it
  there. Verify live before adding any preview.

## Footer

- Replaces `Baked for 12s`: `Box marginLeft 2 marginTop 1`, one dim line
  `12s · 3 tools · 322k ctx · 1.6k out · done 3:31 PM` (the finish time in
  the machine's locale, as the engine's own line had it). Tools omitted at zero, tokens
  omitted when unknown, the whole line hidden under 3s with no tools.
  Drawn from `$.state` `glass.turns` (the last 48 turns, written at `turn.complete`); a footer row finds its own turn by `durationMs`, since a state read in a render hook subscribes the row and every write redraws it.

## Palette

`tidepool` (default) maps the owner's nvim theme by role; `codex` and
`rose` carry claude-hl's sets. Every palette supplies the full `Palette`
type in `hooks/palette.ts`, the code keys (`codeKw`, `codeFn`,
`codeType`, `codeStr`, `codeNum`) and the diff tints (`addBg`, `delBg`)
included; tidepool's code keys are the engine's reply-fence colors the
owner liked (blue keywords, red strings, olive calls, pine types). Not ported from claude-hl, on purpose: the
inline-code background (`CLAUDE_HL_CODE_BG`, rejected as noise), the
foreground remap (the mod draws its own colors), the extra themes
(catppuccin, tokyonight, dracula, gruvbox, nord: add on request), and
`CLAUDE_HL_COMMANDS` vocabulary growth (edit `COMMANDS` in `hooks/shell.ts`).

## Verification

- `claude plugin validate .`, `npx tsc -p .`, the ASCII grep above.
- `claude plugin test .` runs `tests/*.test.ts`: width fixtures, glyph
  integrity, parser edge cases, streaming callout.
- Live in Ghostty after a reload: a prose pill, a pill in a table, a table
  with an emoji and CJK, the Bottom line card mid-stream, a `&&` Bash row,
  ctrl+o on a grouped row.

## Turn chrome (0.3)

The transcript drawn as the Empryo v3 desktop draws a turn, inside the
engine's row order. Reference: the X post of 2026-10-02 (video, 21s) and the
official desktop screenshot; Empryo's v3 transcript is not open source, so
every value below is read off the frames. Supersedes the `Tool rows` and
`Footer` sections above where they conflict; `Global` and `Blocks` stay.

Engine row order per turn, which glass cannot change: user row, then tool
rows and reply text blocks interleaved as the model made them, then the
`TurnDuration` line, then any task-notification rows. Empryo's order is
header, tree, prose, footer, events. The mapping below keeps the engine's
order and draws Empryo's chrome on the rows the engine already has.

### Hierarchy rule

One rule, as Empryo's: bright for the live thing, muted one step for the
done thing, faint for scaffolding, saturated color only on status marks.
Four text steps, all palette keys (no `dimColor` on colored text): `text`
(prose, as today), `meta` (times, counts, durations, args of a done row),
`faint` (connectors, folds, hints), and `bold`. `dimColor` keeps its two
sites (fence header, footer) and gains none.

### User row (`UserMessage`, origin `composer`)

- Above the row, a turn separator: a blank row, a `faint` rule M wide,
  another blank row (owner's request, 2026-10-03: prompts sat flush under
  the reply before).
- `◆ You · 01:11 PM` then the prompt, wrapped at M, indented 2 under the
  header. `◆` and `You` in `accentUser`, the time in `meta`. The time is
  the `prompt.submit` clock for that text (map text -> time, newest wins;
  a row with no match draws no time).
- Rows with other origins (`task-notification`, `peer`, ...) see the
  events bullet below; `isExpanded` false passes to the engine.
- The assistant header `◉ Claude · 01:14 PM` is drawn as the tail of this
  tree after one blank row: `◉` and the name in `accent`, the time in
  `meta` from `turn.start`'s clock, read from state so the row redraws
  when the turn begins (the footer's subscribe-and-redraw pattern). This
  is the one place a header can precede both tool rows and text blocks,
  since the engine fixes the row order. Drawn only once a turn has
  started for this prompt; a prompt that never ran a turn shows none.
- The reply bullet on the first text block (`isFirstOfReply`) is dropped:
  the header carries it. The first block keeps its blank row above.

### Tool rows: the tree (`ToolUse`, `ToolGroup`)

- Every main-loop tool row is one line of a tree: a connector, a status
  mark, the tool name, a dim subject, and a right-aligned duration.
  `├─ ✓ Bash  git log --oneline -1 · 3 lines                      0.8s`
  Connector `├─` in `faint`; the last call of a finished turn draws `└─`
  (the last id is written at `turn.complete`, and the row redraws).
  Running rows draw `├─` always.
- Status mark: `✓` in `ok`, `✗` in `err` (errored or interrupted), `○` in
  `meta` while running. The dot of 0.2 goes away.
- Tool name in `tool`, bold while running, plain once done. Subject as
  today (Bash tokenized, paths in `path`, URLs in `url`) while running;
  once done the whole subject drops to `meta` except paths, which keep
  `path`. The subject wraps never: `wrap: 'truncate-end'` is allowed here
  alone, since ctrl+o shows the whole call. (This is a stated exception
  to the `Global` no-truncate rule, which protects reply text.)
- Right column: the call's wall time from `tool.call` (clock around
  `await next(e)`, keyed by `tool_use_id`, main loop only), formatted
  `0.8s`, `12s`, `1m 04s`, in `meta`; Bash adds `· N lines` before it in
  `faint` from the stored output. Layout: `Box row justifyContent
  space-between`, the right Text `flexShrink 0`.
- Hover: the row `Box` carries `hover: { backgroundColor: rowHover }`.
- Painted Bash output under a standalone row stays as today (3 lines max),
  indented under the subject at the connector's column + 3.
- `ToolGroup` (the engine's folded run of reads and searches) draws one
  tree row: `├─ ◉ +17 completed [3 edits] · ctrl+o to expand` all in
  `faint`, `◉` in `meta`. (A `Click to expand` Button was the first
  design; it never received its press live, dropped 2026-10-03.) A group
  with any errored or interrupted call opens on its own, so a red mark
  never hides behind a count. `/expand` sets `expandAll` and every group
  opens; `/collapse` clears it. The `expanded` set stays for a per-group
  route. (ctrl+o was reported not to open a group either, 2026-10-03;
  the commands are the route that does not depend on the engine's keys.) A group with any errored call adds
  `· N failed` in `err`. While `isActive`, the row ends in `…` instead of
  the button.
- A `Button` never sits inside a `Text`: the validator refuses the tree
  (`Button inside an inline element`). The fold button and the footer's
  `Copy` are sibling boxes in the row, after the text.
- Verify live before shipping: that a `Button` inside a transcript row
  receives `ui.press` (the types say every surface; the mounted test only
  shows the tree validates). If it does not, the fold line is text and
  ctrl+o remains the way in.

### Footer (`TurnDuration`)

- Line 1, the stats, `■` in `faint` then `meta`:
  `■ 2m 26s · 17 actions · 3 edits · 2 failed · $0.58 · 1.8M in · 5.3k out · 90% cached`
  Omitted when zero: actions, edits, failed. `failed` in `err` when
  present. Cost is the delta of `$.session.usage().cost.usd` taken at
  `turn.start` and `turn.complete`, formatted `$0.003` under a cent else
  two decimals; omitted when the host has no ledger. `cached` =
  `cache_read / (input + cache_read + cache_creation)`, in `ok` when
  >= 50%, else `meta` (Empryo's rule). `done 3:31 PM` leaves this line;
  the header above carries the time.
- Right end of line 1: a plain Button `Copy` (`$.ui.copy` of the turn's
  `answer` text stored at `turn.complete`), dim, lit by hover. `Fork` was
  dropped: no engine command to run was confirmed at build time. Same
  live check as the fold button.
- Counts: `actions` = main-loop `tool.call`s this turn; `edits` =
  `Edit`, `Write`, `NotebookEdit` calls across main loop and agents;
  `failed` = calls whose `ToolUse` ended errored or interrupted, counted
  from the `tool.call` result's `isError`.
- The hide rule stays: under 3s with no tools, `display: none`.

### Events after the turn (`UserMessage`, origin `task-notification`)

- Drawn as tree rows under the footer, same geometry as tool rows:
  `├─ ✓ Background agent finished · <summary>           1m 12s`
  `✓` in `ok` unless `task.status` reads as failed, then `✗` in `err`.
  Summary is `e.props.text`'s first line in `meta`; duration from
  `task.durationMs` when present. The last one known draws `└─`.
- `isExpanded` true (ctrl+o) passes to the engine, so the full text shows.

### Background band (`AbovePrompt`)

- Shown while any subagent runs; `display: none` otherwise and whenever
  `hasSurvey`. A one-cell `accent` rail on the left (`▎` per row, as the
  quote bar), header `◌ background · N` with `N` in `accent` bold, the
  elapsed time of the oldest live agent at the right in `meta`.
- One row per live agent, newest last, at most 5, then `+N more` in
  `faint`: `◆ <description, truncated 18> · <model> · <stage>`. `◆` in
  `warn`, description in `bold`, model in `accent`, stage in `meta`. Stage
  is the last tool name that agent called (`tool.call` with its
  `agentId`), or `thinking…` with none yet. Per-agent tokens and cost are
  not in the API (usage lands only at that agent's `turn.complete`): no
  such column, by design, not omission.
- Agent identity: `agent.spawn` gives `tool_use_id`, `description`,
  `subagentType`, `model`; the `agentId` comes from awaiting `next(e)`
  there. Removed at `turn.complete` with that `agentId`.
- Sized to `bodyColumns`, never `viewport.columns`. Rows over `maxRows`
  scroll as the engine provides.

### Spinner

- `Spinner` draws `<word>… · N actions` while `mode` is `tool-use`, else
  the engine's line with the suffix untouched. One `Text`, `meta`.

### Past turns

- Deferred. Empryo dims every past turn and lifts it on hover. The API
  allows it (`Text.hover.dimColor` with a `scope` per message id), but the
  cost is one state read per text block so old blocks redraw at
  `turn.start`, and `dimColor` over colored spans is unverified in
  Ghostty. Try after everything above has shipped; drop if it flickers.

### Palette

- New keys in `Palette`, every palette supplies them: `meta`, `faint`,
  `rowHover`, `accentUser`, `text`. `tidepool`: `meta #7aa2b5`, `faint
  #48708c`, `rowHover #0e2a3a` (the blockBg), `accentUser #7bc0ae`, `text`
  unset (the terminal fg, as today).
- New palette `undertow`, read off the frames, so approximate: bg
  `#16171B`, `text #E7E6E9`, `bold #FFFFFF`, `meta #8A8D94`, `faint
  #52535C`, `accent #5EC8D8`, `accentUser #4FD1A0`, `ok #4FD1A0`, `err
  #E85C6B`, `warn #E8A04C`, `tool #5EC8D8`, `path #D6B477`, `rowHover
  #1E2024`, `blockBg #1C1E23`, the shell kinds from `codex`. Exact values
  need Empryo's `proxysoul-undertow` theme, which is not public.

### Glyphs

Added to `hooks/glyphs.ts`, by code point as the rule requires: `├`
U+251C, `└` U+2514, `│` U+2502, `✓` U+2713, `✗` U+2717, `○` U+25CB, `◉`
U+25C9, `◆` U+25C6, `◌` U+25CC, `■` U+25AA, `▸` U+25B8, `▾` U+25BE. Each
gets a `cellWidth` fixture.

### State

`glass.turns` grows: `turnId`, `startedAt`, `answer`, `edits`, `failed`,
`cacheTokens`, `costUsd`, `lastToolId`. The atoms, all under `plugin:
'glass'`: `turns`, `prompts` (text, submit and start times, turn id; last
48), `calls` (turn id -> main-loop calls with status and wall time; last
48 turns), `folded` (turn ids `/fold` hid), `expandAll` (`/expand`), `expanded` (engine group
request ids the person opened), `agents` (live subagents), `band` (`open`
or `closed`). See the second pass below for what each draws.

### Not drawn, and why

- HISTORY folding of old turns: the engine owns transcript folding.
- Side call rows, `Effort: auto → xhigh` rows, per-agent cost: Empryo
  internals with no event or field in this API.
- Icons per tool kind: the ASCII rule and font variance; the tool name in
  `tool` color is the icon.
- `Review` and `Till pass` footer actions: product features, not drawing.

### Verification

- `claude plugin test .`: a mounted render of each new tree (user row with
  header, a tree row running and done, a group fold, the footer with every
  field, the band with 6 agents), width fixtures for the new glyphs.
- Live in Ghostty: the fold button press, the footer buttons, a `└─` on
  the last row after `turn.complete`, hover on a tree row, the band under
  5 Agent calls, a task-notification row, a 190-column resize.

### Second pass: the Empryo turn pattern (2026-10-02, after the first live look)

The first build drew the tree open under every turn. Empryo folds a
finished turn; these rules replace the ones above where they differ.

- The dots line. Under the assistant header, indented 2: one dot per
  main-loop call in call order, grouped by consecutive tool with a space
  between groups, `ok` green, `err` red, hollow in `meta` while running;
  then two spaces and the summary in `bold`; then a chevron Button.
  Folded (`▸`): the tools in first-seen order with counts, `Bash ×3 ·
  Read ×2`. Unfolded (`▾`): `17 actions · 3 edits · 2 failed`. At the
  right once the turn is done: `⧉ Copy`, a plain dim Button. Drawn only
  for turns glass saw start (`prompts[].turnId`).
- Folding, on demand only (owner's call, 2026-10-03: a finished turn
  folded by itself at first, and the chevron Button never received its
  press live, so the tree was a one-way door). Every turn's tree stays
  open. `folded` holds the turn ids `/fold` tucked away (every finished
  turn in `turns` at that moment); `/unfold` empties it; a new turn
  leaves it at `turn.start`. A folded turn's `ToolUse`, `ToolGroup` and
  `ToolResult` rows draw `display: none`; rows of calls glass never
  recorded (an earlier session, a reload) stay visible. The dots line
  has no chevron: tool counts while live, the totals once done. `calls` records every main-loop
  call under its turn with status and wall time; the tree's duration
  column reads it (the `times` atom is gone).
- The footer line is gone (owner's request, 2026-10-03): the engine's
  `TurnDuration` row draws `display: none`; the dots line carries the
  counts and `Copy`; cost and tokens stay in `turns` for later. A done
  tree row steps everything after the tool name to `faint`, paths and
  the duration included (same request).
- (Superseded.) Footer actions, from the left: `◎ Review`, `↻ Till pass`, `⑂ Fork`,
  `⧉ Copy`. The first three fill the prompt with `/code-review `, `/loop `
  and `/fork ` through `$.prompt.fill`, and each shows only when
  `$.command.list()` at `session.start` has that command. The action
  counts moved to the dots line; the footer keeps time, cost and tokens.
- The band is a rounded frame the band wide, drawn with arc and rule
  glyphs since a border cannot carry a title: top edge `╭─ ◌ background ·
  N ▾ ─── 1m 25s ─╮`, one row per agent `│ ◆ (●‿●) name  model · effort
  stage  tokens  file │` in fixed columns (20, 22, 14, 8, the rest), `+N
  more`, bottom edge `╰─ They outlive this turn ─── /tasks ─╯`. The face
  smiles while the agent thinks and lowers its eyes while it runs a tool.
  Tokens are the sum of the agent's `turn.step` usages, read off each
  stop chunk; `turn.step` streams, so its hook is an async generator that
  relays every chunk. Effort is the step's. The chevron closes the frame
  to one strip: `─ ◌ background · N ▸ ─ (●‿●) (●▾●)  name · stage ───
  1m 25s ─`, measured from its own strings so it is exactly the band
  wide. Per-agent cost stays out (no price table in the API).
- Air between rows (owner's request, 2026-10-03): every tree row (tool,
  group, event, message) draws one row above itself holding only the
  trunk `│` in `faint`, so runs read apart and the tree stays one line.
  Tree rows and their bodies sit 2 cells in from each edge (`TREE_INSET`),
  so the right column ends where the prose measure ends, never on the
  terminal's edge (same request).
- The trunk is concrete (owner's request, 2026-10-03: the `⎿` connector
  and the engine's collapsed body left the line in pieces). Every body
  row under a tool row (`trunked`) carries `│` in `faint` down a 3-cell
  column, as tall as the row once wrapped (`rowsOf`), the content under
  the mark. Every Bash result is glass's: stdout and stderr painted for
  the first 3 lines, the rest `… +N lines`; a failed command's text the
  same way with its error words in `err`; a file-changing one as below. The
  engine keeps only interrupted results and raw escape-coded output. Under
  the turn's last row (`lastToolId`) the column is blank, since the elbow
  above closed the tree. The trade: a long result's ctrl+o expansion is no
  longer the engine's collapsed body; verify live whether the verbose
  transcript still shows the whole output.
  The painted Bash body sits at the engine's own column (`marginLeft 2`,
  where the engine draws its `⎿` for long output) and its unpainted text
  is `private`, the color of a Privately note; `Message from @agent` rows
  take `private` too.
- An Edit's or Write's result (owner's request, 2026-10-03, after
  Empryo's card): `structuredPatch` drawn by glass in place of the
  engine's diff panel. A rounded `faint` frame ON the trunk column
  (`marginLeft TREE_INSET`), so its own left border is the trunk for
  exactly the card's height, wrapped rows included, and the arcs read as
  the line flowing in and out (a glyph column beside the card was the
  first design and came up short beside wrapped rows, 2026-10-03). Sized
  to the hunks (floor 60, cap `columns - 2 * TREE_INSET`), `paddingX 1`. One
  number column in `faint`: the new number on a kept or added line, the
  old on a removed one. `+` in `ok` on an `addBg` row, `-` in `err` on a
  `delBg` row; the tints are not green and red but the band tint and a dim
  plum, so the marker and its color carry the meaning for colorblind
  readers (owner's pick, 2026-10-03, after Empryo's row band); the code painted by the highlighter with the language from
  the path, an ellipsis row between hunks. Past 200 rows the rest folds to
  `… +N lines (ctrl+o to expand)`.
- A Bash result whose command rewrote files (`bashEditDiff` on the
  result) is drawn whole by glass, since the engine's panel for it was the
  last pink thing: the output body painted as a short one is, folded past
  3 lines to a `faint` `… +N lines`, then per file one row of air, a
  header `Updated <path> +a -b` (`Created`, `Deleted` by the flags; verb
  in `meta`, path in `path`, counts in `ok` and `err`) and the Edit diff
  card. `moreFiles` ends it as `… +N more files`. Trade accepted: that
  body loses the engine's ctrl+o expansion of the long output.
- Loader rules learned live: a helper that takes `$` must be a function
  declared at the top of the module, not a closure inside `register`;
  a streaming event's hook must be `async function*`; a `Box` with a
  `hover` style must carry a `key`, or the validator refuses the tree and
  the engine draws its own row (this hid the event rows for two demos).
