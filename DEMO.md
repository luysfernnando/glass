# glass 0.5.0: before and after

How to see each change side by side and tick it off. Two kinds of
evidence: text dumps under `demo/` that `tests/demo.test.ts` writes, and
live steps in Ghostty that only a session can show.

## Setup

Engine: 2.1.295 at planning time (2026-10-11); update to 2.1.296 first and
write the version here: `________`.

Before = the installed `glass@glass` 0.4.25 from the marketplace cache.
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

Text dumps: `claude plugin test .` runs `tests/demo.test.ts`, which writes
`demo/before/*.txt` on the 0.4.25 tree (captured once, committed) and
`demo/after/*.txt` on the 0.5.0 tree. Compare with `diff -u demo/before
demo/after` or open both.

## Painted, in the terminal

```
bun scripts/show.ts              # every fixture, before then after, in color
bun scripts/show.ts diff hint    # only fixtures whose name contains these
```

Before is the installed 0.4.25 in the plugin cache (`GLASS_BEFORE` points
elsewhere), after is this tree. Theme slots resolve through the custom
theme settings.json names, so under `glass-water` the after diff card keeps
the band tint and plum; switch to the stock dark theme to see it go green
and red.

## Dumps (compare in the editor)

The dumps are trees flattened to text: a row's children are joined with
no gap, so a right-aligned duration or button sits flush against the text
(`ran by the API4.2s`, `failed[▾]`). The live rows space them apart.
Colors are listed by what the tree names: a hex is a palette color, a
bare word such as `planMode` is a theme slot the engine resolves.

| fixture | before | after |
| --- | --- | --- |
| `summary.txt` | the reply ends on its last block | one more row ` · summary` in faint |
| `server-tools.txt` | nothing (the TurnDuration row is hidden) | `├─ ✓ advisor  ran by the API   4.2s` with its air row; a second row with no duration |
| `hint-modes.txt` | mode word colors are palette hex | mode word colors read `planMode`, `autoAccept`, `warning` |
| `diff-card.txt` | tints and marks are palette hex | tints and marks read the six `diff*` slot names |
| `dots-line.txt` | no controls | `▸` and `⧉ Copy` at the right end, only if the press retest passed |
| `theme-tidepool.json` (and the other four) | no such file | a theme JSON per palette, every slot a hex |

The fixtures that did not change (Bottom line card, tree rows, the band)
are dumped too, so a diff that touches them is a regression to look at.

## Live steps

Tick each in the after session unless it says otherwise.

**B. Button press (decides Phase 3).** Scratch branch with the `press me`
Button on the dots line. Click it: a toast `pressed`. Tab to it, Enter: the
same. Any press that does not toast fails the retest.
Result: `pass / fail` ________

**S. Summary row.** Run `/compact` after a few turns. The summary reply
ends with a faint ` · summary` row. In the before session the same reply
has no trailer.

**A. Server tool row.** Ask a question that makes Claude consult the
advisor (a second opinion on a design choice; in a session where the
advisor is available). After the reply, under it, a faint tree row names
`advisor` with its duration. Before: nothing after the reply. If no advisor
call happens, this step stays open; the mounted dump covers the drawing.

**N1. Notify, agent finished.** Start a long background agent (`Agent`
with a task of a minute or more, run in the background), let the turn end,
switch to another window. When the agent finishes a native notification
titled `glass` reads `<description> · <duration>`. Before: the engine's
generic notification only, or none.

**N2. Notify, failed turn.** Ask for a command that fails (`cat
/nonexistent`), let the turn end while unfocused. A notification `1 calls
failed · Bash`. Then set `notify` off in `/config` under Glass and repeat:
no glass notification.

**T. Themes.**
1. `/glass-theme` in the after session. A toast `glass: theme glass-tidepool
   on`. The prompt border, the mode words, the spinner and the diff panels
   of the engine's own prompts take tidepool's colors. `ls
   ~/.claude/themes/` shows `glass-tidepool.json` beside `rose-pine.json`,
   and `rose-pine.json` is byte-identical to before (`git diff` on the
   dotfiles repo, or a checksum taken first).
2. If the toast says the set was denied: set `theme` to
   `custom:glass-tidepool` in `/config`, and note the denial in SPEC.md.
3. Switch the palette to `water` in `/config`. The theme follows: the
   prompt border changes with it. Switch back to your own theme in
   `/config`; now change the palette again: your theme stays.
4. Inline code in an engine permission prompt: does it take tidepool's
   `tool` color? Note yes or no in SPEC.md.

**H. Hint line.** Cycle shift+tab through plan, accept edits, auto. The
mode word follows the active theme's `planMode`, `autoAccept`, `warning`.
Under a glass theme nothing moves against the before session; under
rose-pine the word takes rose-pine's slots.

**D. Diff card.** Ask for a one-line edit to a file. The card's `+`/`-`
rows: under a glass theme the band tint and dim plum as before; under the
stock dark theme the engine's green and red.

**R1. Duplicate rows (retest).** A 300+ line reply with lists and fences;
scroll up during streaming and after. No duplicate rows above the
viewport. Record in SPEC.md's Open live checks.

**R2. Tabbed fence (retest).** A fence with tab-indented lines. Four-space
indent inside the tint, once.

**C. Carried checks.** The skill-loaded row sits on the trunk (`/rv` or any
skill); the band stops short of the engine's `[-]` mark with two agents
running; `-- INSERT --` shows in the hint under vim mode.

## Sign-off

Everything above ticked, `demo/after/` committed, then the /rv session on
the diff from `glass--v0.4.25`.
