# glass 0.10.0: before and after

How to see each change side by side and tick it off. Two kinds of
evidence: text dumps under `demo/` that `tests/demo.test.ts` writes, and
live steps in Ghostty that only a session can show.

What 0.10.0 brings, and 0.9.1 before it:

- **0.9.1** `turn.start` ignores subagents' and teammates' turns. Engine
  2.1.299 raises it for them too; 0.9.0 reset its live turn on each, so
  the dots line undercounted, tool rows landed under the agent's turn and
  the finished-agent notification stopped.
- **0.10.0** A `view` Button on every row of the background band opens
  that agent's transcript in the main view (`$.ui.view`, engine 2.1.300);
  the row in view reads `back` and its name takes `accent`.
- **0.10.0** The `crimson` palette: Empryo's crimson world ("the heart"),
  from empryo.com's own CSS, beside `water` and `undertow`.

## Setup

Engine: 2.1.301 (updated 2026-10-16; the typings were regenerated on it).

Before = the installed `glass@glass` 0.9.1 from the marketplace cache.
After = the repo's working tree. Two enabled plugins with one name make the
engine skip one's hooks, so switch between them, never run both:

```
# before
claude plugin enable glass@glass
claude

# after
claude plugin disable glass@glass
command claude --plugin-dir ~/Documents/codes/packages/glass
```

Text dumps: `claude plugin test .` runs `tests/demo.test.ts`, which wrote
`demo/before/*.txt` on the 0.9.1 tree (captured once from `git archive`,
committed) and writes `demo/after/*.txt` on the working tree
(`scripts/demo-dump.sh after`). Compare with `diff -u demo/before
demo/after` or open both.

## Painted, in the terminal

```
bun scripts/show.ts                     every fixture that differs, water
bun scripts/show.ts band                the band: no button, then [view]
GLASS_PALETTE=crimson GLASS_BEFORE_PALETTE=water bun scripts/show.ts --all reply palette quote lists
                                        water on the left block, crimson on the right, same tree
GLASS_PALETTE=crimson bun scripts/show.ts --all
                                        every fixture under crimson (before falls back to tidepool:
                                        0.9.1 has no crimson)
```

Before is the installed 0.9.1 in the plugin cache (`GLASS_BEFORE` points
elsewhere), after is this tree. Theme slots resolve through the custom
theme settings.json names.

## Dumps (compare in the editor)

The dumps are trees flattened to text: a row's children are joined with
no gap, so a right-aligned duration or button sits flush against the text.
Colors are listed by what the tree names: a hex is a palette color, a
bare word such as `planMode` is a theme slot the engine resolves.

| fixture | before | after |
| --- | --- | --- |
| `band.txt` | rows end on the file column | every row ends `[view]`; the file column is five cells shorter |
| `reply-crimson.txt` | no such file | the reply fixture under crimson: crimson `#f43a6b` marks and bars, violet `#ab7bf0` code, amber `#f2a94c` strings |
| `reply-water.txt` | no such file | the same reply under water, for the eye |
| `palette-crimson.txt` | no such file | every crimson role, one row each, its hex |
| `palette-water.txt` | no such file | every water role, one row each |

The fixtures that did not change (reply, summary, dots line, tree rows,
diff card, hint modes, server tools) are dumped too, so a diff that
touches them is a regression to look at.

## Live steps

Tick each in the after session unless it says otherwise.

**V1. View.** Start two background agents (`Agent` with tasks of a minute
or more, run in the background). The band shows a `view` at the right end
of each row. Click one: the main view switches to that agent's transcript,
as choosing it from `/tasks` does; the band stays, that row now reads
`back` and its name is in `accent`. Before: no button; `/tasks` is the
only way in.
Result: `pass / fail` ________

**V2. Back.** Click `back`: the main conversation returns, the row reads
`view` again. Also try Esc from the agent view and note whether it
returns on its own.

**V3. Denied.** Let an agent finish while its row still shows (the band
drops it at its `turn.complete`; be quick, or view an agent that stops
right after). A press the engine declines shows a toast `glass: <reason>`
and the view stays. If no deny can be provoked, this step stays open.

**V4. Older engine.** Not testable here (2.1.301 is installed): on an
engine without `$.ui.view` the button draws and a press toasts `glass:
viewing an agent needs Claude Code 2.1.300 or newer`.

**C1. Crimson.** `/config`, Glass, palette `crimson`. Inline commands turn
crimson, builtins violet, flags pink, strings amber, paths soft sky; the
reply bullet, tool names and the Bottom line bar are crimson; the code
and Bottom line cards sit on the plum `#301a34`. Before: the option is
not offered.

**C2. Crimson theme.** `/glass-theme` under crimson: a toast `glass: theme
glass-crimson on`; the prompt border, the mode words and the spinner take
crimson's colors; `ls ~/.claude/themes/` shows `glass-crimson.json`.
Check the plum card tint and the `#664468` rules on your own ground
(the audit ground is `#0d1117`); note a value to lift in SPEC.md.

**C3. Water stays.** Switch back to `water`: nothing in water moved
(the water dumps are byte-identical before and after).

**G. Guard (0.9.1, both sessions on 2.1.301).** Ask for a task that
spawns a subagent in the turn and runs two or three tools of its own
after. Before (0.9.0 from the cache, if kept): the dots line's tool count
restarts when the agent's turn starts, and the tools after it land under
no tree. After: the count runs on and every tool row sits in the turn's
tree. Then let a background agent finish after the turn ends, unfocused:
the `<description> · <duration>` notification fires (it did not on 0.9.0
under 2.1.299 or later).
