import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, RenderElement, Register } from 'claude-code'

import type { GlassAgent, GlassCall, GlassPrompt, GlassTurn } from '../types'
import { FLAT_TOOLS, toolText, callRun, editRunKeys, renderRunRow, spinCells, cleanHint, renderHint, clockCells, fmtDuration, isEditTool, setCwd, setHome, lineCounts, rel, shortPath, spaced, trunked, renderAgentLaunch, renderBand, renderBashResult, renderDiff, renderEventRow, renderGroupRow, renderMessageRow, renderNoOutput, renderToolError, renderToolOutput, renderTreeRow, renderUserRow } from './chrome'
import type { ChangedFile, Hunk, RunCall, TreeOptions, TreeRow } from './chrome'
import { G } from './glyphs'
import { parseMarkdown } from './markdown'
import type { Block } from './markdown'
import { paletteNamed } from './palette'
import type { Palette } from './palette'
import { writeIntent } from './prose'
import { renderReply } from './render'

// The turns this session, newest last. A user row finds its own turn in
// here: a `read` while a render hook runs subscribes that row, so every
// `update` draws every user row again, and each must still find its data.
const turns = atom({ plugin: 'glass', key: 'turns' } as const, [] as GlassTurn[])
// the prompts the person submitted, newest last: a user row finds its turn
// by text, and the assistant header appears once the turn starts
const prompts = atom({ plugin: 'glass', key: 'prompts' } as const, [] as GlassPrompt[])
// every main-loop call by turn: the dots line, the tree's times, and which
// rows a folded turn hides
const calls = atom({ plugin: 'glass', key: 'calls' } as const, {} as Record<string, GlassCall[]>)
// the engine's folded groups the person opened with the fold row's button
const expanded = atom({ plugin: 'glass', key: 'expanded' } as const, [] as string[])
// subagents still running, for the band above the prompt
const agents = atom({ plugin: 'glass', key: 'agents' } as const, [] as GlassAgent[])
const band = atom({ plugin: 'glass', key: 'band' } as const, 'open' as 'open' | 'closed')

const HISTORY = 48
// chars of a streaming call's input read for its subject: the path and the
// description come first, a Write's content after them
const INPUT_HEAD = 2000
// finished replies whose parse is kept for their redraws
const PARSED_MAX = 64

const ANSWER_MAX = 20000

const ESC = String.fromCodePoint(0x1b)
// the engine shows this many output lines before folding the rest behind ctrl+o
const MAX_PAINTED_LINES = 3
// pipes the reply's trunk holds before its box cuts them to the reply's
// height: a reply taller than this loses the trunk below it
const TRUNK_ROWS = 2000

// Live things, ticked once a second: main-loop calls still running (their
// row's clock is a Raster the ticker blits, no redraw) and subagents still
// running (the status line under the prompt). Module state, read by no
// render hook, so a tick redraws nothing in the transcript (2026-10-04).
const liveCalls = new Map<string, { tool: string; t0: number }>()
// rows drawing a running run (renderRunRow), by request id: the ticker
// blits their spinner's next frame
const spinRows = new Set<string>()
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
  const opts = (options ?? {}) as { palette?: unknown }
  // the palette follows /config live: every hook reads this binding at
  // draw time, and the config.set hook below swaps it (rows already drawn
  // keep their colors until something redraws them)
  let palette = paletteNamed(opts.palette)
  // gutter marks are off for a turn whose prompt asked for writing: the
  // reply is then the thing itself and asks nothing of the reader
  let marks = true
  // the slash commands this session has, for the band's `/tasks` hint
  let commands = new Set<string>()
  // the names and types of subagents this session spawned: their folded
  // `Message from` rows hide, since the finished row says the same
  const spawned = new Set<string>()
  // Tree rows read these module records, never an atom: a read in a render
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
  // What closes each finished turn's tree with the rounded corner (owner's
  // request, 2026-10-05): its reply, by the reply's text, or its last call
  // when no text came after it. Filled at turn.complete, which then asks
  // every row to draw again; rows read these records, never an atom.
  const closedAnswers = new Set<string>()
  const closedTools = new Set<string>()
  // each turn's done edits in call order: a file's edits, and edits called
  // back to back, draw as one row
  const turnEdits = new Map<string, EditDone[]>()
  /**
   * The edits that draw as one row with the edit `key` (`editRunKeys`), null
   * when it stands alone. The row can draw before `tool.call` records the
   * edit: then `output` names the file, and the edit counts last.
   */
  const editRun: RunOf = (key, id, output) => {
    const turnId = callTurn.get(id) ?? ''
    const all = [...(turnEdits.get(turnId) ?? [])]
    const file = all.find(x => x.key === key)?.file ?? (output as { filePath?: unknown } | undefined)?.filePath
    if (typeof file !== 'string') return null
    if (!all.some(x => x.key === key)) all.push({ id, key, file, output, input: { file_path: file } })
    const keys = new Set(editRunKeys(all, turnOrder.get(turnId) ?? [], key))
    const run = all.filter(x => keys.has(x.key))
    return run.length > 1 ? run : null
  }
  // what the run helpers read, at the moment they run
  // The live turn's newest node closes the tree too, while the turn runs
  // (owner's request, 2026-10-05): its last run of calls when no text came
  // after it, else its newest reply. The node before it turns back to a tee
  // when the next one comes (each new node asks every row to draw again).
  let liveText = ''
  // what closed the last turn's tree, and the notifications' texts: a turn
  // that starts from one, or from no text, reopens it (prompt.submit fires
  // for a notification too, so it cannot tell them apart)
  const notices = new Set<string>()
  let lastClose: { answer?: string; tool?: string } | null = null
  const isLastCall = (id: string) => {
    if (closedTools.has(id)) return true
    const order = live.turnId && !textSinceCall && callTurn.get(id) === live.turnId ? turnOrder.get(live.turnId) ?? [] : []
    const newest = order[order.length - 1]
    return !!newest && callRun(order, newest.id).some(c => c.id === id)
  }
  const isLastReply = (text: string) =>
    [...closedAnswers].some(a => a.endsWith(text)) || (textSinceCall && text !== '' && liveText.trim().endsWith(text))
  const runCtx = (): RunCtx => ({ callTurn, turnOrder, callMs, failedCalls, backgroundCalls, isLastCall, turnEdits, palette, isAllOpen: expandAllNow })
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
  // the live turn's header, until its first text or call reveals it
  let header: Header | null = null
  let textSinceCall = false
  let hasCwd = false
  let foldedTurns = new Set<string>()
  let expandAllNow = false
  // the module records keep the turns the atoms keep: past HISTORY turns
  // the oldest turn's calls go, so a long session does not grow them forever
  const forgetOldTurns = () => {
    for (const [old, list] of turnOrder) {
      if (turnOrder.size <= HISTORY) break
      turnOrder.delete(old)
      foldedTurns.delete(old)
      for (const c of list) {
        callTurn.delete(c.id)
        callMs.delete(c.id)
        grouped.delete(c.id)
      }
    }
  }
  // a finished message redraws on every /fold, resize and palette change:
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
  const live = { turnId: '', startedAt: 0, tools: 0, edits: 0, failed: 0, lastToolId: null as string | null, costStart: null as number | null }

  on('config.set', { key: 'glass.palette' }, async ($, e, next) => {
    const result = await next(e)
    palette = paletteNamed(e.value)
    return result
  })

  on('session.start', async ($, e, next) => {
    // 0.4.2 to 0.4.5 pinned a status line; clear one a reload left behind
    $.ui.status(undefined)
    try {
      setCwd(await $.session.cwd())
      hasCwd = true
    } catch {
      setCwd('')
    }
    setHome((await $.env.get('HOME').catch(() => undefined)) ?? '')
    try {
      commands = new Set((await $.command.list()).map(c => c.name))
    } catch {
      commands = new Set()
    }
    await $.command.register({ name: 'fold', description: 'glass: fold the tool trees of every finished turn' })
    await $.command.register({ name: 'unfold', description: 'glass: open the tool trees of every turn' })
    await $.command.register({ name: 'expand', description: 'glass: open every folded run of reads and searches' })
    await $.command.register({ name: 'collapse', description: 'glass: fold the runs of reads and searches again' })
    return next(e)
  })
  on('command.run', { command: 'expand' }, async $ => {
    expandAllNow = true
    $.ui.invalidate('ui.render')
    return { text: 'Every folded run is open. /collapse folds them again.' }
  })
  on('command.run', { command: 'collapse' }, async $ => {
    expandAllNow = false
    $.ui.invalidate('ui.render')
    return { text: 'Runs of reads and searches fold again.' }
  })

  // ---- folding on demand -------------------------------------------------
  on('command.run', { command: 'fold' }, async $ => {
    const ids = ((await read($, turns)) ?? []).map(h => h.turnId)
    foldedTurns = new Set(ids.slice(-HISTORY))
    $.ui.invalidate('ui.render')
    return { text: ids.length ? `Folded ${ids.length} turn${ids.length === 1 ? '' : 's'}. /unfold opens them again.` : 'Nothing to fold yet.' }
  })
  on('command.run', { command: 'unfold' }, async $ => {
    foldedTurns = new Set()
    $.ui.invalidate('ui.render')
    return { text: 'Every turn is open.' }
  })

  // ---- reply renderer ----------------------------------------------------
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const text = e.props.text
    if (text.trim() === '') return next(e)
    const t = $.ui.resolve(e)
    // A reply is a node of the tool tree (owner's request, 2026-10-05): its
    // first row opens with `|- * `, the rest hang on the trunk under it, so
    // the turn reads as one tree. No gutter marks: the trunk takes the cells
    // they drew in. 5 cells: the inset 2, then `|- ` 3; the node's `* ` sits
    // in the 2 cells every block leaves blank. The trunk and the node are
    // Boxes laid over the reply's left edge: the trunk's pipes cut to the
    // reply's height, which is the layout's to know. The reply drops its
    // blank first row (`first: false`): the node sits on its first text row.
    const columns = e.viewport?.columns ?? 80
    const first = e.props.isFirstOfReply
    const reply = renderReply(t, parse(text), palette, {
      first: false,
      columns: columns - 5,
      marks: false,
    })
    // The turn's last reply closes the tree: its node's corner when the
    // reply is one block, else a row of its own under the text
    const closes = isLastReply(text.trim())
    return t.Box({
      marginLeft: 2,
      paddingLeft: 3,
      ...(closes && !first ? { paddingBottom: 1 } : {}),
      position: 'relative',
      children: [
        reply,
        ...(closes && first
          ? []
          : [t.Box({ position: 'absolute', top: first ? 1 : 0, bottom: 0, left: 0, width: 1, overflow: 'hidden', children: [t.Text({ color: palette.faint, children: [Array(TRUNK_ROWS).fill(G.pipe).join('\n')] })] })]),
        ...(first
          ? [t.Box({
              position: 'absolute',
              top: 0,
              left: 0,
              width: 5,
              height: 1,
              children: [t.Text({ wrap: 'truncate-end', children: [t.Text({ color: palette.faint, children: [(closes ? G.arcBL : G.tee) + G.rule + ' '] }), t.Text({ color: palette.accent, children: [G.disc] })] })],
            })]
          : []),
        ...(closes && !first
          ? [t.Box({ position: 'absolute', bottom: 0, left: 0, children: [t.Text({ color: palette.faint, children: [G.arcBL + G.rule] })] })]
          : []),
      ],
    })
  })

  // ---- user row, assistant header, dots line -----------------------------
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const t = $.ui.resolve(e)
    const kind = e.props.origin.kind
    // a background task's notification: one tree row, the body under it
    // when the view is expanded (a short one is expanded from the start)
    if (kind === 'task-notification') {
      notices.add(e.props.text)
      if (notices.size > HISTORY) notices.delete(notices.values().next().value!)
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
    // any other row (another agent's message, a scheduled trigger, a
    // bridge): one muted row; ctrl+o keeps the engine's body
    if (kind !== 'composer') {
      if (e.props.isExpanded) return next(e)
      if (spawned.has(e.props.from?.name ?? '')) return t.Box({ display: 'none', children: [] })
      return renderMessageRow(t, palette, e.props.from?.name ?? kind)
    }
    const text = e.props.text
    if (text.trim() === '') return next(e)
    const known = [...((await read($, prompts)) ?? [])].reverse().find(p => p.text === text) ?? null
    // no dots line under the header: the turn's dots and counts live in
    // agent-hud's box above the prompt (owner's request, 2026-10-05), and
    // the row no longer reads `calls`, so a call's end redraws it no more
    return renderUserRow(t, palette, {
      text,
      submittedAt: known?.submittedAt ?? null,
      startedAt: known?.startedAt ?? null,
      turn: null,
      columns: e.viewport?.columns ?? 80,
    })
  })

  // ---- tool tree ---------------------------------------------------------
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const id = e.props.tool_use_id
    const turnId = callTurn.get(id)
    // a folded turn hides its rows; a row of a turn glass never saw stays
    if (turnId && foldedTurns.has(turnId)) return $.ui.resolve(e).Box({ display: 'none', children: [] })
    const t = $.ui.resolve(e)
    // a run of calls is one row (owner's request, 2026-10-05): its first
    // call's row draws it, the others nothing until it opens
    const run = await findRun($, runCtx(), id)
    if (run && !run.isOpen && !run.failed.has(id)) return run.head === id ? drawRun($, runCtx(), t, run, e.requestId) : t.Box({ display: 'none', children: [] })
    const wrap = (el: RenderElement) => underRunRow($, runCtx(), t, run, run?.head === id, e.requestId, el)
    // no elbow: knowing the last call needs a subscription to the turn
    const started = liveCalls.get(id)
    const clock = e.props.isRunning && started ? clockCells((await $.clock.now()) - started.t0, palette.meta) : undefined
    // a call the model is still writing spins too, named from its partial input
    const isStreaming = streaming?.id === id
    const input = isStreaming && Object.keys((e.props.input ?? {}) as object).length === 0 ? streamedArgs(streaming!.tool, streaming!.json) : e.props.input
    const row = renderTreeRow(t, palette, isStreaming ? { ...e.props, isRunning: true, input } : e.props, { last: isLastCall(id), durationMs: callMs.get(id) ?? null, ...(clock ? { clock } : {}) })
    if ((e.props.tool === 'Edit' || e.props.tool === 'Write') && !e.props.isRunning && !e.props.isErrored) {
      // a done edit is one folded tree row its ToolResult draws (in a group,
      // the folded group's), not this row plus a second line under it
      // (2026-10-05); while it runs, and when it failed, this row stays
      if (editCard(t, palette, e.props.output, e.props.input, e.viewport?.columns ?? 80)) return wrap(t.Box({ display: 'none', children: [] }))
    }
    if (e.props.tool !== 'Bash' || e.props.isRunning || e.props.output === undefined) return wrap(row)
    const columns = e.viewport?.columns ?? 80
    const result = e.props.isErrored ? null : bashResult(e.props.output)
    if (result && result.files.length > 0) {
      const opts = { last: isLastCall(id), durationMs: callMs.get(id) ?? null }
      return wrap(await bashEdits($, t, palette, expandAllNow, e.props, result, columns, opts, editRun))
    }
    const body = bashBody(t, palette, e.props.output, e.props.isErrored, columns)
    return wrap(body ? t.Box({ flexDirection: 'column', children: [row, body] }) : row)
  })

  // the engine's folded run of reads and searches: one tree row; /expand
  // opens every group where it is
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    // a run of reads and searches alone has nothing to open: its row lists
    // every path, so a press that unfolds it draws the same rows again
    // (owner's request, 2026-10-05); it stays folded unless a call failed
    const flatOnly = e.props.calls.every((c: { tool: string; isErrored?: boolean; isInterrupted?: boolean }) => FLAT_TOOLS.has(c.tool) && !c.isErrored && !c.isInterrupted)
    if (e.props.isExpanded && !flatOnly) {
      remember(grouped, e.props.calls)
      // opened, the group lists its commands alone: its edits show folded
      return next(e)
    }
    const first = e.props.calls.find((c: { tool_use_id?: string }) => typeof c.tool_use_id === 'string')
    const turnId = first?.tool_use_id ? callTurn.get(first.tool_use_id) ?? null : null
    if (turnId && foldedTurns.has(turnId)) return $.ui.resolve(e).Box({ display: 'none', children: [] })
    const run = first?.tool_use_id ? await findRun($, runCtx(), first.tool_use_id) : null
    const isHead = !!run && e.props.calls.some((c: { tool_use_id?: string }) => c.tool_use_id === run.head)
    // a group holding a failed call opens (below), and its calls' rows say
    // which draw while the run is closed
    const holdsFailed = !!run && e.props.calls.some((c: { tool_use_id?: string }) => run.failed.has(c.tool_use_id ?? ''))
    if (run && !run.isOpen && !holdsFailed) return isHead ? drawRun($, runCtx(), $.ui.resolve(e), run, e.requestId) : $.ui.resolve(e).Box({ display: 'none', children: [] })
    const wrap = async (el: RenderElement | Promise<RenderElement>) => underRunRow($, runCtx(), $.ui.resolve(e), run, isHead, e.requestId, await el)
    const id = e.requestId
    // open after /expand, or on its own when a call in it failed: a red
    // mark must never hide behind a count
    const failed = e.props.calls.some((c: { isErrored?: boolean; isInterrupted?: boolean }) => c.isErrored || c.isInterrupted)
    const all = expandAllNow
    if ((all && !flatOnly) || failed || ((await read($, expanded)) ?? []).includes(id)) {
      remember(grouped, e.props.calls)
      // opened, the engine draws each call's row: the head's draws the run
      return next({ ...e, props: { ...e.props, isExpanded: true } })
    }
    const t = $.ui.resolve(e)
    // an edit is its own tree row with its own fold, never inside the run's
    // count: the group's click opens the rest, the edit's opens its diff
    const rest = e.props.calls.filter(c => !isFoldableEdit(c))
    const rows: RenderElement[] = []
    if (rest.length > 0) {
      rows.push(renderGroupRow(t, palette, rest, {
        isActive: e.props.isActive,
        // its edits draw under it: they close the tree when there are any
        last: rest.length === e.props.calls.length && e.props.calls.some((c: { tool_use_id?: string }) => !!c.tool_use_id && isLastCall(c.tool_use_id)),
        key: `expand:${id}`,
        onExpand: () => {
          void update($, expanded, xs => [...(xs ?? []).filter(x => x !== id), id].slice(-HISTORY))
        },
      }))
    }
    rows.push(...(await editRows($, t, palette, expandAllNow, e.props.calls, e.viewport?.columns ?? 80, editRun)))
    if (rows.length === 0) return wrap(next(e))
    return wrap(rows.length === 1 ? rows[0]! : t.Box({ flexDirection: 'column', children: rows }))
  })

  // Bash output body, painted the way claude-hl painted it. The engine
  // strips escape codes from a rewritten result, so the body is drawn as
  // Text, and only when it is short enough that the engine would show it
  // whole: longer output keeps the engine's collapsed body and ctrl+o.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const turnId = callTurn.get(e.props.tool_use_id)
    if (turnId && foldedTurns.has(turnId)) return $.ui.resolve(e).Box({ display: 'none', children: [] })
    // a closed run's row says it all
    const run = await findRun($, runCtx(), e.props.tool_use_id)
    if (run && !run.isOpen && !run.failed.has(e.props.tool_use_id)) return $.ui.resolve(e).Box({ display: 'none', children: [] })
    // a Read's result draws nothing: its row's path says it all, and a
    // press that unfolded the engine's result opened an empty row
    // (owner's request, 2026-10-05); a failed Read keeps its error
    if (e.props.tool === 'Read' && !e.props.isErrored) return $.ui.resolve(e).Box({ display: 'none', children: [] })
    // a failed call's reason on the trunk; a failed Bash's body is the ToolUse row's
    if (e.props.isErrored && e.props.tool !== 'Bash' && typeof e.props.output === 'string') {
      const reason = e.props.output.replace(/<\/?tool_use_error>/g, '')
      if (reason.trim() !== '') return renderToolError($.ui.resolve(e), palette, reason)
    }
    // an Edit's or a Write's diff, drawn as glass draws it (owner's request, 2026-10-03)
    if ((e.props.tool === 'Edit' || e.props.tool === 'Write') && !e.props.isErrored) {
      const input = (e.props as { input?: unknown }).input
      const run = editRun(e.props.tool_use_id, e.props.tool_use_id, e.props.output)
      // the row closes the tree when the turn's last call is this edit or
      // one it counts
      const isLast = (run ?? [{ id: e.props.tool_use_id }]).some(x => isLastCall(x.id))
      return (await foldedCard($, $.ui.resolve(e), palette, expandAllNow, e.props.tool_use_id, e.props.output, input, e.viewport?.columns ?? 80, !grouped.has(e.props.tool_use_id), run, isLast)) ?? next(e)
    }
    // a backgrounded agent: one trunked line in place of the engine's body
    if (e.props.tool === 'Agent' || e.props.tool === 'Task') {
      const status = (e.props.output as { status?: unknown } | undefined)?.status
      if (status === 'async_launched' || status === 'remote_launched') return renderAgentLaunch($.ui.resolve(e), palette, status === 'remote_launched')
      return next(e)
    }
    if (e.props.tool !== 'Bash') return next(e)
    // a backgrounded command: the same trunked line, not the engine's corner
    // bracket, which sat off the trunk (2026-10-05)
    if (typeof (e.props.output as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId === 'string' && !e.props.isErrored) return renderAgentLaunch($.ui.resolve(e), palette, false)
    // the ToolUse row draws the body glass owns; this row draws nothing then
    const body = bashBody($.ui.resolve(e), palette, e.props.output, e.props.isErrored, e.viewport?.columns ?? 80)
    return body ? $.ui.resolve(e).Box({ display: 'none', children: [] }) : next(e)
  })

  // ---- the turn's bookkeeping --------------------------------------------
  on('prompt.submit', async ($, e, next) => {
    marks = !writeIntent(e.text)
    const now = await $.clock.now()
    await update($, prompts, ps => [...(ps ?? []), { text: e.text, submittedAt: now, startedAt: null, turnId: null }].slice(-HISTORY))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A turn no prompt started (a background task's or an agent's
    // notification) goes on the tree above it: that turn's corner turns back
    // to a tee (owner's request, 2026-10-05: the trunk broke under it).
    const continues = e.text.trim() === '' || /<task-notification>/.test(e.text) || notices.has(e.text)
    if (continues && lastClose) {
      if (lastClose.answer !== undefined) closedAnswers.delete(lastClose.answer)
      if (lastClose.tool !== undefined) closedTools.delete(lastClose.tool)
      $.ui.invalidate('ui.render')
    }
    lastClose = null
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
    live.startedAt = await $.clock.now()
    live.tools = 0
    live.edits = 0
    live.failed = 0
    live.lastToolId = null
    live.costStart = null
    try {
      live.costStart = (await $.session.usage()).cost?.usd ?? null
    } catch {
      live.costStart = null
    }
    const { turnId, startedAt } = live
    // the assistant header waits for the turn's first text or call (owner's
    // request, 2026-10-05: a bare `Claude . 4:23 PM` hung under the prompt)
    header = { text: e.text, startedAt, turnId }
    await update($, calls, r => {
      const entries = Object.entries(r ?? {}).filter(([k]) => k !== turnId).slice(-(HISTORY - 1))
      return Object.fromEntries([...entries, [turnId, []]])
    })
    // a new turn always shows its tree
    foldedTurns.delete(turnId)
    forgetOldTurns()
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const main = !e.agentId
    const id = e.tool_use_id ?? ''
    const turnId = live.turnId
    if (main && header) {
      await revealHeader($, header)
      header = null
    }
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
      if (id && turnId && callRun(turnOrder.get(turnId)!, id).length > 1) $.ui.invalidate('ui.render')
      if (id && turnId) await setCall($, turnId, { id, tool: e.tool, status: 'running', ms: null })
      if (id) liveCalls.set(id, { tool: e.tool, t0: await $.clock.now() })
      if (!ticker) ticker = $.clock.every(TICK_MS, () => void tick($, palette))
    } else if (e.agentId) {
      const agentId = e.agentId
      const stage = toolText(e.tool)
      const args = e as unknown as Record<string, unknown>
      const file = typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : null
      void update($, agents, as => (as ?? []).map(a => (a.agentId === agentId ? { ...a, stage, file: file ?? a.file } : a)))
    }
    if (isEditTool(e.tool)) live.edits += 1
    const t0 = await $.clock.now()
    let r
    try {
      r = await next(e)
    } finally {
      if (main && id) liveCalls.delete(id)
    }
    if (main) {
      const ms = (await $.clock.now()) - t0
      if (r.isError) live.failed += 1
      if (r.isError && id) failedCalls.add(id)
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
      if (id && turnId) await setCall($, turnId, { id, tool: e.tool, status: r.isError ? 'failed' : 'ok', ms })
      // the run's row turns its mark
      if (id && turnId && callRun(turnOrder.get(turnId) ?? [], id).length > 1) $.ui.invalidate('ui.render')
      const args = e as unknown as Record<string, unknown>
      // the edits this call made: an Edit's or a Write's file, or each file
      // a Bash command rewrote (sed, a script), keyed by call and file
      const made: EditDone[] = []
      if (id && !r.isError && (e.tool === 'Edit' || e.tool === 'Write') && typeof args.file_path === 'string') {
        made.push({ id, key: id, file: args.file_path, output: r.result, input: { file_path: args.file_path } })
      } else if (id && !r.isError && e.tool === 'Bash') {
        for (const f of bashResult(r.result)?.files ?? []) {
          if (f.hunks.length > 0) made.push(bashEditDone(id, f))
        }
      }
      if (turnId && made.length > 0) {
        const before = turnEdits.get(turnId) ?? []
        turnEdits.set(turnId, [...before, ...made])
        if (turnEdits.size > HISTORY) turnEdits.delete(turnEdits.keys().next().value!)
        // the run's first row counts this edit now: rows read module
        // records, not an atom, so they redraw only when asked
        if (before.length > 0) $.ui.invalidate('ui.render')
      }
    }
    return r
  })

  // a subagent's model requests: its tokens and effort for the band. The
  // event streams, so the hook is a generator relaying every chunk; the
  // stop chunk carries the usage.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null = null
    let step = await stream.next()
    while (!step.done) {
      const chunk = step.value
      if (chunk.kind === 'stop') usage = chunk.usage
      if (!e.agentId && live.turnId && (chunk.kind === 'tool' || chunk.kind === 'input')) {
        if (header) {
          await revealHeader($, header)
          header = null
        }
        if (chunk.kind === 'tool') {
          streaming = { id: chunk.id, tool: chunk.name, json: '', subject: '' }
          callTurn.set(chunk.id, live.turnId)
          recordCall(live.turnId, { id: chunk.id, tool: chunk.name, afterText: textSinceCall, subject: '' })
          textSinceCall = false
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
      if (chunk.kind === 'text' && !e.agentId) {
        // the first text after a call: the run above turns back to a tee
        if (!textSinceCall) $.ui.invalidate('ui.render')
        liveText = textSinceCall ? liveText + chunk.text : chunk.text
        textSinceCall = true
        if (header) {
          await revealHeader($, header)
          header = null
        }
      }
      yield chunk
      step = await stream.next()
    }
    if (e.agentId) {
      const agentId = e.agentId
      const effort = e.effort === undefined ? '' : String(e.effort)
      const u = usage
      const used = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens : 0
      void update($, agents, as => (as ?? []).map(a => (a.agentId === agentId ? { ...a, effort: effort || a.effort, tokens: a.tokens + used } : a)))
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
        effort: '',
        stage: 'thinking' + G.ellipsis,
        file: '',
        tokens: 0,
        startedAt: await $.clock.now(),
      }
      await update($, agents, as => [...(as ?? []).filter(a => a.agentId !== agent.agentId), agent])
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const agentId = e.agentId
      const toolId = taskCalls.get(agentId)
      if (toolId && finishBackground(toolId, false)) $.ui.invalidate('ui.render')
      await update($, agents, as => (as ?? []).filter(a => a.agentId !== agentId))
      return next(e)
    }
    if (header) {
      await revealHeader($, header)
      header = null
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
    }
    await update($, turns, h => [...(h ?? []), turn].slice(-HISTORY))
    const answer = e.answer.trim()
    if (textSinceCall && answer !== '') {
      closedAnswers.add(answer)
      lastClose = { answer }
    } else if (live.lastToolId) {
      closedTools.add(live.lastToolId)
      lastClose = { tool: live.lastToolId }
    }
    for (const set of [closedAnswers, closedTools]) if (set.size > HISTORY) set.delete(set.values().next().value!)
    $.ui.invalidate('ui.render')
    // a finished turn stays open: the tree is the evidence of what the
    // prompt did (owner's call, 2026-10-03; /fold tucks old turns away)
    return next(e)
  })

  // ---- footer ------------------------------------------------------------
  // The engine's `Baked for 12s` line is dropped by request: the dots line
  // under the user row carries the counts, and the turn's cost and
  // tokens stay in state for anything that wants them later.
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    return $.ui.resolve(e).Box({ display: 'none', children: [] })
  })

  // ---- the hint line under the prompt: key reminders dropped ---------------
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const h = cleanHint(e.props.hint)
    return h ? renderHint($.ui.resolve(e), palette, h) : next(e)
  })

  // ---- background band ---------------------------------------------------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    // The band is one site for every plugin: what the plugins beneath draw
    // stays, under the agents' frame, and alone when no agent runs.
    const below = await next(e)
    const list = (await read($, agents)) ?? []
    if (list.length === 0) return below
    const t = $.ui.resolve(e)
    const state = (await read($, band)) ?? 'open'
    const frame = renderBand(t, palette, {
      agents: list,
      now: await $.clock.now(),
      columns: e.props.bodyColumns,
      open: state === 'open',
      onToggle: () => void update($, band, s => (s === 'closed' ? 'open' : 'closed')),
      tasksCommand: commands.has('tasks') ? 'tasks' : commands.has('bashes') ? 'bashes' : null,
    })
    return t.Box({ flexDirection: 'column', children: [frame, below] })
  })
}

/** The records the run helpers read: register's, passed in, since `$` only goes to top-level functions. */
type RunCtx = {
  callTurn: ReadonlyMap<string, string>
  turnOrder: ReadonlyMap<string, ReadonlyArray<{ id: string; tool: string; afterText: boolean; subject: string }>>
  callMs: ReadonlyMap<string, number>
  failedCalls: ReadonlySet<string>
  backgroundCalls: ReadonlySet<string>
  isLastCall: (id: string) => boolean
  turnEdits: ReadonlyMap<string, ReadonlyArray<EditDone>>
  palette: Palette
  isAllOpen: boolean
}

type Run = { head: string; turnId: string; calls: RunCall[]; isOpen: boolean; failed: Set<string> }

/**
 * The run the call `id` draws in (callRun), null when it stands alone or
 * glass never saw it. Open when pressed or under /expand. Closed, a failed
 * call still draws under the run's row: a red mark never hides behind a
 * count, and the calls that went fine stay folded (owner's request,
 * 2026-10-05: an open run read as clutter).
 */
async function findRun($: EngineInterface, c: RunCtx, id: string): Promise<Run | null> {
  const turnId = c.callTurn.get(id) ?? ''
  const run = callRun(c.turnOrder.get(turnId) ?? [], id)
  if (run.length < 2) return null
  const head = run[0]!.id
  const calls: RunCall[] = run.map(x => ({ id: x.id, tool: x.tool, subject: x.subject, status: !c.callMs.has(x.id) ? 'running' : c.failedCalls.has(x.id) ? 'failed' : c.backgroundCalls.has(x.id) ? 'background' : 'ok' }))
  const isOpen = c.isAllOpen || ((await read($, expanded)) ?? []).includes(`run:${head}`)
  return { head, turnId, calls, isOpen, failed: new Set(calls.filter(x => x.status === 'failed').map(x => x.id)) }
}

/** A run's one row, drawn by its head's row (`requestId`, for the spinner). */
async function drawRun($: EngineInterface, c: RunCtx, t: Elements['terminal'], run: Run, requestId: string): Promise<RenderElement> {
  const ids = new Set(run.calls.map(x => x.id))
  const lines = (c.turnEdits.get(run.turnId) ?? []).filter(x => ids.has(x.id)).reduce((n, x) => {
    const l = lineCounts(x.output)
    return { add: n.add + l.add, del: n.del + l.del }
  }, { add: 0, del: 0 })
  const running = run.calls.some(x => x.status === 'running')
  if (running) spinRows.add(requestId)
  else spinRows.delete(requestId)
  const key = `run:${run.head}`
  return renderRunRow(t, c.palette, run.calls, {
    key,
    isOpen: run.isOpen,
    last: run.calls.some(x => c.isLastCall(x.id)),
    lines,
    durationMs: running ? null : run.calls.reduce((n, x) => n + (c.callMs.get(x.id) ?? 0), 0),
    ...(running ? { spin: spinCells(await $.clock.now(), c.palette.meta) } : {}),
    onToggle: () => void update($, expanded, xs => ((xs ?? []).includes(key) ? (xs ?? []).filter(x => x !== key) : [...(xs ?? []), key].slice(-HISTORY))),
  })
}

/** `el` under its run's row when the call heads an open run. */
async function underRunRow($: EngineInterface, c: RunCtx, t: Elements['terminal'], run: Run | null, isHead: boolean, requestId: string, el: RenderElement): Promise<RenderElement> {
  return run && isHead ? t.Box({ flexDirection: 'column', children: [await drawRun($, c, t, run, requestId), el] }) : el
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

type Header = { text: string; startedAt: number; turnId: string }

/** The newest prompt with the turn's text gets its turn: the assistant header draws under its user row. */
async function revealHeader($: EngineInterface, h: Header): Promise<void> {
  await update($, prompts, ps => {
    const list = [...(ps ?? [])]
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]!
      if (p.text === h.text && p.turnId === null) {
        list[i] = { ...p, startedAt: h.startedAt, turnId: h.turnId }
        break
      }
    }
    return list
  })
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

/** The file's name, `Created ` before it for a new file, for a folded card's line. */
function editName(output: unknown, input: unknown): string {
  const out = output as { filePath?: unknown; type?: unknown } | undefined
  const args = input as { file_path?: unknown } | undefined
  const path = typeof out?.filePath === 'string' ? out.filePath : typeof args?.file_path === 'string' ? args.file_path : ''
  // the short path a Read's row shows, not the bare name (2026-10-05)
  const name = rel(path)
  return out?.type === 'create' ? `Created ${name}` : name
}

// An Edit's or a Write's card folded to one line by default: a press on the
// line, or /expand (`isAllOpen`), opens it. Null when there is no card.
// A file's edits in one turn draw as one row (owner's request, 2026-10-05):
// the first edit's row counts them all (`demo.txt x2 +2 -2`) and opens to
// every card in call order; the later edits draw nothing. `run` is the
// file's edits this turn, null when the edit is the file's only one.
async function foldedCard($: EngineInterface, t: Elements['terminal'], palette: Palette, isAllOpen: boolean, id: string, output: unknown, input: unknown, columns: number, isTreeRow = false, run: ReadonlyArray<EditDone> | null = null, isLast = false): Promise<RenderElement | null> {
  if (run && run[0]!.key !== id) return t.Box({ display: 'none', children: [] })
  const edits = run ?? [{ id, key: id, file: '', output, input }]
  const cards = edits.map(x => editCard(t, palette, x.output, x.input, columns)).filter((c): c is RenderElement => c !== null)
  if (cards.length === 0) return null
  const card = cards.length === 1 ? cards[0]! : t.Box({ flexDirection: 'column', children: cards })
  const lines = edits.reduce((n, x) => {
    const l = lineCounts(x.output)
    return { add: n.add + l.add, del: n.del + l.del }
  }, { add: 0, del: 0 })
  // several files: `Edit x3  a.ts, b.ts`, each file by its name once
  const files = [...new Set(edits.map(x => x.file))]
  const many = files.length > 1
  const names = files.map(f => f.split(/[\\/]/).pop() ?? f).join(', ')
  // off the tree (an unfolded group's row) the count goes with the names
  const name = many ? (isTreeRow ? names : `${G.times}${edits.length} ${names}`) : editName(output, input) + (edits.length > 1 ? ` ${G.times}${edits.length}` : '')
  const tool = many ? `Edit ${G.times}${edits.length}  ` : 'Edit  '
  const key = `card:${id}`
  const isOpen = isAllOpen || ((await read($, expanded)) ?? []).includes(key)
  return foldRow($, t, palette, key, name, countCells(palette, lines), isOpen, card, columns, isTreeRow, isLast, tool)
}

/**
 * A done edit of the main loop, as a file's run of edits holds it: an Edit's
 * or a Write's (`key` its call's id), or one file a Bash command rewrote
 * (`key` the call's id and the file). `output` is the Edit's result shape.
 */
type EditDone = { id: string; key: string; file: string; output: unknown; input: unknown }

/** The turn's edits of an edit's file; `key`, `id`, the edit's own output. */
type RunOf = (key: string, id: string, output: unknown) => EditDone[] | null

/** One file a Bash command rewrote, as an edit of its run. */
function bashEditDone(id: string, f: ChangedFile): EditDone {
  return {
    id,
    key: `${id}:${f.filePath}`,
    file: f.filePath,
    output: { filePath: f.filePath, structuredPatch: f.hunks, ...(f.created ? { type: 'create' } : {}) },
    input: { file_path: f.filePath },
  }
}

// A Bash call that rewrote files is one folded row (owner's request,
// 2026-10-05; a row, an `output` line and an Edit row per file read as
// clutter): `Bash  <description> . 11 lines  .gitignore  +2 -0`. The row
// names what the command did by its description, not the command itself;
// a press opens its output and each file's card.
async function bashEdits($: EngineInterface, t: Elements['terminal'], palette: Palette, isAllOpen: boolean, call: TreeRow, r: { lines: string[]; files: ChangedFile[]; moreFiles: number }, columns: number, o: TreeOptions, runOf: RunOf): Promise<RenderElement> {
  const description = (call.input as { description?: unknown } | undefined)?.description
  const shown = typeof description === 'string' && description.trim() !== '' ? { ...call, input: { description } } : call
  // A file whose edits this turn began elsewhere draws in that edit's row
  // (owner's request, 2026-10-05: a sed, a script and an Edit of one file
  // are one row).
  const files = r.files.filter(f => {
    const done = bashEditDone(call.tool_use_id, f)
    const run = f.hunks.length > 0 ? runOf(done.key, call.tool_use_id, done.output) : null
    return !run || run[0]!.key === done.key
  })
  const output = r.lines.length > 0 ? renderToolOutput(t, palette, r.lines, { columns, maxLines: MAX_PAINTED_LINES }) : null
  if (files.length === 0 && r.moreFiles === 0) {
    const row = renderTreeRow(t, palette, shown, o)
    return output ? t.Box({ flexDirection: 'column', children: [row, output] }) : row
  }
  const edits = files.map(f => bashEditDone(call.tool_use_id, f))
  const lines = edits.reduce((n, x) => {
    const l = lineCounts(x.output)
    return { add: n.add + l.add, del: n.del + l.del }
  }, { add: 0, del: 0 })
  const names = files.map(f => (f.created ? 'Created ' : f.deleted ? 'Deleted ' : '') + rel(f.filePath)).join(', ') + (r.moreFiles > 0 ? ` +${r.moreFiles}` : '')
  const tail: Array<[string, string]> = [
    ...(r.lines.length > 0 ? [[` ${G.middot} ${r.lines.length} line${r.lines.length === 1 ? '' : 's'}`, palette.faint] as [string, string]] : []),
    [`  ${names}`, palette.path],
    ...countCells(palette, lines),
  ]
  const cards = edits.map(x => editCard(t, palette, x.output, x.input, columns)).filter((c): c is RenderElement => c !== null)
  const body = t.Box({ flexDirection: 'column', children: [...(output ? [output] : []), ...cards] })
  const key = `bash:${call.tool_use_id}`
  const isOpen = isAllOpen || ((await read($, expanded)) ?? []).includes(key)
  const label = typeof description === 'string' && description.trim() !== '' ? description.trim() : (call.input as { command?: string } | undefined)?.command ?? ''
  return foldRow($, t, palette, key, label.replace(/\s+/g, ' '), tail, isOpen, body, columns, true, o.last, 'Bash  ')
}

/** An edit's `+N -M`, as a folded line's colored cells. */
function countCells(palette: Palette, lines: { add: number; del: number }): Array<[string, string]> {
  return [[`  +${lines.add}`, palette.ok], [` -${lines.del}`, palette.err]]
}

// A card's one folded line (mark, name, tail cells: an edit's +N -M) with
// the card under it once open; the press toggles `key` in the expanded list.
function foldRow($: EngineInterface, t: Elements['terminal'], palette: Palette, key: string, name: string, tail: ReadonlyArray<[string, string]>, isOpen: boolean, card: RenderElement, columns: number, isTreeRow = false, isLast = false, tool = 'Edit  '): RenderElement {
  const toggle = () => void update($, expanded, xs => ((xs ?? []).includes(key) ? (xs ?? []).filter(x => x !== key) : [...(xs ?? []), key].slice(-HISTORY)))
  // A Button's label takes no color: the mark, the tool and the counts are
  // Text in the tree row's colors, and the press sits on the path, dim as a
  // row's subject is
  // A Button's label takes no color, and a press on a Text cell of a folded
  // group's row goes to the group's own click: every cell of the row past
  // the connector is a Button, the blanks after the counts included, so a
  // press anywhere opens the diff (colored labels wait on the engine)
  // Under the keyed row's hover each label takes its color and the row's
  // tint, inverse off against the pointer's white inversion, and full
  // strength: a dim label otherwise stays dim on the row's hover and only
  // brightens under the pointer itself
  const press = (k: string, label: string, color: string, dim = false) => t.Button({
    key: `${key}:${k}`, plain: true, ...(dim ? { dimColor: true } : {}), label, onPress: toggle,
    hover: { color, backgroundColor: palette.rowHover, inverse: false, dimColor: false },
  })
  const used = 3 + 2 + (isTreeRow ? tool.length : 0) + name.length + tail.reduce((n, [label]) => n + label.length, 0)
  const head = t.Box({
    key: `row:${key}`,
    hover: { backgroundColor: palette.rowHover },
    flexDirection: 'row',
    children: [
      ...(isTreeRow ? [t.Text({ color: palette.faint, children: [(isLast ? G.arcBL : G.tee) + G.rule + ' '] })] : []),
      press('mark', (isOpen ? G.down : G.right) + ' ', palette.meta),
      ...(isTreeRow ? [press('tool', tool, palette.bold)] : []),
      press('name', name, palette.path, true),
      ...tail.map(([label, color], i) => press(`tail${i}`, label, color)),
      press('rest', ' '.repeat(Math.max(1, columns - 6 - used)), palette.faint),
    ],
  })
  // the card's own border is its trunk: never inside the row's inset. A
  // result's line sits on the trunk under its Edit row, not at the margin
  // (2026-10-05)
  const top = isTreeRow ? spaced(t, palette, head) : trunked(t, palette, 1, [head])
  return isOpen ? t.Box({ flexDirection: 'column', children: [top, card] }) : top
}

type GroupedCall = { tool: string; tool_use_id?: string; input: unknown; output?: unknown; isErrored: boolean }

/** An edit of a group that draws as its own folded tree row. */
function isFoldableEdit(c: GroupedCall): boolean {
  return isEditTool(c.tool) && !c.isErrored && c.output !== undefined && typeof c.tool_use_id === 'string'
}

/** A group's edits, each its own folded tree row, in call order. */
async function editRows($: EngineInterface, t: Elements['terminal'], palette: Palette, isAllOpen: boolean, calls: ReadonlyArray<GroupedCall>, columns: number, runOf: RunOf): Promise<RenderElement[]> {
  const rows: RenderElement[] = []
  for (const c of calls.filter(isFoldableEdit)) {
    const row = await foldedCard($, t, palette, isAllOpen, c.tool_use_id as string, c.output, c.input, columns, true, runOf(c.tool_use_id as string, c.tool_use_id as string, c.output))
    if (row) rows.push(row)
  }
  return rows
}
