import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, RenderElement, Register } from 'claude-code'

import type { GlassAgent, GlassCall, GlassServerTool, GlassTurn } from '../types'
import { safeText, shortModel, MAX_PAINTED_LINES, toolText, callRun, renderActivityRow, spinCells, clockCells, fmtToolTime, isEditTool, setCwd, setHome, shortPath, renderAgentLaunch, renderBashResult, renderDiff, renderEventRow, renderMessageRow, renderNoOutput, renderPluginRow, renderPromptBubble, renderReplyBubble, promptWidth, renderServerToolRows, renderShot, renderSkillLoad, shotCells, renderToolError, renderToolOutput, isDeclined, renderDeclined, renderCallRow, renderCallCard, outputPreview, CARD_LINES } from './chrome'
import type { CallRow, ChangedFile, Hunk, RunCall } from './chrome'
import { G } from './glyphs'
import { parseMarkdown } from './markdown'
import type { Block } from './markdown'
import { PALETTES, paletteNameOf, paletteNamed } from './palette'
import type { Palette, PaletteName } from './palette'
import { themeFileName, themeFor, themeJson, themeSetting } from './theme'
import { writeIntent } from './prose'
import { HINT } from './hint'
import { blocksHtml, blocksText } from './html'
import { clipboardCommands } from './clipboard'
import type { ClipboardBackend } from './clipboard'
import { copyControl, renderReply } from './render'
import type { Copyable, CopyFormat } from './render'
import { CONVERTIBLE, hashOf, namedIn, pictureOf, pictureReadOrder, readPath, shotFromPng } from './shot'
import type { Picture, Shot } from './shot'

// The turns this session, newest last. A user row finds its own turn in
// here: a `read` while a render hook runs subscribes that row, so every
// `update` draws every user row again, and each must still find its data.
const turns = atom({ plugin: 'glass', key: 'turns' } as const, [] as GlassTurn[])
// every main-loop call by turn, for the agent-hud and status readers
const calls = atom({ plugin: 'glass', key: 'calls' } as const, {} as Record<string, GlassCall[]>)
// the activity lines the person opened (`run:<head call>`)
const expanded = atom({ plugin: 'glass', key: 'expanded' } as const, [] as string[])
// subagents still running, for their models on the hint line
const agents = atom({ plugin: 'glass', key: 'agents' } as const, [] as GlassAgent[])
// the main-loop turn now running, or null between turns. State, not module
// memory: a hot reload mid-turn rebuilds the module but the host keeps this,
// so an agent finishing inside that turn is not mistaken for one that
// finished after it (review finding, 0.5.1)
const liveTurn = atom({ plugin: 'glass', key: 'liveTurn' } as const, null as string | null)

const HISTORY = 48
// chars of a streaming call's input read for its subject: the path and the
// description come first, a Write's content after them
const INPUT_HEAD = 2000
// finished replies whose parse is kept for their redraws
const PARSED_MAX = 64

const ANSWER_MAX = 20000

const ESC = String.fromCodePoint(0x1b)
// Live things, ticked once a second: main-loop calls still running (their
// row's clock is a Raster the ticker blits, no redraw) and subagents still
// running (the status line under the prompt). Module state, read by no
// render hook, so a tick redraws nothing in the transcript (2026-10-04).
const liveCalls = new Map<string, { tool: string; t0: number }>()
// rows drawing a running span (renderActivityRow), by request id: the ticker
// blits their spinner's next frame
const spinRows = new Set<string>()
// the key a reply is known by: the start of its text, spaces out
const textKey = (text: string): string => text.replace(/\s+/g, '').slice(0, 40)
// a tick each spinner frame; the clocks read whole seconds
const TICK_MS = 100
let ticker: { cancel: () => void } | null = null

async function tick($: EngineInterface, p: Palette): Promise<void> {
  const now = await $.clock.now()
  for (const [id, c] of liveCalls) {
    void $.ui.blit({ requestId: id, key: 'clock', cells: clockCells(now - c.t0, p.meta) }).catch(() => undefined)
  }
  for (const id of spinRows) {
    void $.ui.blit({ requestId: id, key: 'spin', cells: spinCells(now, p.meta) }).catch(() => undefined)
  }
  // nothing runs: the ticker stops (no status line: the owner found it noise
  // under the prompt, 2026-10-04)
  if (liveCalls.size === 0) {
    spinRows.clear()
    ticker?.cancel()
    ticker = null
  }
}

// A native notification for what the engine stays silent on (0.5.0): the
// engine's own idle notification covers a finished turn, so glass never
// notifies at turn end. On an engine without `$.ui.notify`, or a channel
// that did not send, the text is a toast instead. Never called from a
// render hook, a timer, or on hearing a notification.
// `$.ui.notify` is typed from 2.1.295 on; the call is spelled at the call
// site (the validator asks for `$.noun.event(...)`), typed through a cast of
// `$`, and an engine without it throws into the toast fallback.
type Notifier = { ui: { notify: (text: string, options?: { title?: string }) => Promise<{ isSent: boolean }> } }
async function notifyPerson($: EngineInterface, text: string): Promise<void> {
  try {
    const r = await ($ as unknown as Notifier).ui.notify(text, { title: 'glass' })
    if (r.isSent) return
  } catch {
    // no notify on this engine, or the channel failed: the toast below
  }
  try {
    $.ui.toast(text)
  } catch {
    // a notification is never worth a failed hook
  }
}

// Writes a palette's theme to ~/.claude/themes/glass-<palette>.json and
// selects it (0.5.0). The one file glass writes outside its own folder:
// the directory comes from HOME, the name from the closed palette list, the
// content is serialised from hex-checked values. An existing entry under
// that name that is not a regular file (a link, a directory) is left alone.
// The owner's own theme files are never touched. Returns the line to show.
// The engine prefixes a command's answer with the plugin's name, so the
// lines carry none. The engine's `theme` row takes only its built-in names
// from a plugin (seen 2.1.296: `takes one of: auto, dark, light, ...`), so
// the select step is tried and, when refused, the answer names the one
// settings.json line that selects a custom theme.
async function installTheme($: EngineInterface, name: PaletteName): Promise<string> {
  const home = await $.env.get('HOME')
  if (!home || !home.startsWith('/')) return 'HOME is not set, so no theme was written'
  const dir = `${home}/.claude/themes`
  const file = themeFileName(name)
  const shown = `~/.claude/themes/${file}`
  try {
    const hit = (await $.fs.list(dir)).find(x => x.name === file)
    if (hit && (hit.isLink || hit.kind !== 'file')) return `${shown} is not a regular file; nothing written`
  } catch {
    // no themes directory yet: the write creates it
  }
  try {
    await $.fs.write(`${dir}/${file}`, themeJson(themeFor(PALETTES[name], name)))
  } catch {
    return `could not write ${shown}`
  }
  const setting = themeSetting(name)
  const byHand = `wrote ${shown}. A plugin cannot select a custom theme, so pick glass-${name} in /theme.`
  try {
    const r = await $.config.set({ key: 'theme', value: setting })
    if (r.deny) return byHand
  } catch {
    return byHand
  }
  return `theme glass-${name} on (${shown})`
}

// A Bash call's body as glass draws it, or null where the engine's stays.
// Drawn under the ToolUse row from its own `output` (2026-10-04): calls run
// in parallel drew their row with no ToolResult under it, so the body went
// missing; the ToolResult row then draws nothing where this is non-null.
function bashBody(t: Elements['terminal'], p: Palette, output: unknown, isErrored: boolean, cols: number): RenderElement | null {
  if (isErrored) {
    if (typeof output !== 'string' || output.trim() === '') return null
    return renderToolOutput(t, p, output.replace(/\s+$/, '').split('\n'), { columns: cols, maxLines: MAX_PAINTED_LINES })
  }
  const r = bashResult(output)
  if (!r) return null
  if (r.files.length > 0) return renderBashResult(t, p, r.lines, r.files, { maxLines: MAX_PAINTED_LINES, moreFiles: r.moreFiles, columns: cols })
  if (r.lines.length === 0) return renderNoOutput(t, p)
  if (r.lines.some(l => l.includes(ESC))) return null
  return renderToolOutput(t, p, r.lines, { columns: cols, maxLines: MAX_PAINTED_LINES })
}

// A finished Bash call's output lines and the files it rewrote; null for an
// interrupted call or an output that is not the Bash record
function bashResult(output: unknown): { lines: string[]; files: ChangedFile[]; moreFiles: number } | null {
  const out = output as { stdout?: unknown; stderr?: unknown; interrupted?: unknown; bashEditDiff?: unknown } | undefined
  if (!out || typeof out !== 'object' || typeof out.stdout !== 'string' || out.interrupted === true) return null
  const stderr = typeof out.stderr === 'string' ? out.stderr : ''
  const text = [out.stdout, stderr].filter(s => s.trim() !== '').join('\n').replace(/\s+$/, '')
  const diff = out.bashEditDiff as { files?: unknown; moreFiles?: unknown } | undefined
  const files = Array.isArray(diff?.files)
    ? (diff!.files as ChangedFile[]).filter(f => f && typeof f.filePath === 'string' && Array.isArray(f.hunks)).map(f => ({ ...f, hunks: f.hunks.filter(h => h && typeof h.oldStart === 'number' && typeof h.newStart === 'number' && Array.isArray(h.lines)) }))
    : []
  return { lines: text === '' ? [] : text.split('\n'), files, moreFiles: typeof diff?.moreFiles === 'number' ? diff.moreFiles : 0 }
}

// Screenshots draw outside tmux only (0.6.0): inside it the engine's text
// body stays, unless CLAUDE_CODE_FORCE_TERMINAL_IMAGES vouches that pictures
// reach the terminal. sluice passes the engine's kitty codes through as they
// are, so pictures draw there (live, 2026-10-28).
let inTmux = false
// the `screenshots` option (0.7.0): off, every screenshot row keeps the
// engine's text body, in tmux and out; follows /config live. Off unless
// turned on (0.17.1): a devtools run takes a screenshot a step, and drawn
// they buried the turn's result.
let shotsOn = false
const isOn = (v: unknown) => v === true || v === 'true'

// Pictures Claude looked at (0.8.0): MCP screenshots in any format, and
// image files it read. `home` and the person's recent prompts tell which
// files they fed Claude themselves; those are never drawn back.
let home = ''
// as many prompts as `$.session.messages()` hands back: a picture named
// long ago stays the person's
const PROMPTS_MAX = 4096
// prompt origins no person typed (PromptOrigin)
const MACHINE_ORIGINS = new Set(['task-notification', 'peer', 'peer-send-message', 'projects-relay', 'coordinator', 'observer', 'observer-activity', 'auto-continuation'])
const READ_PATHS_MAX = 8192

// What tells a Read picture the person fed Claude from one Claude found, per
// load: a reload starts empty and reads the conversation again.
type PictureMemory = {
  prompts: string[]
  // each Read's file, by its tool_use_id: the ToolResult row carries no
  // input, so the row learns its path here (tool.call, a ToolUse or
  // ToolGroup row, or the conversation)
  readPaths: Map<string, string>
  history: Promise<boolean> | null
  loaded: boolean
}
const pictureMemory = (): PictureMemory => ({ prompts: [], readPaths: new Map(), history: null, loaded: false })
function notePrompt(m: PictureMemory, text: string) {
  m.prompts.push(text)
  if (m.prompts.length > PROMPTS_MAX) m.prompts.shift()
}
function noteRead(m: PictureMemory, id: unknown, input: unknown) {
  const path = readPath(input)
  if (typeof id !== 'string' || path === '') return
  m.readPaths.set(id, path)
  if (m.readPaths.size > READ_PATHS_MAX) m.readPaths.delete(m.readPaths.keys().next().value!)
}
const isNamed = (m: PictureMemory, path: string) => namedIn(m.prompts, path, home)
// The conversation so far, read before the first Read picture draws: a
// resumed session's prompts and reads, which no prompt.submit or tool.call
// of this load saw. Every user message counts as named, a task
// notification's too: that only keeps a picture back. When the read fails,
// no Read picture draws, and the next draw reads again. A draw waits on the
// read HISTORY_MS at most: past that its picture keeps the engine's row and
// a later draw finds the read done.
const HISTORY_MS = 2000
function loadHistory($: EngineInterface, m: PictureMemory): Promise<boolean> {
  if (m.loaded) return Promise.resolve(true)
  m.history ??= Promise.resolve().then(() => $.session.messages()).then(messages => {
    for (const msg of messages) {
      if (msg.role === 'user' && msg.text !== '') notePrompt(m, msg.text)
      for (const u of msg.toolUses) if (u.tool === 'Read') noteRead(m, u.tool_use_id, u.input)
    }
    m.loaded = true
    return true
  }, () => {
    m.history = null
    return false
  })
  // where the clock cannot sleep (the test kit), the draw waits for the read
  const waited = $.clock.sleep(HISTORY_MS).then(() => false, () => new Promise<never>(() => {}))
  return Promise.race([m.history, waited])
}
// whether a Read's picture may draw: its file is known and the person did
// not name it
async function readDraws($: EngineInterface, m: PictureMemory, path: string | undefined): Promise<boolean> {
  return (await loadHistory($, m)) && path !== undefined && path !== '' && !isNamed(m, path)
}

// A picture's body, or null where the engine's stays.
async function pictureBody($: EngineInterface, t: Elements['terminal'], p: Palette, pic: Picture, columns: number, rows: number): Promise<RenderElement | null> {
  if (!shotsOn || inTmux) return null
  const shot = await shotFor($, pic)
  return shot ? renderShot(t, p, shot, shotCells(shot, columns, rows)) : null
}

// A PNG draws as it is; any other picture, or one over 2 MiB, is converted
// once to a PNG with macOS `sips` and kept for the session's redraws. Where
// that fails (no sips: Linux) the engine's text row stays. The key is the
// bytes Claude read, never the file's path: a file read twice may hold two
// pictures (a screenshot taken again to the same path).
const converted = new Map<string, Promise<Shot | null>>()
const CONVERTED_MAX = 64
// One conversion at a time: two started together after a reload lost one
// `$.process.run` result, and that row waited on it for good (live,
// 2026-10-28). One that has not finished in CONVERT_MS frees the queue and
// leaves the cache, so the next draw tries again; one that failed stays
// failed (no sips: Linux).
let convertQueue: Promise<unknown> = Promise.resolve()
const CONVERT_MS = 8000
const TIMED_OUT: unique symbol = Symbol('timed out')
async function shotFor($: EngineInterface, pic: Picture): Promise<Shot | null> {
  if (pic.mime === 'image/png') {
    const shot = shotFromPng(pic.data)
    if (shot) return shot
  }
  if (!CONVERTIBLE.test(pic.mime)) return null
  const key = hashOf(pic.data)
  let job = converted.get(key)
  if (!job) {
    // the budget starts when the job does, not while it waits its turn;
    // where the clock cannot sleep (the test kit), nothing times out
    const run = convertQueue.then(() => Promise.race([
      convertPicture($, pic.data, key).catch(() => null),
      $.clock.sleep(CONVERT_MS).then((): typeof TIMED_OUT => TIMED_OUT, () => new Promise<never>(() => {})),
    ]))
    convertQueue = run.catch(() => undefined)
    job = run.then(shot => {
      if (shot !== TIMED_OUT) return shot
      converted.delete(key)
      return null
    })
    converted.set(key, job)
    if (converted.size > CONVERTED_MAX) converted.delete(converted.keys().next().value!)
  }
  return job
}

// A private folder for converted pictures, made once per load: per user,
// mode 700, owned by this user and not a link; files a day old go.
let shotDirJob: Promise<string | null> | null = null
function shotDir($: EngineInterface): Promise<string | null> {
  shotDirJob ??= $.process.run(['sh', '-c', [
    'base="${TMPDIR:-/tmp}"; base="${base%/}"; d="$base/glass-pictures-$(id -u)"',
    'mkdir -m 700 -p "$d" 2>/dev/null',
    '[ -d "$d" ] && [ ! -L "$d" ] && [ -O "$d" ] || exit 1',
    'find "$d" -type f -mtime +1 -delete 2>/dev/null; printf "%s" "$d"',
  ].join('\n')]).then(r => (r.exitCode === 0 && r.stdout.startsWith('/') ? r.stdout.trim() : null), () => null)
  return shotDirJob
}

// the most a converted PNG may weigh on disk to draw as bytes
const PNG_BYTES_MAX = 2 * 1024 * 1024
async function convertPicture($: EngineInterface, data: string, name: string): Promise<Shot | null> {
  const dir = await shotDir($)
  if (!dir) return null
  const out = `${dir}/${name}.png`
  // converted before, by this load or an earlier one (a resume, a reload):
  // the name is the bytes' own, so the PNG is the same; read it back
  if (await $.fs.stat(out).then(s => s.kind === 'file' && s.size <= PNG_BYTES_MAX, () => false)) {
    const { base64 } = (await $.fs.read(out, { as: 'bytes' })) as { base64: string }
    const shot = shotFromPng(base64)
    if (shot) return shot
  }
  // Each run writes its own scratch files: a run that timed out keeps going,
  // and its retry, or another session converting the same bytes, must not
  // rewrite the source under its sips (a truncated read draws grey).
  const run = `${dir}/${name}.${Math.random().toString(36).slice(2, 10)}`
  try {
    return await convertRun($, data, `${run}.src`, `${run}.part.png`, out)
  } finally {
    await $.process.run(['rm', '-f', `${run}.src`, `${run}.part.png`]).catch(() => undefined)
  }
}

async function convertRun($: EngineInterface, data: string, input: string, part: string, out: string): Promise<Shot | null> {
  // from the bytes Claude read, never the file on disk, which may have
  // changed since; through stdin, which takes any size (argv stops near 1 MiB)
  const w = await $.process.run(['sh', '-c', 'base64 -D > "$0"', input], { stdin: data })
  if (w.exitCode !== 0) return null
  // the longest side, so every retry shrinks: `-Z` alone would also blow a
  // small picture up
  const g = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', input])
  const sides = [...g.stdout.matchAll(/pixel(?:Width|Height): (\d+)/g)].map(m => Number(m[1]))
  if (g.exitCode !== 0 || sides.length !== 2) return null
  const longest = Math.max(...sides)
  // as it is first, then smaller while the PNG weighs over 2 MiB; written
  // under the part name and moved into place once it draws, so a read of
  // `out` (another session's) never sees half a PNG
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    const side = Math.max(1, Math.round(longest * scale))
    const r = await $.process.run(['sips', '-s', 'format', 'png', ...(scale < 1 ? ['-Z', String(side)] : []), input, '--out', part])
    if (r.exitCode !== 0) return null
    // past the limit the bytes cannot draw: shrink without reading them
    const size = await $.fs.stat(part).then(s => s.size, () => Infinity)
    if (size > PNG_BYTES_MAX) continue
    const { base64 } = (await $.fs.read(part, { as: 'bytes' })) as { base64: string }
    const shot = shotFromPng(base64)
    if (!shot) return null
    await $.process.run(['mv', '-f', part, out]).catch(() => undefined)
    return shot
  }
  return null
}

// one main-loop call recorded under its turn, replacing an earlier record
// of the same id
async function setCall($: EngineInterface, turnId: string, call: GlassCall) {
  await update($, calls, r => {
    const record = { ...(r ?? {}) }
    const list = record[turnId] ?? []
    const i = list.findIndex(c => c.id === call.id)
    record[turnId] = i < 0 ? [...list, call] : [...list.slice(0, i), call, ...list.slice(i + 1)]
    return record
  })
}

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as { palette?: unknown; notify?: unknown; screenshots?: unknown; hint?: unknown }
  // the palette follows /config live: every hook reads this binding at
  // draw time, and the config.set hook below swaps it (rows already drawn
  // keep their colors until something redraws them)
  let palette = paletteNamed(opts.palette)
  let paletteName = paletteNameOf(opts.palette)
  // notifications (0.5.0): on unless the option says otherwise; follows /config live
  let notifyOn = opts.notify !== false
  shotsOn = isOn(opts.screenshots)
  // the formatting hint: on unless the option says otherwise; sent with the
  // first prompt of a session and the first after a compaction
  let hintOn = opts.hint !== false
  let hintDue = true
  // gutter marks are off for a turn whose prompt asked for writing: the
  // reply is then the thing itself and asks nothing of the reader
  let marks = true
  // the names and types of subagents this session spawned: their folded
  // `Message from` rows hide, since the finished row says the same
  const spawned = new Set<string>()
  // agentId to the description it was spawned with, for a resume that has none
  const agentLabels = new Map<string, string>()
  // each agent's model, kept after it finishes: its transcript stays openable
  const agentModelIds = new Map<string, string>()
  let viewedAgent: string | undefined
  // Call rows read these module records, never an atom: a read in a render
  // hook subscribes the row, and every write then redraws every row of the
  // turn, which strands duplicate rows above the viewport (2026-10-03).
  const callTurn = new Map<string, string>()
  const callMs = new Map<string, number>()
  // rows of a group the engine unfolded: no ToolResult of their own, so the
  // ToolUse hook draws an Edit's or a Write's card under the row
  const grouped = new Set<string>()
  // each turn's main-loop calls in order, whether Claude wrote text since
  // the call before (a run of calls ends there), and what each call did
  const turnOrder = new Map<string, { id: string; tool: string; afterText: boolean; subject: string }[]>()
  const failedCalls = new Set<string>()
  // each subagent's `textSinceCall`: whether it wrote text since its last call
  const agentText = new Map<string, boolean>()
  // calls that launched a background task or agent, until its notification
  // or its turn.complete says it ended; keyed back from the task's id
  const backgroundCalls = new Set<string>()
  const taskCalls = new Map<string, string>()
  /** A background call's task ended: its run's row takes its tick or cross. */
  const finishBackground = (toolId: string, failed: boolean) => {
    if (!backgroundCalls.delete(toolId)) return false
    if (failed) failedCalls.add(toolId)
    return true
  }
  const runCtx = (): RunCtx => ({ callTurn, turnOrder, callMs, failedCalls, backgroundCalls, palette, isAllOpen: expandAllNow })
  /** Records a main-loop call of the turn, in place when it is already there. */
  const recordCall = (turnId: string, call: { id: string; tool: string; afterText: boolean; subject: string }) => {
    const list = turnOrder.get(turnId) ?? []
    const at = list.findIndex(c => c.id === call.id)
    turnOrder.set(turnId, at < 0 ? [...list, call] : [...list.slice(0, at), call, ...list.slice(at + 1)])
  }
  // The call the model is writing now, from its `tool` chunk until it runs:
  // its row joins the run at once, spinning, its subject read from the
  // input's partial JSON (owner's request, 2026-10-05: a Write whose
  // content still streamed hung as a lone `Write` row with a tick).
  let streaming: { id: string; tool: string; json: string; subject: string } | null = null
  // each group's one Read whose picture draws (0.8.0)
  const pictureReads = new Set<string>()
  const mem = pictureMemory()
  let textSinceCall = false
  // The span above each reply: when text follows calls, the reply bubble
  // carries that span's activity line, so the span's head row draws no line
  // of its own. A reply is found by the start of its text (the render event
  // carries no turn or order); `seg` is the text being streamed now.
  const claimByKey = new Map<string, string>()
  const claimedHeads = new Set<string>()
  let seg: { head: string; text: string; key: string } | null = null
  // what each call's row (or its engine group) last drew with: a claimed
  // span's cards draw inside the reply's bubble from these, under its line,
  // never above the bubble (owner's request 2026-11-09)
  const callProps = new Map<string, CallRow>()
  // records a call's props; true when a claimed open span should redraw its
  // bubble with them (new to it, or its output changed)
  const noteProps = (props: CallRow, run: Run | null): boolean => {
    const was = callProps.get(props.tool_use_id)
    callProps.set(props.tool_use_id, props)
    return run !== null && run.isOpen && claimedHeads.has(run.head) && (was === undefined || was.output !== props.output || was.isRunning !== props.isRunning)
  }
  // a call's card: its row, then the diff (an edit) or what it printed
  const callCard = (t: Elements['terminal'], row: RenderElement, props: CallRow, cols: number): RenderElement => {
    if ((props.tool === 'Edit' || props.tool === 'Write') && !props.isRunning && !props.isErrored) {
      const diff = editCard(t, palette, props.output, props.input, cols)
      if (diff) return t.Box({ flexDirection: 'column', children: [row, diff] })
    }
    if (props.isRunning || props.output === undefined) return renderCallCard(t, palette, row, [])
    if (props.tool === 'Bash') {
      const body = bashBody(t, palette, props.output, props.isErrored, cols)
      return renderCallCard(t, palette, row, body ? [body] : [])
    }
    const lines = outputPreview(props.output)
    return renderCallCard(t, palette, row, lines ? [renderToolOutput(t, palette, lines, { columns: cols, maxLines: CARD_LINES })] : [])
  }
  let hasCwd = false
  let expandAllNow = false
  // the module records keep the turns the atoms keep: past HISTORY turns
  // the oldest turn's calls go, so a long session does not grow them forever
  // the main loop's turns and the subagents' (`agent:<id>`) each keep
  // HISTORY: a session of many agents never pushes the main turns out
  const forgetOldTurns = () => {
    const keys = [...turnOrder.keys()]
    const agents = keys.filter(isAgentTurn)
    const mains = keys.filter(k => !isAgentTurn(k))
    const old = [...mains.slice(0, Math.max(0, mains.length - HISTORY)), ...agents.slice(0, Math.max(0, agents.length - HISTORY))]
    for (const k of old) {
      const list = turnOrder.get(k) ?? []
      turnOrder.delete(k)
      if (isAgentTurn(k)) agentText.delete(k.slice('agent:'.length))
      for (const c of list) {
        callTurn.delete(c.id)
        callMs.delete(c.id)
        callProps.delete(c.id)
        grouped.delete(c.id)
        pictureReads.delete(c.id)
      }
    }
  }
  // a finished message redraws on every resize and palette change:
  // its parse is kept, the newest few by text
  const parsed = new Map<string, Block[]>()
  const parse = (text: string): Block[] => {
    const hit = parsed.get(text)
    if (hit) return hit
    const blocks = parseMarkdown(text)
    parsed.set(text, blocks)
    if (parsed.size > PARSED_MAX) parsed.delete(parsed.keys().next().value!)
    return blocks
  }

  // the live main-loop turn; a hot reload resets it, which only affects the
  // totals of the turn that reloaded
  const live = {
    turnId: '',
    // true from turn.start to the main loop's turn.complete: an agent that
    // finishes outside that window finished after its turn (0.5.0)
    active: false,
    startedAt: 0,
    tools: 0,
    edits: 0,
    failed: 0,
    lastToolId: null as string | null,
    lastFailedTool: null as string | null,
    costStart: null as number | null,
    // tools the API ran inside this turn's requests (0.5.0)
    serverTools: [] as GlassServerTool[],
  }

  on('config.set', { key: 'glass.palette' }, async ($, e, next) => {
    const result = await next(e)
    palette = paletteNamed(e.value)
    paletteName = paletteNameOf(e.value)
    // a glass theme follows the palette (0.5.0); any other theme is left alone
    try {
      const row = (await $.config.list()).find(r => r.key === 'theme')
      if (typeof row?.value === 'string' && row.value.startsWith('custom:glass-')) $.ui.toast('glass: ' + (await installTheme($, paletteName)))
    } catch {
      // the theme stays as it was
    }
    return result
  })

  on('command.run', { command: 'glass-theme' }, async $ => ({ text: await installTheme($, paletteName) }))

  on('config.set', { key: 'glass.screenshots' }, async ($, e, next) => {
    const result = await next(e)
    shotsOn = isOn(e.value)
    $.ui.invalidate('ui.render')
    return result
  })

  on('config.set', { key: 'glass.hint' }, async ($, e, next) => {
    const result = await next(e)
    hintOn = e.value !== false
    return result
  })

  // a compaction drops the hint with the rest of the history: send it again
  // with the next prompt (the main loop's own compaction, not a precompute)
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in (result ?? {}))) hintDue = true
    return result
  })

  on('config.set', { key: 'glass.notify' }, async ($, e, next) => {
    const result = await next(e)
    notifyOn = e.value !== false
    return result
  })

  on('session.start', async ($, e, next) => {
    // 0.4.2 to 0.4.5 pinned a status line; clear one a reload left behind
    $.ui.status(undefined)
    // forced on, the person vouches that pictures reach the terminal
    const forced = Boolean(await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES').catch(() => undefined))
    inTmux = !forced && Boolean(await $.env.get('TMUX').catch(() => undefined))
    home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    try {
      setCwd(await $.session.cwd())
      hasCwd = true
    } catch {
      setCwd('')
    }
    setHome((await $.env.get('HOME').catch(() => undefined)) ?? '')
    await $.command.register({ name: 'expand', description: 'glass: open every activity line' })
    await $.command.register({ name: 'collapse', description: 'glass: fold the activity lines again' })
    await $.command.register({ name: 'glass-theme', description: 'glass: write a theme for the current palette to ~/.claude/themes and select it' })
    return next(e)
  })
  on('command.run', { command: 'expand' }, async $ => {
    expandAllNow = true
    $.ui.invalidate('ui.render')
    return { text: 'Every activity line is open. /collapse folds them again.' }
  })
  on('command.run', { command: 'collapse' }, async $ => {
    expandAllNow = false
    $.ui.invalidate('ui.render')
    return { text: 'Activity lines fold again.' }
  })

  // ---- reply bubble ------------------------------------------------------
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const text = e.props.text
    if (text.trim() === '') return next(e)
    const t = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 80
    const blocks = parse(text)
    const onCopy = (what: Copyable, format: CopyFormat, press: { surface: 'terminal' | 'desktop' | 'vscode' | 'mobile' }) => void copyAs($, what, format, press)
    // the frame spends 4 cells (border and padding) of the row
    const reply = renderReply(t, blocks, palette, {
      columns: columns - 4,
      marks,
      onCopy,
      // a compaction summary (read-only flag, passed on untouched; typed from
      // 2.1.295 on, so read loosely for older type layouts)
      summary: (e.props as { isSummary?: unknown }).isSummary === true,
    })
    const whole: Copyable = { md: text, html: () => blocksHtml(blocks), text: () => blocksText(blocks) }
    // the activity of the calls before this text, under it inside the bubble
    const head = claimByKey.get(textKey(text))
    const run = head ? await findRun($, runCtx(), head) : null
    // opened, the span's cards follow the line inside the bubble
    const cards = run?.isOpen
      ? run.calls.flatMap(c => {
          const props = callProps.get(c.id)
          return props ? [callCard(t, renderCallRow(t, palette, props, { durationMs: callMs.get(c.id) ?? null }), props, columns - 4)] : []
        })
      : []
    const line = run ? [t.Box({ marginTop: 1, flexDirection: 'column', children: [await drawRun($, runCtx(), t, run, e.requestId), ...cards] })] : []
    return renderReplyBubble(t, palette, [reply], e.props.isFirstOfReply, [...line, ...copyControl({ t, p: palette, copy: onCopy }, whole, 'low')])
  })

  // ---- prompt bubble -----------------------------------------------------
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const t = $.ui.resolve(e)
    const kind = e.props.origin.kind
    // a background task's notification: one row, the body under it when the
    // view is expanded (a short one is expanded from the start)
    if (kind === 'task-notification') {
      const task = e.props.task
      const toolId = task?.toolUseId ?? (task?.id ? taskCalls.get(task.id) : undefined)
      const failed = task?.status === 'failed' || task?.status === 'killed'
      if (toolId && finishBackground(toolId, failed)) $.ui.invalidate('ui.render')
      // a task that went fine says so on its call's row, which stops
      // spinning; a row per notification repeated an agent that stopped
      // twice (owner's request, 2026-10-07: the engine shows none)
      if (!failed && !e.props.isExpanded) return t.Box({ display: 'none', children: [] })
      return renderEventRow(t, palette, e.requestId, e.props.text, task, e.props.isExpanded)
    }
    // a plugin's framed prompt: its name and its text, not `Message from
    // @plugin` (no `from` on it); one submitted asUser reads as typed
    const origin = e.props.origin
    const asUser = origin.kind === 'plugin' && origin.asUser === true
    if (origin.kind === 'plugin' && !asUser) {
      if (e.props.isExpanded) return next(e)
      return renderPluginRow(t, palette, e.requestId, origin.name, e.props.text)
    }
    // any other row (another agent's message, a scheduled trigger, a
    // bridge): one muted row; ctrl+o keeps the engine's body
    if (kind !== 'composer' && !asUser) {
      if (e.props.isExpanded) return next(e)
      const from = e.props.from?.name
      // no sender (a subagent's own opening prompt, kind `unclassified`):
      // its text, framed as a plugin's, since `Message from @unclassified`
      // hid the brief the agent was given
      if (!from) return renderPluginRow(t, palette, e.requestId, 'Prompt', e.props.text)
      if (spawned.has(from)) return t.Box({ display: 'none', children: [] })
      return renderMessageRow(t, palette, from)
    }
    const text = e.props.text
    if (text.trim() === '') return next(e)
    const columns = e.viewport?.columns ?? 80
    return renderPromptBubble(t, palette, [t.Text({ wrap: 'wrap', children: [safeText(text)] })], promptWidth(text.split('\n'), columns))
  })

  // ---- activity line and call rows ---------------------------------------
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const id = e.props.tool_use_id
    const t = $.ui.resolve(e)
    // a declined call is no failure: no red cross
    if (e.props.isErrored && isDeclined(e.props.output)) e = { ...e, props: { ...e.props, isErrored: false } }
    // a span of calls under one reply is one line: its first call's row
    // draws it, the others nothing until it opens
    const run = await findRun($, runCtx(), id, [soloCall(e.props)])
    if (noteProps(e.props, run)) $.ui.invalidate('ui.render')
    // a span a reply follows: its line and cards live in that reply's bubble
    if (run && claimedHeads.has(run.head)) return t.Box({ display: 'none', children: [] })
    if (run && !run.isOpen) return (run.head === id ? await headLine($, runCtx(), claimedHeads, t, run, e.requestId) : null) ?? t.Box({ display: 'none', children: [] })
    const wrap = async (el: RenderElement) => {
      if (!run || run.head !== id) return el
      const line = await headLine($, runCtx(), claimedHeads, t, run, e.requestId)
      return line === null ? el : t.Box({ flexDirection: 'column', children: [line, el] })
    }
    const cols = e.viewport?.columns ?? 80
    const started = liveCalls.get(id)
    const clock = e.props.isRunning && started ? clockCells((await $.clock.now()) - started.t0, palette.meta) : undefined
    // a call the model is still writing spins too, named from its partial input
    const isStreaming = streaming?.id === id
    const input = isStreaming && Object.keys((e.props.input ?? {}) as object).length === 0 ? streamedArgs(streaming!.tool, streaming!.json) : e.props.input
    const row = renderCallRow(t, palette, isStreaming ? { ...e.props, isRunning: true, input } : e.props, { durationMs: callMs.get(id) ?? null, ...(clock ? { clock } : {}) })
    // a grouped MCP call's screenshot draws under its row; a grouped Read's
    // picture too when it is the group's chosen one, or every one after
    // /expand (0.8.0)
    if (e.props.tool === 'Read') noteRead(mem, id, e.props.input)
    const pictured = e.props.tool.startsWith('mcp__') ||
      (e.props.tool === 'Read' && (expandAllNow || pictureReads.has(id)) && grouped.has(id) && pictureOf(e.props.output) !== null && (await readDraws($, mem, readPath(e.props.input))))
    if (grouped.has(id) && pictured && !e.props.isRunning && !e.props.isErrored) {
      const pic = pictureOf(e.props.output, e.props.tool === 'Read' ? readPath(e.props.input) : undefined)
      const body = pic ? await pictureBody($, t, palette, pic, e.viewport?.columns ?? 80, e.viewport?.rows ?? 40) : null
      if (body) return wrap(t.Box({ flexDirection: 'column', children: [row, body] }))
    }
    // its row, then the diff (an edit, always open) or what it printed
    return wrap(callCard(t, row, isStreaming ? { ...e.props, isRunning: true } : e.props, cols))
  })

  // the engine's folded run of reads and searches: part of the span's one
  // activity line; opening the line opens the group
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    // the group's one Read picture (0.8.0): drawn under the folded row, or
    // under its own row once the group is open
    for (const c of e.props.calls) if (c.tool === 'Read') noteRead(mem, c.tool_use_id, c.input)
    // a group with no Read picture never waits on the conversation
    const readPictures = shotsOn && !inTmux && e.props.calls.some((c: { tool: string; output?: unknown }) => c.tool === 'Read' && pictureOf(c.output) !== null)
    // the newest Read picture that draws: a JPEG with no sips gives way to
    // an older PNG rather than leave the group with none
    let chosen: string | null = null
    if (readPictures && (await loadHistory($, mem))) {
      for (const id of pictureReadOrder(e.props.calls, path => isNamed(mem, path))) {
        const c = e.props.calls.find((call: { tool_use_id?: string }) => call.tool_use_id === id)
        const pic = c ? pictureOf(c.output, readPath(c.input)) : null
        if (pic && (await shotFor($, pic))) {
          chosen = id
          break
        }
      }
    }
    // one picture per group: a Read chosen while the group was shorter gives
    // way to the one chosen now
    for (const c of e.props.calls) if (c.tool === 'Read' && typeof c.tool_use_id === 'string' && c.tool_use_id !== chosen) pictureReads.delete(c.tool_use_id)
    // a choice made after the chosen Read's own row drew (an open group's
    // rows draw as each call ends): redraw once so that row takes the picture
    const fresh = chosen !== null && !pictureReads.has(chosen)
    if (chosen) pictureReads.add(chosen)
    // the span's calls; a group outside the turn record is a span of its own
    const first = e.props.calls.find((c: { tool_use_id?: string }) => typeof c.tool_use_id === 'string')
    const run = first?.tool_use_id ? await findRun($, runCtx(), first.tool_use_id, e.props.calls.filter((c: { tool_use_id?: string }) => typeof c.tool_use_id === 'string').map(soloCall)) : null
    if (!run) return next(e)
    const t = $.ui.resolve(e)
    // a span a reply follows draws its cards in that bubble: the group's
    // calls are kept for it, and open, the group draws nothing here
    let stale = false
    for (const c of e.props.calls) if (typeof c.tool_use_id === 'string' && noteProps({ ...c, tool_use_id: c.tool_use_id }, run)) stale = true
    if (stale) $.ui.invalidate('ui.render')
    if (run.isOpen && claimedHeads.has(run.head)) return t.Box({ display: 'none', children: [] })
    if (run.isOpen) {
      remember(grouped, e.props.calls)
      if (fresh) $.ui.invalidate('ui.render')
      // opened, the engine draws each call's row: the head's draws the line
      return next({ ...e, props: { ...e.props, isExpanded: true } })
    }
    const isHead = e.props.calls.some((c: { tool_use_id?: string }) => c.tool_use_id === run.head)
    if (!isHead) return t.Box({ display: 'none', children: [] })
    const line = await headLine($, runCtx(), claimedHeads, t, run, e.requestId)
    // the group's chosen Read picture draws under the line
    const chosenRead = chosen ? e.props.calls.find((c: { tool_use_id?: string }) => c.tool_use_id === chosen) : undefined
    const pic = chosenRead ? pictureOf(chosenRead.output, readPath(chosenRead.input)) : null
    const picture = pic ? await pictureBody($, t, palette, pic, e.viewport?.columns ?? 80, e.viewport?.rows ?? 40) : null
    if (line === null) return picture ?? t.Box({ display: 'none', children: [] })
    return picture ? t.Box({ flexDirection: 'column', children: [line, picture] }) : line
  })

  // Tool results: nothing draws inline. A call's output lives in its card once
  // the span opens; a picture Claude read or a screenshot is the one exception.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    // a closed span's line says it all; a call outside the turn record folds
    // the same way: no output draws inline (a picture Claude read or a
    // screenshot is the one exception)
    const run = await findRun($, runCtx(), e.props.tool_use_id)
    const hidden = $.ui.resolve(e).Box({ display: 'none', children: [] })
    const isPic = (e.props.tool.startsWith('mcp__') || e.props.tool === 'Read') && pictureOf(e.props.output) !== null
    // an open span's card holds each call's output; only a picture draws here
    // a span a reply follows draws nothing above that reply's bubble
    if (!isPic || (run && (!run.isOpen || claimedHeads.has(run.head)))) return hidden
    // an MCP screenshot or a Read image: the picture Claude read, in place of
    // its text body (0.6.0; a Read and any format, 0.8.0)
    // the row carries no input: its Read's file is the one recorded for its id,
    // and a Read whose file is unknown keeps the engine's row
    // a Read of an image only: a text Read never waits on the conversation
    const isRead = e.props.tool === 'Read' && pictureOf(e.props.output) !== null
    // the conversation read once per draw: its file (a resumed Read's) and
    // whether the person named it
    const loaded = isRead && (await loadHistory($, mem))
    const path = loaded ? mem.readPaths.get(e.props.tool_use_id) : undefined
    const mayDraw = loaded && path !== undefined && !isNamed(mem, path)
    // a grouped call's picture is its ToolUse row's (the transcript view
    // draws both rows): this row hides where that one drew it, else keeps
    // the engine's, and never draws it twice
    if (grouped.has(e.props.tool_use_id) && (isRead || e.props.tool.startsWith('mcp__'))) {
      const owns = !e.props.isErrored && (!isRead || ((expandAllNow || pictureReads.has(e.props.tool_use_id)) && mayDraw))
      const pic = owns ? pictureOf(e.props.output, path) : null
      const drawn = pic !== null && shotsOn && !inTmux && (await shotFor($, pic)) !== null
      return drawn ? $.ui.resolve(e).Box({ display: 'none', children: [] }) : next(e)
    }
    if ((e.props.tool.startsWith('mcp__') || (isRead && mayDraw)) && !e.props.isErrored) {
      const pic = pictureOf(e.props.output, path)
      const body = pic ? await pictureBody($, $.ui.resolve(e), palette, pic, e.viewport?.columns ?? 80, e.viewport?.rows ?? 40) : null
      if (body) return body
    }
    return next(e)
  })

  // ---- the turn's bookkeeping --------------------------------------------
  on('prompt.submit', async ($, e, next) => {
    marks = !writeIntent(e.text)
    // a prompt names its pictures unless a machine wrote it: a task
    // notification or another agent's message does not; an origin the engine
    // cannot attest still counts, which only keeps a picture back
    if (!MACHINE_ORIGINS.has(e.origin?.kind ?? '')) notePrompt(mem, e.text)
    if (hintOn && hintDue && !MACHINE_ORIGINS.has(e.origin?.kind ?? '') && e.text.trim() !== '') {
      hintDue = false
      return next({ ...e, context: [...(e.context ?? []), HINT] })
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // since 2.1.299 a subagent's or teammate's turn starts here too: the tree
    // is the main loop's, and their work shows in the engine's agents line
    if (e.agentId !== undefined) return next(e)
    // a hot reload skips session.start: without the cwd every path drew
    // from the home folder (~/Documents/...), so each turn sets it again
    if (!hasCwd) {
      try {
        setCwd(await $.session.cwd())
        setHome((await $.env.get('HOME').catch(() => undefined)) ?? '')
        hasCwd = true
      } catch {
        // the paths stay long this turn; the next one tries again
      }
    }
    live.turnId = e.turnId
    live.active = true
    await update($, liveTurn, () => e.turnId)
    live.startedAt = await $.clock.now()
    live.tools = 0
    live.edits = 0
    live.failed = 0
    live.lastToolId = null
    live.lastFailedTool = null
    live.serverTools = []
    live.costStart = null
    try {
      live.costStart = (await $.session.usage()).cost?.usd ?? null
    } catch {
      live.costStart = null
    }
    const { turnId } = live
    await update($, calls, r => {
      const entries = Object.entries(r ?? {}).filter(([k]) => k !== turnId).slice(-(HISTORY - 1))
      return Object.fromEntries([...entries, [turnId, []]])
    })
    forgetOldTurns()
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const main = !e.agentId
    const id = e.tool_use_id ?? ''
    if (e.tool === 'Read') noteRead(mem, id, e)
    const turnId = live.turnId
    if (main) {
      live.tools += 1
      if (id) live.lastToolId = id
      if (id && turnId) callTurn.set(id, turnId)
      if (id && turnId) {
        // a call the stream announced keeps its place and its afterText
        const known = (turnOrder.get(turnId) ?? []).find(c => c.id === id)
        recordCall(turnId, { id, tool: e.tool, afterText: known ? known.afterText : textSinceCall, subject: callSubject(e) })
      }
      if (streaming?.id === id) streaming = null
      textSinceCall = false
      // the run's row counts this call now
      if (id && turnId) $.ui.invalidate('ui.render')
      if (id && turnId) await setCall($, turnId, { id, tool: e.tool, status: 'running', ms: null })
      if (id) liveCalls.set(id, { tool: e.tool, t0: await $.clock.now() })
      if (!ticker) ticker = $.clock.every(TICK_MS, () => void tick($, palette))
    }
    // a subagent's calls run as the main loop's do, in a turn of its own
    // (owner's request, 2026-10-28: its edits drew one row each)
    const agentTurn = main ? '' : `agent:${e.agentId}`
    if (!main && id) {
      const isNew = !turnOrder.has(agentTurn)
      callTurn.set(id, agentTurn)
      recordCall(agentTurn, { id, tool: e.tool, afterText: agentText.get(e.agentId!) ?? false, subject: callSubject(e) })
      agentText.set(e.agentId!, false)
      if (isNew) forgetOldTurns()
      $.ui.invalidate('ui.render')
    }
    if (isEditTool(e.tool)) live.edits += 1
    const t0 = await $.clock.now()
    let r
    try {
      r = await next(e)
    } finally {
      if (main && id) liveCalls.delete(id)
    }
    if (!main && id) {
      callMs.set(id, (await $.clock.now()) - t0)
      if (r.isError && !isDeclined(r.result)) failedCalls.add(id)
      $.ui.invalidate('ui.render')
    }
    if (main) {
      const ms = (await $.clock.now()) - t0
      // a call the person declined counts as no failure
      const failed = !!r.isError && !isDeclined(r.result)
      if (failed) {
        live.failed += 1
        live.lastFailedTool = e.tool
      }
      if (failed && id) failedCalls.add(id)
      const out = r.isError ? undefined : (r.result as { backgroundTaskId?: unknown; status?: unknown; agentId?: unknown; taskId?: unknown } | undefined)
      const task = typeof out?.backgroundTaskId === 'string' ? out.backgroundTaskId
        : out?.status === 'async_launched' || out?.status === 'remote_launched' ? (typeof out.agentId === 'string' ? out.agentId : typeof out.taskId === 'string' ? out.taskId : null)
        : null
      if (id && task) {
        backgroundCalls.add(id)
        taskCalls.set(task, id)
      }
      if (id) callMs.set(id, ms)
      if (id) liveCalls.delete(id)
      if (id && turnId) await setCall($, turnId, { id, tool: e.tool, status: failed ? 'failed' : 'ok', ms })
      // the run's row turns its mark
      if (id && turnId) $.ui.invalidate('ui.render')
    }
    return r
  })

  // the main loop's model requests. The event streams, so the hook is a
  // generator relaying every chunk.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let step = await stream.next()
    while (!step.done) {
      const chunk = step.value
      if (!e.agentId && live.turnId && (chunk.kind === 'tool' || chunk.kind === 'input')) {
        if (chunk.kind === 'tool') {
          streaming = { id: chunk.id, tool: chunk.name, json: '', subject: '' }
          callTurn.set(chunk.id, live.turnId)
          recordCall(live.turnId, { id: chunk.id, tool: chunk.name, afterText: textSinceCall, subject: '' })
          textSinceCall = false
          seg = null
          liveCalls.set(chunk.id, { tool: chunk.name, t0: await $.clock.now() })
          if (!ticker) ticker = $.clock.every(TICK_MS, () => void tick($, palette))
          $.ui.invalidate('ui.render')
        } else if (streaming && streaming.json.length < INPUT_HEAD) {
          streaming.json += chunk.json
          const subject = callSubject(streamedArgs(streaming.tool, streaming.json))
          if (subject !== streaming.subject) {
            streaming.subject = subject
            recordCall(live.turnId, { ...(turnOrder.get(live.turnId) ?? []).find(c => c.id === streaming!.id)!, subject })
            $.ui.invalidate('ui.render')
          }
        }
      }
      if (chunk.kind === 'text' && e.agentId) agentText.set(e.agentId, true)
      if (chunk.kind === 'text' && !e.agentId) {
        // the first text after a call closes the span above it: its line moves
        // into the reply bubble
        if (!textSinceCall) {
          const order = turnOrder.get(live.turnId ?? '') ?? []
          const last = order[order.length - 1]
          const head = last ? callRun(order, last.id)[0]?.id : undefined
          seg = head ? { head, text: '', key: '' } : null
          if (head) claimedHeads.add(head)
          $.ui.invalidate('ui.render')
        }
        textSinceCall = true
        if (seg) {
          seg.text += chunk.text
          const key = textKey(seg.text)
          if (key !== seg.key) {
            claimByKey.delete(seg.key)
            seg.key = key
          }
          claimByKey.set(key, seg.head)
          if (claimByKey.size > 400) claimByKey.delete(claimByKey.keys().next().value as string)
          if (claimedHeads.size > 800) claimedHeads.clear()
        }
      }
      yield chunk
      step = await stream.next()
    }
    // tools the API ran inside this request (the advisor): the step's result
    // lists them; the main loop's are drawn after the reply (0.5.0)
    if (!e.agentId) {
      const result = step.value as unknown as { serverToolUses?: ReadonlyArray<{ id: string; name: string; startedAt: number; endedAt?: number }> } | undefined
      for (const s of result?.serverToolUses ?? []) {
        if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.startedAt !== 'number') continue
        if (live.serverTools.some(x => x.id === s.id)) continue
        live.serverTools.push({ id: s.id, name: s.name, startedAt: s.startedAt, ...(typeof s.endedAt === 'number' ? { endedAt: s.endedAt } : {}) })
      }
    }
    return step.value
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (e.subagentType) spawned.add(e.subagentType)
    if (typeof (e as { name?: unknown }).name === 'string') spawned.add((e as { name: string }).name)
    if (r.agentId) {
      const agent: GlassAgent = {
        agentId: r.agentId,
        description: e.description,
        kind: e.subagentType,
        model: r.model,
        startedAt: await $.clock.now(),
      }
      // a resume (SendMessage) spawns again since 2.1.299, maybe with no
      // description; a finished agent left the list, so its name is kept here
      const named = agentLabels.get(agent.agentId)
      if (e.resume !== undefined && named) agent.description ||= named
      else agentLabels.set(agent.agentId, agent.description)
      if (agent.model) agentModelIds.set(agent.agentId, agent.model)
      await update($, agents, as => [...(as ?? []).filter(a => a.agentId !== agent.agentId), agent])
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const agentId = e.agentId
      const toolId = taskCalls.get(agentId)
      if (toolId && finishBackground(toolId, false)) $.ui.invalidate('ui.render')
      const done = ((await read($, agents)) ?? []).find(a => a.agentId === agentId)
      await update($, agents, as => (as ?? []).filter(a => a.agentId !== agentId))
      // an agent that finished after its turn ended: the engine says nothing,
      // so glass does (0.5.0); one that finished inside a turn is on screen.
      // The live turn is read from state, which survives a reload (0.5.1).
      const mainLive = ((await read($, liveTurn)) ?? null) !== null
      if (done && !mainLive && notifyOn) {
        const ms = (await $.clock.now()) - done.startedAt
        const label = done.description.length > 60 ? done.description.slice(0, 59) + G.ellipsis : done.description
        await notifyPerson($, ms >= 100 ? `${label} ${G.middot} ${fmtToolTime(ms)}` : label)
      }
      return next(e)
    }
    const u = e.usage
    let costUsd: number | null = null
    if (live.costStart !== null) {
      try {
        const now = (await $.session.usage()).cost?.usd
        if (typeof now === 'number') costUsd = Math.max(0, now - live.costStart)
      } catch {
        costUsd = null
      }
    }
    const finishedAt = await $.clock.now()
    const turn: GlassTurn = {
      turnId: e.turnId,
      durationMs: e.durationMs,
      tools: live.tools,
      edits: live.edits,
      failed: live.failed,
      inTokens: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0,
      cacheTokens: u ? u.cache_read_input_tokens : 0,
      outTokens: u ? u.output_tokens : 0,
      costUsd,
      lastToolId: live.lastToolId,
      answer: e.answer.slice(0, ANSWER_MAX),
      startedAt: live.startedAt || finishedAt - e.durationMs,
      finishedAt,
      ...(live.serverTools.length ? { serverTools: [...live.serverTools] } : {}),
    }
    await update($, turns, h => [...(h ?? []), turn].slice(-HISTORY))
    $.ui.invalidate('ui.render')
    live.active = false
    await update($, liveTurn, () => null)
    // a turn that ended with failed calls: the engine's idle notification
    // does not say so (0.5.0)
    if (live.failed > 0 && notifyOn) {
      await notifyPerson($, `${live.failed} ${live.failed === 1 ? 'call' : 'calls'} failed${live.lastFailedTool ? ` ${G.middot} ${toolText(live.lastFailedTool)}` : ''}`)
    }
    return next(e)
  })

  // ---- footer ------------------------------------------------------------
  // The engine's `Baked for 12s` line is dropped by request: the dots line
  // under the user row carries the counts, and the turn's cost and
  // tokens stay in state for anything that wants them later.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const t = $.ui.resolve(e)
    // the one per-turn row after the reply: it carries the tools the API ran
    // itself, when the turn had any (0.5.0). It finds its turn by duration,
    // as the footer did; this read subscribes one row per turn.
    const list = (await read($, turns)) ?? []
    let mine: GlassTurn | null = null
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.durationMs === e.props.durationMs) {
        mine = list[i]!
        break
      }
    }
    const tools = mine?.serverTools ?? []
    if (tools.length === 0) return t.Box({ display: 'none', children: [] })
    return renderServerToolRows(t, palette, tools)
  })

  // ---- the hint line under the prompt: key reminders dropped ---------------
  // the model of the agent whose transcript is open at its end; the main
  // view shows none (owner's request, 2026-10-15). PromptHint carries no
  // view, so the band above the prompt, which does, reports the switch.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const id = e.props.view.agentId
    if (id !== viewedAgent) {
      viewedAgent = id
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const model = viewedAgent ? agentModelIds.get(viewedAgent) : undefined
    const tail = model ? shortModel(model) : ''
    // only `tail`, never a rewritten `hint`: a rewrite replaces the engine's
    // line and its pills (`1 shell`) stop opening their lists
    return tail ? next({ ...e, props: { ...e.props, tail: e.props.tail ? `${e.props.tail} ${G.middot} ${tail}` : tail } }) : next(e)
  })

}

/** The records the activity line reads: register's, passed in, since `$` only goes to top-level functions. */
type RunCtx = {
  callTurn: ReadonlyMap<string, string>
  turnOrder: ReadonlyMap<string, ReadonlyArray<{ id: string; tool: string; afterText: boolean; subject: string }>>
  callMs: ReadonlyMap<string, number>
  failedCalls: ReadonlySet<string>
  backgroundCalls: ReadonlySet<string>
  palette: Palette
  isAllOpen: boolean
}

const soloHead = new Map<string, string>()
const soloCalls = new Map<string, RunCall[]>()

type Run = { head: string; turnId: string; calls: RunCall[]; isOpen: boolean }

/**
 * The span the call `id` belongs to (callRun): the calls between two replies.
 * Open when pressed or under /expand. Closed, every call folds into the
 * span's one line, a failed one too: the line's red count says it.
 */
async function findRun($: EngineInterface, c: RunCtx, id: string, solo?: RunCall[]): Promise<Run | null> {
  const turnId = c.callTurn.get(id) ?? ''
  const run = callRun(c.turnOrder.get(turnId) ?? [], id)
  let head: string
  let calls: RunCall[]
  if (run.length >= 1) {
    head = run[0]!.id
    calls = run.map(x => ({ id: x.id, tool: x.tool, subject: x.subject, status: !c.callMs.has(x.id) ? 'running' : c.failedCalls.has(x.id) ? 'failed' : c.backgroundCalls.has(x.id) ? 'background' : 'ok' }))
  } else {
    // a call outside the turn's record (a subagent's transcript): a span of its
    // own, the engine's group or the call alone, so it too folds to one line
    if (soloHead.size > 2000) {
      soloHead.clear()
      soloCalls.clear()
    }
    const known = soloHead.get(id)
    if (solo && solo.length > 0 && (known === undefined || known === solo[0]!.id)) {
      head = solo[0]!.id
      for (const x of solo) soloHead.set(x.id, head)
      soloCalls.set(head, solo)
    } else if (known !== undefined) head = known
    else return null
    calls = soloCalls.get(head) ?? []
    if (calls.length < 1) return null
  }
  const isOpen = c.isAllOpen || ((await read($, expanded)) ?? []).includes(`run:${head}`)
  return { head, turnId, calls, isOpen }
}

/** A call of a span outside the turn record, as the activity line counts it. */
function soloCall(c: { tool_use_id?: string; tool: string; input?: unknown; isRunning?: boolean; isErrored?: boolean; isInterrupted?: boolean }): RunCall {
  return {
    id: c.tool_use_id ?? '',
    tool: c.tool,
    subject: callSubject((c.input ?? {}) as object),
    status: c.isRunning ? 'running' : c.isErrored || c.isInterrupted ? 'failed' : 'ok',
  }
}

/** A span's one line, drawn by its head's row (`requestId`, for the spinner). */
async function drawRun($: EngineInterface, c: RunCtx, t: Elements['terminal'], run: Run, requestId: string): Promise<RenderElement> {
  const running = run.calls.some(x => x.status === 'running')
  if (running) spinRows.add(requestId)
  else spinRows.delete(requestId)
  const key = `run:${run.head}`
  return renderActivityRow(t, c.palette, run.calls, {
    key,
    isOpen: run.isOpen,
    durationMs: running ? null : run.calls.reduce((n, x) => n + (c.callMs.get(x.id) ?? 0), 0),
    ...(running ? { spin: spinCells(await $.clock.now().catch(() => 0), c.palette.meta) } : {}),
    onToggle: () => void update($, expanded, xs => ((xs ?? []).includes(key) ? (xs ?? []).filter(x => x !== key) : [...(xs ?? []), key].slice(-HISTORY))),
  })
}

/**
 * What a span's head row draws. A span a reply follows draws nothing (its
 * line sits in that reply's bubble); one with no reply yet draws its line in
 * a Claude bubble, as agent-hud's band shows live work; a span outside the
 * turn record (a subagent's view) draws the bare line.
 */
async function headLine($: EngineInterface, c: RunCtx, claimed: Set<string>, t: Elements['terminal'], run: Run, requestId: string): Promise<RenderElement | null> {
  if (claimed.has(run.head)) return null
  const line = await drawRun($, c, t, run, requestId)
  if (run.turnId === '') return line
  const order = c.turnOrder.get(run.turnId) ?? []
  return renderReplyBubble(t, c.palette, [line], order[0]?.id === run.head && !order[0].afterText)
}

/**
 * The string arguments a call's input has streamed so far, read from its
 * partial JSON (agent-hud's partialArgsOf): enough to name the file or the
 * command before the input is whole. A value still streaming stays out.
 */
function partialArgs(json: string): Record<string, string> {
  const args: Record<string, string> = {}
  for (const m of json.matchAll(/"([a-z_]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try {
      args[m[1]!] ??= JSON.parse(`"${m[2]!}"`) as string
    } catch {
      // a half escape: the next chunk completes it
    }
  }
  return args
}

/**
 * A streaming call's arguments as its row may show them. A Bash command
 * streams before its description: the raw command stays hidden until the
 * description names it (owner's request, 2026-10-05).
 */
function streamedArgs(tool: string, json: string): Record<string, string> {
  const args = partialArgs(json)
  if (tool !== 'Bash') return args
  return typeof args.description === 'string' ? { description: args.description } : {}
}

/** What a call did, for its run's row: its description, else its path, pattern or command. */
function callSubject(args: object): string {
  const a = args as Record<string, unknown>
  const s = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() !== '' ? (a[k] as string) : null)
  const path = s('file_path') ?? s('path') ?? s('notebook_path')
  return s('description') ?? (path ? shortPath(path) : null) ?? s('pattern') ?? s('query') ?? s('url') ?? s('skill') ?? s('command') ?? ''
}

/** Keeps the tool_use_ids of an unfolded group's calls. */
function remember(ids: Set<string>, calls: ReadonlyArray<{ tool_use_id?: string }>): void {
  for (const c of calls) if (typeof c.tool_use_id === 'string') ids.add(c.tool_use_id)
}

/**
 * An Edit's or a Write's result as glass's diff card, null when there is
 * nothing to draw. A Write that created the file has no patch: its whole
 * content draws as added lines under `Created`.
 */
function editCard(t: Elements['terminal'], palette: Palette, output: unknown, input: unknown, columns: number): RenderElement | null {
  const out = output as { structuredPatch?: unknown; filePath?: unknown; type?: unknown; content?: unknown } | undefined
  const patch = out?.structuredPatch
  const patched = Array.isArray(patch) ? (patch as Hunk[]).filter(h => h && typeof h.oldStart === 'number' && typeof h.newStart === 'number' && Array.isArray(h.lines)) : []
  const created = patched.length === 0 && out?.type === 'create' && typeof out.content === 'string'
  const hunks = created ? [{ oldStart: 0, newStart: 1, lines: (out.content as string).replace(/\n$/, '').split('\n').map(l => `+${l}`) }] : patched
  if (hunks.length === 0) return null
  const args = input as { file_path?: unknown } | undefined
  const path = typeof out?.filePath === 'string' ? out.filePath : typeof args?.file_path === 'string' ? args.file_path : ''
  return renderDiff(t, palette, hunks, { path, columns, ...(created ? { verb: 'Created' } : {}) })
}

/** A subagent's turn key (`agent:<agentId>`), not a main-loop turn's id. */
function isAgentTurn(key: string): boolean {
  return key.startsWith('agent:')
}

// ---- copy ------------------------------------------------------------------

/** Where a rich (HTML) copy can go: null where no helper reaches the clipboard (SSH). */
async function htmlBackend($: EngineInterface): Promise<{ backend: ClipboardBackend; systemRoot?: string; wayland: boolean } | null> {
  const get = (v: string | undefined) => v || undefined
  const ssh = get(await $.env.get('SSH_CONNECTION').catch(() => undefined)) ?? get(await $.env.get('SSH_TTY').catch(() => undefined))
  if (ssh) return null
  if (get(await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') {
    const systemRoot = get(await $.env.get('SystemRoot').catch(() => undefined))
    return { backend: 'windows', wayland: false, ...(systemRoot ? { systemRoot } : {}) }
  }
  if (await $.fs.stat('/usr/bin/osascript').then(() => true, () => false)) return { backend: 'macos', wayland: false }
  const wayland = Boolean(get(await $.env.get('WAYLAND_DISPLAY').catch(() => undefined)))
  if (wayland || get(await $.env.get('DISPLAY').catch(() => undefined))) return { backend: 'linux', wayland }
  return null
}

const COPY_MS = 4000

/**
 * Copies a reply or a fence as markdown, HTML or plain text. Markdown and
 * text go through the engine's copy; HTML tries each platform helper in
 * order (clipboard.ts) and falls back to plain text, which the toast says.
 */
async function copyAs($: EngineInterface, what: Copyable, format: CopyFormat, press: { surface: 'terminal' | 'desktop' | 'vscode' | 'mobile' }): Promise<void> {
  const plain = (text: string) => $.ui.copy({ text, surface: press.surface })
  try {
    if (format === 'md') {
      await plain(what.md)
      $.ui.toast('Copied as Markdown')
      return
    }
    if (format === 'text') {
      await plain(what.text())
      $.ui.toast('Copied as plain text')
      return
    }
    const target = await htmlBackend($)
    if (target) {
      const html = what.html()
      const text = what.text()
      for (const c of clipboardCommands(target.backend, html, text, { wayland: target.wayland, ...(target.systemRoot ? { systemRoot: target.systemRoot } : {}) })) {
        const r = await $.process.run(c.argv, { stdin: c.stdin, timeoutMs: COPY_MS }).catch(() => null)
        if (r && r.exitCode === 0) {
          $.ui.toast('Copied as HTML')
          return
        }
      }
    }
    await plain(what.text())
    $.ui.toast('Copied as plain text (no HTML clipboard here)')
  } catch {
    $.ui.toast('Copy failed')
  }
}
