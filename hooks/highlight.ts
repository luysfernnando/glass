// glass's own code highlighter: one small tokenizer for the C-like family
// and the script languages, painting with the palette's code keys. The
// engine's `Code` element paints with its own theme, which the owner
// rejected (2026-10-03); this keeps fences and diffs in the mod's colors.
// Shell fences go through `shellSpans` and paint with the prose keys, so a
// command reads in a fence exactly as it does in prose: the same command,
// flag, string and operator colors (they took the code keys until 0.4.20,
// so `--force` and `|` drew differently in the two places). Line by line: a block comment opened on one line carries to the
// next through `State`.
import type { Palette } from './palette'
import { shellSpans } from './shell'
import type { SpanKind } from './shell'

// `sh.*`: a shell token in a fence, painted with the prose key of its kind
export type CodeKind = 'kw' | 'fn' | 'type' | 'str' | 'num' | 'comment' | 'plain' | `sh.${Exclude<SpanKind, 'plain' | 'comment'>}`
export type CodeSpan = { text: string; kind: CodeKind }

/** the palette key a code kind paints with */
export const CODE_COLOR: Record<Exclude<CodeKind, 'plain'>, keyof Palette> = {
  kw: 'codeKw',
  fn: 'codeFn',
  type: 'codeType',
  str: 'codeStr',
  num: 'codeNum',
  comment: 'comment',
  'sh.cmd': 'cmd',
  'sh.sub': 'sub',
  'sh.flag': 'flag',
  'sh.str': 'str',
  'sh.path': 'path',
  'sh.op': 'op',
  'sh.num': 'num',
  'sh.var': 'var',
  'sh.url': 'url',
}

const SHELL_LANGS = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'fish'])
// prose files: a diff of README.md is English, not code, so nothing paints
const PROSE_LANGS = new Set(['md', 'markdown', 'mdx', 'txt', 'text', 'rst', 'adoc', 'asciidoc', 'org', 'tex', ''])
// `#` opens a comment here; everywhere else `//` does
const HASH_LANGS = new Set(['py', 'python', 'rb', 'ruby', 'yaml', 'yml', 'toml', 'ini', 'conf', 'perl', 'pl', 'r', 'make', 'makefile', 'dockerfile', 'nix', 'elixir', 'ex', 'exs', 'cmake'])
const DASH_LANGS = new Set(['sql', 'lua', 'hs', 'haskell', 'ada'])

const KEYWORDS = new Set(
  `abstract as async await break case catch class const continue debugger default delete do else enum export extends
   finally for from function if implements import in instanceof interface let new of package private protected public
   return static super switch this throw try typeof var void while with yield readonly declare namespace module type
   keyof infer satisfies override get set
   def elif except lambda pass raise global nonlocal and or not is assert del with yield
   fn impl struct trait mut pub use mod match loop where unsafe crate self Self dyn ref move
   func go chan defer select range map fallthrough goto package
   int float double char long short unsigned signed bool boolean byte string void auto struct union typedef sizeof
   static_assert constexpr template typename virtual inline explicit friend operator
   final native synchronized transient volatile throws instanceof extends implements
   begin end then elsif unless until rescue ensure module require include attr_accessor
   select insert update delete into values create table drop alter where join on group by order having limit
   local nil repeat`
    .split(/\s+/)
    .filter(Boolean),
)
const CONSTANTS = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil', 'NaN', 'Infinity'])

export type State = { inBlock: boolean }

const IDENT = /[A-Za-z_$][\w$]*/y
const NUMBER = /0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?[a-zA-Z]*/y

/** the language id a fence or a file path resolves to, lowercased */
export function langOf(hint: string): string {
  const h = hint.toLowerCase()
  const dot = h.lastIndexOf('.')
  const ext = dot >= 0 && !/[\/\\]/.test(h.slice(dot)) ? h.slice(dot + 1) : h
  const base = h.split(/[\/\\]/).pop() ?? h
  if (base === 'makefile' || base === 'dockerfile') return base
  return ext
}

/** one line as colored spans; `state` carries a block comment across lines */
export function highlightLine(line: string, lang: string, state: State = { inBlock: false }): CodeSpan[] {
  if (PROSE_LANGS.has(lang)) return line === '' ? [] : [{ text: line, kind: 'plain' }]
  if (SHELL_LANGS.has(lang)) {
    // a comment-only line: shellSpans wants a command first, and the
    // fallback below opens comments with `//`
    const note = /^(\s*)(#.*)$/.exec(line)
    if (note) return [...(note[1] ? [{ text: note[1], kind: 'plain' as const }] : []), { text: note[2]!, kind: 'comment' }]
    const spans = shellSpans(line, true)
    if (spans) return spans.map(s => ({ text: s.text, kind: s.kind === 'plain' || s.kind === 'comment' ? s.kind : (`sh.${s.kind}` as const) }))
  }
  const hash = HASH_LANGS.has(lang)
  const dash = DASH_LANGS.has(lang)
  const out: CodeSpan[] = []
  const push = (text: string, kind: CodeKind) => {
    if (text === '') return
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += text
    else out.push({ text, kind })
  }
  let i = 0
  const n = line.length
  if (state.inBlock) {
    const end = line.indexOf('*/')
    if (end < 0) {
      push(line, 'comment')
      return out
    }
    push(line.slice(0, end + 2), 'comment')
    i = end + 2
    state.inBlock = false
  }
  while (i < n) {
    const ch = line[i]!
    const two = line.slice(i, i + 2)
    // comments
    if ((!hash && !dash && two === '//') || (hash && ch === '#') || (dash && two === '--')) {
      push(line.slice(i), 'comment')
      break
    }
    if (!hash && two === '/*') {
      const end = line.indexOf('*/', i + 2)
      if (end < 0) {
        push(line.slice(i), 'comment')
        state.inBlock = true
        break
      }
      push(line.slice(i, end + 2), 'comment')
      i = end + 2
      continue
    }
    // strings: one line, escapes honored
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < n && line[j] !== ch) j += line[j] === '\\' ? 2 : 1
      push(line.slice(i, Math.min(n, j + 1)), 'str')
      i = Math.min(n, j + 1)
      continue
    }
    // numbers
    if (/\d/.test(ch) && !(i > 0 && /[\w$]/.test(line[i - 1]!))) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(line)
      if (m) {
        push(m[0], 'num')
        i += m[0].length
        continue
      }
    }
    // words
    if (/[A-Za-z_$]/.test(ch)) {
      IDENT.lastIndex = i
      const m = IDENT.exec(line)!
      const word = m[0]
      // the nearest non-space character after the word and before it,
      // found in place: copying the line per word was quadratic
      let a = i + word.length
      while (a < n && /\s/.test(line[a]!)) a++
      const after = line[a]
      let b = i - 1
      while (b >= 0 && /\s/.test(line[b]!)) b--
      const before = b >= 0 ? line[b]! : ''
      let kind: CodeKind = 'plain'
      if (KEYWORDS.has(word) && before !== '.') kind = 'kw'
      else if (CONSTANTS.has(word)) kind = 'num'
      else if (after === '(') kind = 'fn'
      else if (/^[A-Z]/.test(word) && /[a-z]/.test(word)) kind = 'type'
      else if (before === ':' && !hash) kind = 'type'
      push(word, kind)
      i += word.length
      continue
    }
    push(ch, 'plain')
    i++
  }
  return out
}

/** every line of a source as spans, block comments carried across */
export function highlight(source: string, lang: string): CodeSpan[][] {
  const state: State = { inBlock: false }
  return source.split('\n').map(line => highlightLine(line, lang, state))
}
