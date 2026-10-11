# glass 0.5.0: tasks

Ordered by dependency. Each task names what it changes, how it is proved,
and what blocks it. SPEC.md is the contract; a task that needs a rule the
spec does not have stops and adds the rule first. Check off in place.

Engine at planning time: 2.1.295 installed, 2.1.296 latest. Glass 0.4.25
installed from the marketplace cache; the repo is the working tree.

## Phase 0: baseline and retests (no glass code changes)

Progress 2026-10-11: T0.1, T0.2, T1.1 to T1.7, T2.0 to T2.3 (code), T3.1
(code, gated), T4.1 done; checks green (validate, tsc, 76 tests, ASCII,
manifests at 0.5.0). Open: the live steps T0.3, T0.4, T0.5, T2.4 and the
DEMO.md walk, then T4.3 commits, T4.4 /rv, T4.5 release.

- [x] **T0.1 Update the engine.** `claude update` to 2.1.296. Record the
      version in DEMO.md. Blocks: nothing. Proof: `claude --version`.
- [ ] **T0.2 Before dumps.** Add `tests/demo.test.ts`: mounts the fixtures
      DEMO.md lists (a reply with a Bottom line, a summary-shaped reply, a
      turn with tree rows and a diff card, the dots line, the hint line in
      each mode, the band) through the existing `lines()` helper and
      writes `demo/before/<fixture>.txt`. Run it once on the 0.4.25 tree,
      commit `demo/before/`. Then flip its target to `demo/after/`.
      Blocks: nothing. Proof: `demo/before/` has one file per fixture.
- [ ] **T0.3 Button press retest (DEMO.md step B).** On a scratch branch,
      put one plain Button labelled `press me` on the dots line that
      toasts `pressed` on `onPress`. Load with `--plugin-dir`, click it,
      Tab to it and press Enter. Record pass or fail in SPEC.md under
      Buttons. Revert the scratch change. Blocks: T0.1. Gates: T3.
- [ ] **T0.4 Duplicate rows retest (DEMO.md step R1).** Ask for a reply of
      300+ lines with lists and fences, scroll during streaming, look for
      duplicate rows above the viewport. Record the result in SPEC.md's
      Open live checks. If it still reproduces, file the drafted engine
      issue. Blocks: T0.1.
- [ ] **T0.5 Tabbed fence retest (DEMO.md step R2).** A fence with
      tab-indented lines. Expect four-space indent inside the tint, as
      0.4.18 drew it, and no double expansion. Blocks: T0.1.

## Phase 1: additions with no gate

- [ ] **T1.1 Summary trailer.** In the `AssistantMessage` hook, when
      `e.props.isSummary` is true, `renderReply` takes `summary: true`
      and appends one row ` · summary` in `faint`, `marginTop 0`, at the
      prose indent. The prop is passed on untouched. Test: a mounted
      reply with and without the flag; the last row's text and color.
      Blocks: none. Proof: `claude plugin test .` green, `demo/after/`
      has `summary.txt`.
- [ ] **T1.2 Server tool records.** `GlassTurn` gains
      `serverTools: { id, name, startedAt, endedAt? }[]` (types and the
      state contract). In the `turn.step` hook, for the main loop only,
      read `step.value.serverToolUses` at the generator's end and push
      them to `live.serverTools`; `turn.complete` writes them to the
      turn. Test: a turn record with two server tools round-trips. Blocks:
      none.
- [ ] **T1.3 Server tool rows.** The `TurnDuration` hook reads `turns`,
      finds its turn by `durationMs`, and when `serverTools` is non-empty
      draws one tree row per entry (`renderServerToolRow` in `chrome.ts`:
      `├─ ✓ advisor  ran by the API   4.2s`, colors per SPEC), each with
      its air row; otherwise `display: none` as today. Test: mounted rows
      with and without `endedAt`; the empty case stays hidden. Blocks:
      T1.2. Proof: `demo/after/server-tools.txt`.
- [ ] **T1.4 Notify: agent finished.** In `turn.complete` with
      `e.agentId`, when `live.turnId` is empty (no main-loop turn live),
      call `notify($, text)` where `notify` guards `typeof
      $.ui.notify === 'function'`, reads the `notify` option, and falls
      back to `$.ui.toast` when `isSent` is false. Text per SPEC. Blocks:
      T1.6.
- [ ] **T1.5 Notify: failed turn.** In the main loop's `turn.complete`,
      when `live.failed > 0`, notify `N calls failed · <tool>`. Blocks:
      T1.6.
- [ ] **T1.6 Notify option.** `userConfig.notify` (boolean, default true,
      title `Notifications`, description per SPEC) in `plugin.json`; a
      `config.set` hook on `glass.notify` swaps the module binding, as the
      palette hook does. Test: the option parses; a `config.set` flips it.
      Blocks: none.
- [ ] **T1.7 Forward theme keys.** The hint line's mode word takes
      `planMode`, `autoAccept`, `warning`, `meta`. The diff card's row
      tints and marks take the six diff slots. Test: the rendered props
      carry the literal slot names. Blocks: none. Note: `demo/after/`
      diff and hint dumps will show slot names where `before/` shows hex;
      that is the expected diff.

## Phase 2: glass themes

- [ ] **T2.1 `hooks/theme.ts`.** `themeFor(palette, name)` returns `{
      name: 'glass-<name>', base: 'dark', overrides }` from the SPEC
      table; `themeJson(...)` serialises it. Pure, no `$`. Test
      (`tests/theme.test.ts`): all five palettes, every slot present,
      every value `#rrggbb`, `text` omitted when the palette has none.
      Blocks: none.
- [ ] **T2.0 Hardening pass first.** T2.2 writes a file under the home
      directory from a plugin. Before writing it, run the
      `security-and-hardening` skill on the plan: the path is built from
      `HOME` and a palette name from a closed list, never from prompt
      text; the write targets only `~/.claude/themes/glass-<palette>.json`;
      the JSON is serialised, never templated. Record the outcome here.
      Outcome (2026-10-11): trust boundaries are the `palette` option
      (an engine-validated enum, mapped again through `paletteNameOf` to
      one of five literals) and `HOME` (the user's own environment;
      refused when unset or relative). The only destructive step is the
      overwrite of `glass-<palette>.json`; the name cannot traverse, and an
      existing entry that is a link or not a regular file is refused. Values
      are hex-checked before serialisation. No secrets, PII or network are
      involved. The owner's other theme files are never read or written.
- [ ] **T2.2 `/glass-theme` command.** Registered at `session.start`.
      Handler: `HOME` via `$.env.get`, `$.fs.write` to
      `~/.claude/themes/glass-<palette>.json`, then `$.config.set({ key:
      'theme', value: 'custom:glass-<palette>' })`; toast per SPEC on
      success and on `deny`. Never touches any other file. Blocks: T2.1.
      Proof: DEMO.md step T.
- [ ] **T2.3 Palette switch keeps the theme in step.** Extend the
      `glass.palette` `config.set` hook: after swapping the palette, if
      `$.config.list()` shows `theme` as `custom:glass-*`, run the T2.2
      write and set for the new palette. Blocks: T2.2. Proof: DEMO.md
      step T, part 3.
- [ ] **T2.4 Live checks.** Whether `config.set` accepts `custom:` from a
      plugin; whether codespans in engine-drawn text take `permission`
      under `glass-tidepool`. Record both in SPEC.md's Known limits.
      Blocks: T2.2. Result 2026-10-11, headless on 2.1.296: `config.set`
      refuses `custom:` (built-in names only); the file was written as
      `glass-water.json`, rose-pine's checksum unchanged. Messages and
      SPEC updated. Codespan check still open: needs the theme selected
      in settings.json and an interactive session.

## Phase 3: Buttons (gated on T0.3 passing)

- [ ] **T3.1 Dots-line Buttons.** `▸`/`▾` toggles this turn's id in
      `foldedTurns` and invalidates; `⧉ Copy` calls `$.ui.copy({ text:
      turn.answer, surface: press.surface })`. Plain, `faint`, hover,
      keyed, `label` only. Add `⧉` U+29C9 to glyphs with a width fixture.
      Test: the mounted user row validates with both; a press on the
      chevron flips the fold through the kit's `press`. Blocks: T0.3 pass.
- [ ] **T3.2 If T0.3 failed.** Delete the gated bullets from SPEC.md
      (user row, Buttons, glyphs) and note the date. Blocks: T0.3 fail.

## Phase 4: docs, demo, release

- [ ] **T4.1 README.** Engine floor 2.1.295; the `notify` option; the
      `/glass-theme` command and what it writes; the Buttons if shipped.
- [ ] **T4.2 After dumps.** Run `tests/demo.test.ts` targeting
      `demo/after/`; commit. Walk DEMO.md end to end in Ghostty and tick
      its live steps. Blocks: all of Phase 1 to 3.
- [ ] **T4.3 `scripts/check.sh` green**, both manifests at `0.5.0`,
      commit `0.5.0: <rule>` per feature as the log does (one commit per
      task is fine). Blocks: T4.2.
- [ ] **T4.4 /rv session** on the diff from `glass--v0.4.25`. Fix what it
      finds, re-run T4.3. Blocks: T4.3.
- [ ] **T4.5 Release.** `claude plugin tag .`, push, `claude plugin update
      glass@glass`, restart, one last pass over DEMO.md on the installed
      copy. Blocks: T4.4.

## Not in this pass

- A per-group fold button (density pass, 2026-10-03).
- `maxProseWidth` (owner rejected a prose cap, 2026-10-02).
- Past turns dimmed on hover (SPEC, Not drawn).
- Any notify case beyond the two in SPEC.
