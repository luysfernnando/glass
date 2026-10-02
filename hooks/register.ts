import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GlassTurn } from '../types'
import { G } from './glyphs'
import { parseMarkdown } from './markdown'
import { paletteNamed } from './palette'
import { writeIntent } from './prose'
import { renderReply, renderToolHeader, renderToolOutput } from './render'

// The turns this session, newest last. A footer row finds its own turn in
// here: a `read` while a render hook runs subscribes that row, so every
// `update` draws every footer again, and each must still find its data.
const turns = atom({ plugin: 'glass', key: 'turns' } as const, [] as GlassTurn[])
const HISTORY = 48

const ESC = String.fromCodePoint(0x1b)
// the engine shows this many output lines before folding the rest behind ctrl+o
const MAX_PAINTED_LINES = 3

// `3:31 PM` in the machine's locale
const clockTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as { palette?: unknown }
  const palette = paletteNamed(opts.palette)
  // gutter marks are off for a turn whose prompt asked for writing: the
  // reply is then the thing itself and asks nothing of the reader
  let marks = true

  // ---- reply renderer ----------------------------------------------------
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const text = e.props.text
    if (text.trim() === '') return next(e)
    const t = $.ui.resolve(e)
    return renderReply(t, parseMarkdown(text), palette, {
      bullet: e.props.isFirstOfReply,
      columns: e.viewport?.columns ?? 80,
      marks,
    })
  })

  // ---- tool row header ---------------------------------------------------
  // Draws the header line only; the result body stays the engine's. Open
  // question: in an expanded group (ctrl+o, --verbose) the engine draws the
  // result inline in this row, and this header-only tree may drop it there.
  // The props cannot tell a grouped row from a standalone one, so no preview
  // is drawn until that is verified live.
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const t = $.ui.resolve(e)
    return renderToolHeader(t, palette, e.props)
  })

  // Bash output body, painted the way claude-hl painted it. The engine
  // strips escape codes from a rewritten result, so the body is drawn as
  // Text, and only when it is short enough that the engine would show it
  // whole: longer output keeps the engine's collapsed body and ctrl+o.
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.tool !== 'Bash' || e.props.isErrored) return next(e)
    const out = e.props.output as { stdout?: unknown; stderr?: unknown; interrupted?: unknown } | undefined
    if (!out || typeof out.stdout !== 'string' || out.interrupted === true) return next(e)
    const stderr = typeof out.stderr === 'string' ? out.stderr : ''
    const text = [out.stdout, stderr].filter(s => s.trim() !== '').join('\n').replace(/\s+$/, '')
    if (text === '' || text.includes(ESC)) return next(e)
    const lines = text.split('\n')
    const cols = e.viewport?.columns ?? 80
    // short and narrow: the engine would neither collapse nor wrap it much
    if (lines.length > MAX_PAINTED_LINES || lines.some(l => l.length > cols * 2)) return next(e)
    return renderToolOutput($.ui.resolve(e), palette, lines)
  })

  // ---- turn footer -------------------------------------------------------
  // main-loop tool calls this turn; a hot reload resets it, which only
  // affects the footer of the turn that reloaded
  let tools = 0

  on('prompt.submit', ($, e, next) => {
    tools = 0
    marks = !writeIntent(e.text)
    return next(e)
  })

  on('tool.call', ($, e, next) => {
    if (!e.agentId) tools += 1
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const u = e.usage
      const turn: GlassTurn = {
        durationMs: e.durationMs,
        tools,
        inTokens: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0,
        outTokens: u ? u.output_tokens : 0,
        finishedAt: await $.clock.now(),
      }
      await update($, turns, h => [...(h ?? []), turn].slice(-HISTORY))
    }
    return next(e)
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const durationMs = e.props.durationMs
    const history = (await read($, turns)) ?? []
    // this row's own turn: the engine formats the same durationMs the event
    // carried; a near miss covers the line drawing before turn.complete lands
    const turn = history.find(h => h.durationMs === durationMs)
      ?? [...history].reverse().find(h => Math.abs(h.durationMs - durationMs) < 5000)
      ?? null
    const count = turn?.tools ?? 0
    if (durationMs < 3000 && count === 0) return Box({ display: 'none', children: [] })
    const parts = [fmtDuration(durationMs)]
    if (count > 0) parts.push(`${count} ${count === 1 ? 'tool' : 'tools'}`)
    // input is mostly cache reads of the whole context, so call it ctx
    if (turn && turn.inTokens > 0) parts.push(`${fmtTokens(turn.inTokens)} ctx`, `${fmtTokens(turn.outTokens)} out`)
    // when the turn ended, as the engine's own line said it
    if (turn) parts.push(`done ${clockTime.format(turn.finishedAt)}`)
    return Box({ marginLeft: 2, marginTop: 1, children: [Text({ dimColor: true, children: [parts.join(` ${G.middot} `)] })] })
  })
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1e6) return `${Math.round(n / 1000)}k`
  return `${(n / 1e6).toFixed(1)}M`
}
