// Paints a tool's text output the way claude-hl painted Claude Code's gray
// output: commands with evidence, paths and URLs, error, warning and success
// words, numbers and durations, check and cross marks, and git status codes
// at the start of a line. Returns colored segments; render.ts draws them as
// Text, since the engine strips escape codes from a rewritten result.
import type { Palette } from './palette'
import { bareWord, isUrl, pathLike } from './paths'
import { proseSpans } from './shell'

const ERR_WORDS = new Set('error errors Error ERROR FAILED FAIL failed fail failure panicked panic fatal Fatal FATAL'.split(' '))
const WARN_WORDS = new Set('warning warnings Warning WARNING warn WARN deprecated Deprecated'.split(' '))
const OK_WORDS = new Set('ok OK passed pass PASS PASSED success Success succeeded done Done'.split(' '))

const cp = (n: number) => String.fromCodePoint(n)
const CHECKS = new Set([cp(0x2713), cp(0x2714)])
const CROSSES = new Set([cp(0x2717), cp(0x2718), cp(0xd7)])

// `12`, `0.42s`, `1.2k`, `80%`: a number with at most two letters or a percent
const NUMBER_RE = /^\d+(?:\.\d+)*(?:[A-Za-z]{1,2}|%)?$/

/** a run of output text; `color` absent means the output's own gray */
export type Segment = { text: string; color?: keyof Palette }

function wordSegments(raw: string): Segment[] {
  const { lead, word, tail } = bareWord(raw)
  if (!word) return [{ text: raw }]
  const wrap = (color: keyof Palette, body = word): Segment[] => [
    ...(lead ? [{ text: lead }] : []),
    { text: body, color },
    ...(tail ? [{ text: tail }] : []),
  ]
  if (ERR_WORDS.has(word) || CROSSES.has(word)) return wrap('err')
  if (WARN_WORDS.has(word)) return wrap('warn')
  if (OK_WORDS.has(word) || CHECKS.has(word)) return wrap('ok')
  if (NUMBER_RE.test(word)) return wrap('num')
  if (isUrl(word)) return wrap('url')
  const path = pathLike(word)
  if (path) {
    return [
      ...(lead ? [{ text: lead }] : []),
      { text: path.path, color: 'path' },
      ...(path.lineno ? [{ text: path.lineno, color: 'num' as const }] : []),
      ...(tail ? [{ text: tail }] : []),
    ]
  }
  return [{ text: raw }]
}

// plain text: words and the whitespace between them
function textSegments(text: string): Segment[] {
  return text.split(/(\s+)/).flatMap(part => (part === '' ? [] : /^\s+$/.test(part) ? [{ text: part }] : wordSegments(part)))
}

// git status codes at the start of a line: `M src/x.rs`, `?? new/`
function gitStatus(line: string): { head: Segment[]; rest: string } | null {
  const m = /^(\s*)([MADRCU?!]{1,2})(\s{1,2})(\S+)/.exec(line)
  if (!m) return null
  const codes = m[2]!
  const word = m[4]!
  if (!(word.includes('/') || word.includes('.') || codes.length === 2)) return null
  const color = (c: string): keyof Palette =>
    c === 'A' ? 'ok' : c === 'D' || c === 'U' ? 'err' : c === '?' || c === '!' ? 'comment' : 'warn'
  const head: Segment[] = [...(m[1] ? [{ text: m[1] }] : []), ...[...codes].map(c => ({ text: c, color: color(c) }))]
  return { head, rest: line.slice(m[1]!.length + codes.length) }
}

/** one output line as colored segments */
export function paintLine(line: string): Segment[] {
  const git = gitStatus(line)
  const head = git ? git.head : []
  const body = git ? git.rest : line
  const out: Segment[] = [...head]
  let pos = 0
  for (const s of proseSpans(body)) {
    if (s.start > pos) out.push(...textSegments(body.slice(pos, s.start)))
    const kind = s.kind === 'plain' ? undefined : (s.kind as keyof Palette)
    out.push(kind ? { text: body.slice(s.start, s.end), color: kind } : { text: body.slice(s.start, s.end) })
    pos = s.end
  }
  if (pos < body.length) out.push(...textSegments(body.slice(pos)))
  return out
}
