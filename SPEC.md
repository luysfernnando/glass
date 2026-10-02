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
  exceeds 8 lines: dim uppercase language left, dim `N lines` right. `Code`
  below with the engine's highlighter, a gutter from line 1 once over 8
  lines.
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
- Bash result bodies of at most 3 lines are redrawn (`hooks/output.ts`,
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
  Drawn from `$.state` `glass.lastTurn`, written at `turn.complete`.

## Palette

`tidepool` (default) maps the owner's nvim theme by role; `codex` and
`rose` carry claude-hl's sets. Every palette supplies the full `Palette`
type in `hooks/palette.ts`. Not ported from claude-hl, on purpose: the
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
