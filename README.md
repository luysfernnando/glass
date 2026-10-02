# glass

A desktop-app look for Claude Code's terminal transcript, as a mod.

Claude Code draws replies in one markdown style: inline code in a fixed
lavender, no color for commands, tables in boxes, tool rows in gray. glass
replaces the drawing of assistant replies, tool-row headers and the turn
footer with its own, inside the same TUI. Hooks, skills, MCP, permissions
and Remote Control are untouched: it changes what is drawn, never what is
stored or what the model reads.

## What it draws

- **Commands in color.** Inside backticks and in plain prose: command,
  subcommand, flag, string, path, operator, number, variable, each in its
  own color. In prose a command paints only with evidence (`git push
  --follow-tags` paints, `make sure the build passes` does not).
- **Paths and links anywhere.** `src/main.rs:42:7` with its line number in
  the number color, `README.md`, `.gitignore`, `~/.config/app.toml`. URLs
  underlined; `https` links are real OSC 8 links.
- **A Bottom line card.** A reply opening with `**Bottom line**` and
  `Verified:` / `Issue:` / `Fix:` rows becomes a tinted card with a thin
  bar and colored labels. Forms while streaming, never flickers.
- **Gutter marks.** A `▎` beside any paragraph that asks something of you:
  a question, an instruction, a risk, or a thing Claude did not do. Off for
  turns whose prompt asked for writing.
- **Private notes.** A paragraph opening with `Private` or `Privately`
  draws italic and quiet.
- **Code cards.** Fences on a tinted card sized to the code, a dim language
  header, a line count and gutter past eight lines. The engine's own
  highlighter does the coloring.
- **Headings, lists, quotes, tables.** Bold colored headings with no rules,
  `•` `◦` `☐` `☑` markers, a quote bar, borderless tables with aligned
  columns and right-aligned numbers.
- **Tool rows.** A status dot, the tool name, and the command tokenized,
  one command per line for `&&` chains. Bash output gets paths, numbers,
  error and success words and git status codes painted; collapse and
  ctrl+o keep working.
- **Turn footer.** `12s · 3 tools · 322k ctx · 1.6k out`, hidden for
  trivial turns.

Every width is measured the way the engine measures cells, so emoji and
CJK in tables stay aligned.

## Install

```
claude plugin marketplace add rashedInt32/glass
claude plugin install glass@glass
```

Restart Claude Code. Pick a palette with `/config` under Glass: `tidepool`
(default), `codex` or `rose`. The palettes assume a dark terminal.

To try it from a clone without installing:

```
claude --plugin-dir /path/to/glass
```

## Design

`SPEC.md` is the contract: every element, its exact tree and colors, and
the directions that were tried and rejected, with reasons. Settled through
a design panel and an investigation against how Claude Desktop, the Codex
app and T3 Code render chat.

The `tidepool` palette maps a neovim theme of the same name by role:
strings olive, numbers and inline code pine, commands iris, builtins foam,
paths gold, links mint.

## Development

```
claude plugin validate .
npx tsc -p .            # after the engine has laid .claude-plugin/types
claude plugin test .    # tests/*.test.ts, run in the engine's own sandbox
grep -rnP "[^\x00-\x7F]" hooks/   # must print nothing
```

Every non-ASCII glyph is built from a code point in `hooks/glyphs.ts`.
Literals outside ASCII are forbidden in `hooks/`: the tool path that
writes files has dropped private-use glyphs before.

## Credits

The shell tokenizer, the prose rules, the gutter-mark phrase tables and
the output painter are ported from
[claude-hl](https://github.com/rashedInt32/claude-hl), a PTY wrapper that
did the same job by reading rendered ANSI. glass reads the markdown
instead, which is why it can know a fence's language and never guesses
where a code span ends.

## License

MIT
