// Paints a tool's text output with truecolor SGR codes, the way claude-hl
// painted Claude Code's gray output: paths in the path color, error,
// warning and success words in theirs, numbers and durations, check marks,
// and git status codes at the start of a line. Used through a display-only
// rewrite of the result, so the engine's collapse and ctrl+o keep working.
import type { Palette } from './palette'
import { bareWord, isUrl, pathLike } from './paths'

const ERR_WORDS = new Set('error errors Error ERROR FAILED FAIL failed fail failure panicked panic fatal Fatal FATAL'.split(' '))
const WARN_WORDS = new Set('warning warnings Warning WARNING warn WARN deprecated Deprecated'.split(' '))
const OK_WORDS = new Set('ok OK passed pass PASS PASSED success Success succeeded done Done'.split(' '))

const cp = (n: number) => String.fromCodePoint(n)
const ESC = cp(0x1b)
const RESET_FG = ESC + '[39m'
const CHECKS = new Set([cp(0x2713), cp(0x2714)]) // check marks
const CROSSES = new Set([cp(0x2717), cp(0x2718), cp(0xd7)]) // ballot x, multiplication sign
const CONNECTOR = cp(0x23bf) // the engine's output connector

// `12`, `0.42s`, `1.2k`, `80%`: a number with at most two letters or a percent
const NUMBER_RE = /^\d+(?:\.\d+)*(?:[A-Za-z]{1,2}|%)?$/

function fg(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `${ESC}[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`
}

const paint = (hex: string, s: string) => (s ? `${fg(hex)}${s}${RESET_FG}` : s)

// git status codes at the start of a line: `M src/x.rs`, `?? new/`
function gitStatusPrefix(line: string, p: Palette): { painted: string; rest: string } | null {
  const m = /^(\s*)([MADRCU?!]{1,2})(\s{1,2})(\S+)/.exec(line.replace(CONNECTOR, ' '))
  if (!m) return null
  const codes = m[2]!
  const word = m[4]!
  const pathish = word.includes('/') || word.includes('.') || codes.length === 2
  if (!pathish) return null
  const colored = [...codes]
    .map(c => paint(c === 'A' ? p.ok : c === 'D' || c === 'U' ? p.err : c === '?' || c === '!' ? p.comment : p.warn, c))
    .join('')
  const head = line.slice(0, m[1]!.length + codes.length)
  return { painted: head.replace(codes, colored), rest: line.slice(head.length) }
}

function paintWord(raw: string, p: Palette): string {
  const { lead, word, tail } = bareWord(raw)
  if (!word) return raw
  if (ERR_WORDS.has(word)) return lead + paint(p.err, word) + tail
  if (WARN_WORDS.has(word)) return lead + paint(p.warn, word) + tail
  if (OK_WORDS.has(word)) return lead + paint(p.ok, word) + tail
  if (CHECKS.has(word)) return lead + paint(p.ok, word) + tail
  if (CROSSES.has(word)) return lead + paint(p.err, word) + tail
  if (NUMBER_RE.test(word)) return lead + paint(p.num, word) + tail
  if (isUrl(word)) return lead + paint(p.url, word) + tail
  const path = pathLike(word)
  if (path) return lead + paint(p.path, path.path) + paint(p.num, path.lineno) + tail
  return raw
}

export function paintOutput(text: string, p: Palette): string {
  if (text.includes(ESC)) return text
  return text
    .split('\n')
    .map(line => {
      const git = gitStatusPrefix(line, p)
      const head = git ? git.painted : ''
      const body = git ? git.rest : line
      return head + body.replace(/[^\s]+/g, raw => paintWord(raw, p))
    })
    .join('\n')
}
