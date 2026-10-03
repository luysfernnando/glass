// Shell tokenizer for inline code, ported from claude-hl's `spans`.
// Inline code is a known code context, so every token gets a color; the
// prose guards (stop words, bare-word budget) are not needed here.

const COMMANDS = new Set(
  `git gh npm npx pnpm yarn bun bunx node deno python python3 pip pip3 uv go cargo
rustc make cmake brew apt apt-get dnf pacman docker docker-compose kubectl helm
terraform aws gcloud az ssh scp rsync curl wget tar zip unzip cd ls cat head
tail less grep rg fd find xargs sed awk sort uniq wc tr cut tee echo printf
export source chmod chown mkdir rmdir rm cp mv ln touch pwd which env nvim vim
tmux ghostty claude claude-hl codex gemini open kill pkill ps lsof jq yq tsc tsx vitest
jest eslint prettier next vite
sudo doas nohup just pytest ruff mypy poetry pipx uvx conda mvn gradle dotnet
swift ruby gem bundle rake rspec php composer psql mysql sqlite3 redis-cli
mongosh systemctl journalctl launchctl xcodebuild xcrun flutter dart adb
ffmpeg pandoc openssl gpg shellcheck protoc ansible vagrant nix zig perl lua
gcc clang ninja bazel
bash sh zsh fish exec exit man diff patch du df sleep time watch bat eza tree stat
rustup nvm fnm pm2 podman k9s minikube kind htop nc dig ping ssh-keygen base64
shasum sha256sum xxd hyperfine tokei cloc fzf zoxide code cursor pbcopy pbpaste
xdg-open turbo nx lerna webpack esbuild biome prisma wrangler vercel netlify
flyctl heroku supabase firebase ngrok mise asdf direnv gdb lldb valgrind strace
mkcert caddy certbot crontab screen zellij`.split(/\s+/),
)

// tools whose bare-word args are subcommands; for others only flags, paths
// and strings count
const SUBCMD_TOOLS = new Set(
  `git gh npm npx pnpm yarn bun bunx deno uv pip pip3 go cargo brew apt apt-get
dnf pacman docker docker-compose kubectl helm terraform aws gcloud az claude
codex gemini tmux make jq tsc next vite
sudo doas nohup poetry pipx conda mvn gradle dotnet swift gem bundle rake
composer systemctl journalctl launchctl flutter dart adb nix vagrant bazel openssl
man rustup nvm fnm pm2 podman minikube kind turbo nx lerna prisma wrangler vercel
netlify flyctl heroku supabase firebase mise asdf direnv crontab`.split(/\s+/),
)

// prefix runners: a known command right after them re-anchors the highlight
const CHAIN_TOOLS = new Set('sudo doas env xargs nohup time watch exec'.split(' '))

const MAX_SUB = 3

export type SpanKind =
  | 'cmd'
  | 'sub'
  | 'flag'
  | 'str'
  | 'path'
  | 'op'
  | 'num'
  | 'var'
  | 'url'
  | 'comment'
  | 'plain'

export type Span = { text: string; kind: SpanKind }

type TokKind =
  | 'ws'
  | 'str'
  | 'chain'
  | 'redirect'
  | 'flag'
  | 'path'
  | 'sub'
  | 'word'
  | 'num'
  | 'var'
  | 'url'
  | 'comment'

type Tok = { kind: TokKind; start: number; end: number }

const isSpace = (c: string) => /\s/.test(c)
// newlines are whitespace too: multi-line commands keep their colors
const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
const isWord = (c: string) => /[A-Za-z0-9_]/.test(c)
const isPathMark = (c: string) => '/.~=:@*'.includes(c)
const isSentencePunct = (c: string) => '.,;:)'.includes(c)

function wordEnd(t: string, j: number): number {
  while (j < t.length && !isSpace(t[j]!)) j++
  return j
}

function nextArg(t: string, i: number): Tok | null {
  const n = t.length
  if (i >= n) return null
  const b = t[i]!
  const atBoundary = (j: number) => j >= n || isSpace(t[j]!)
  const opEnd = (j: number) => atBoundary(j) || !'><&|;'.includes(t[j]!)

  if (isWs(b)) {
    let j = i
    while (j < n && isWs(t[j]!)) j++
    return { kind: 'ws', start: i, end: j }
  }
  if (b === '"') {
    let j = i + 1
    while (j < n) {
      if (t[j] === '\\' && j + 1 < n) j += 2
      else if (t[j] === '"') return { kind: 'str', start: i, end: j + 1 }
      else j++
    }
  } else if (b === "'") {
    const k = t.indexOf("'", i + 1)
    if (k >= 0) return { kind: 'str', start: i, end: k + 1 }
  }
  for (const op of ['&&', '||', '|', ';']) {
    const j = i + op.length
    if (t.startsWith(op, i) && (op === ';' ? atBoundary(j) : opEnd(j))) {
      return { kind: 'chain', start: i, end: j }
    }
  }
  for (const op of ['2>&1', '&>', '2>', '>>', '>', '<<', '<']) {
    const j = i + op.length
    if (t.startsWith(op, i) && opEnd(j)) return { kind: 'redirect', start: i, end: j }
  }
  if (b === '#' && (i + 1 >= n || isSpace(t[i + 1]!))) return { kind: 'comment', start: i, end: n }
  if (b === '$') return { kind: 'var', start: i, end: wordEnd(t, i + 1) }
  for (const scheme of ['http://', 'https://', 'ssh://', 'git@', 'file://', 'www.']) {
    if (t.startsWith(scheme, i)) return { kind: 'url', start: i, end: wordEnd(t, i) }
  }
  if (b === '-') {
    let j = i + 1
    if (t[j] === '-') j++
    if (j < n && /[A-Za-z]/.test(t[j]!)) {
      j++
      while (j < n && (isWord(t[j]!) || t[j] === '-')) j++
      // `--flag=value`: the flag ends after `=`, the value is its own token
      if (t[j] === '=') j++
      return { kind: 'flag', start: i, end: j }
    }
    // numeric args: `tail -20`, `head -5` read as counts, not flags
    if (j < n && /[0-9]/.test(t[j]!)) {
      let k = j + 1
      while (k < n && /[0-9]/.test(t[k]!)) k++
      if (atBoundary(k) || t[k] === ')') return { kind: 'num', start: i, end: k }
    }
    // `--` and `-` on their own
    if (atBoundary(j)) return { kind: 'flag', start: i, end: j }
  }
  // `chmod +x`, `date +%s`
  if (b === '+' && i + 1 < n && !isSpace(t[i + 1]!)) return { kind: 'flag', start: i, end: wordEnd(t, i + 1) }
  // numbers, versions, sizes, durations: 5  1.2.0  v1.2.0  10s  3.5GB  80%
  if (/[0-9]/.test(b) || (b === 'v' && /[0-9]/.test(t[i + 1] ?? ''))) {
    const j = wordEnd(t, i)
    const bodyEnd = j - i > 1 && isSentencePunct(t[j - 1]!) ? j - 1 : j
    const body = t.slice(i + (b === 'v' ? 1 : 0), bodyEnd)
    if (body.length > 0 && /^[0-9.%kKmMgGBshd]+$/.test(body)) return { kind: 'num', start: i, end: j }
  }
  {
    const j = wordEnd(t, i)
    // `PORT=3000`: an environment assignment
    if (/[A-Za-z_]/.test(b)) {
      let k = i
      while (k < j && isWord(t[k]!)) k++
      if (k < j && t[k] === '=') return { kind: 'var', start: i, end: j }
    }
    const bodyEnd = j - i > 1 && isSentencePunct(t[j - 1]!) ? j - 1 : j
    if ([...t.slice(i, bodyEnd)].some(isPathMark)) return { kind: 'path', start: i, end: j }
  }
  if (/[a-z]/.test(b)) {
    let j = i + 1
    while (j < n && /[a-z0-9-]/.test(t[j]!)) j++
    // `size.` at the end of a sentence: keep the punctuation in the token so
    // the span logic sees it and ends the span there
    if (j < n && isSentencePunct(t[j]!) && atBoundary(j + 1)) j++
    return { kind: 'sub', start: i, end: j }
  }
  if (isWord(b)) return { kind: 'word', start: i, end: wordEnd(t, i) }
  return { kind: 'word', start: i, end: i + 1 }
}

/**
 * Color spans for one inline-code string, or null when it is not a shell
 * command line (its first real word is not a known command). With `trusted`
 * the head is a command whatever it is: for a Bash tool row, where the text
 * is known to be a command line.
 */
export function shellSpans(code: string, trusted = false): Span[] | null {
  const t = code
  const out: Span[] = []
  const push = (start: number, end: number, kind: SpanKind) => {
    if (end > start) out.push({ text: t.slice(start, end), kind })
  }
  let i = 0
  // `$ ` prompt and leading env assignments precede the command
  if (t.startsWith('$ ')) {
    push(0, 2, 'comment')
    i = 2
  }
  let cmd = ''
  for (;;) {
    const tok = nextArg(t, i)
    if (!tok) return null
    if (tok.kind === 'ws') {
      push(tok.start, tok.end, 'plain')
    } else if (tok.kind === 'var' && t[tok.start] !== '$') {
      push(tok.start, tok.end, 'var')
    } else {
      const word = t.slice(tok.start, tok.end)
      const isHead = tok.kind === 'sub' || tok.kind === 'word' || tok.kind === 'path'
      if (isHead && (trusted || COMMANDS.has(word))) {
        push(tok.start, tok.end, 'cmd')
        cmd = word
        i = tok.end
        break
      }
      return null
    }
    i = tok.end
  }

  let subs = 0
  let afterEq = false
  let after: 'chain' | 'redirect' | null = null
  let tok: Tok | null
  while ((tok = nextArg(t, i))) {
    const { kind, start, end } = tok
    i = end
    if (kind === 'ws') {
      push(start, end, 'plain')
      continue
    }
    const word = t.slice(start, end)
    // a lone full stop or comma stays plain
    if (word.length === 1 && isSentencePunct(word)) {
      push(start, end, 'plain')
      continue
    }
    // `--out=dist`: the word glued to a flag is its value
    if (afterEq && (kind === 'sub' || kind === 'word')) {
      afterEq = false
      push(start, end, 'path')
      continue
    }
    afterEq = kind === 'flag' && word.endsWith('=')

    if (after === 'chain' && kind !== 'chain' && kind !== 'redirect') {
      after = null
      if ((kind === 'sub' || kind === 'word') && COMMANDS.has(word)) {
        push(start, end, 'cmd')
        cmd = word
        subs = 0
        continue
      }
      if (kind === 'path' || kind === 'var') {
        push(start, end, kind)
        cmd = ''
        subs = 0
        continue
      }
    }
    if (after === 'redirect' && kind !== 'chain' && kind !== 'redirect') {
      after = null
      push(start, end, kind === 'str' || kind === 'var' || kind === 'num' ? kind : 'path')
      continue
    }

    // a token carrying sentence punctuation: the body takes the color, the
    // punctuation stays plain
    const trimmed = TRIMMABLE.has(kind) && word.length > 1 && isSentencePunct(word[word.length - 1]!)
    const bodyEnd = trimmed ? end - 1 : end
    switch (kind) {
      case 'sub':
      case 'word': {
        if (CHAIN_TOOLS.has(cmd) && COMMANDS.has(word)) {
          push(start, bodyEnd, 'cmd')
          cmd = word
          subs = 0
        } else if (kind === 'sub' && SUBCMD_TOOLS.has(cmd) && subs < MAX_SUB) {
          subs++
          push(start, bodyEnd, 'sub')
        } else {
          push(start, bodyEnd, 'path')
        }
        break
      }
      case 'chain':
      case 'redirect':
        after = kind
        push(start, end, 'op')
        break
      default:
        push(start, bodyEnd, kind)
    }
    if (trimmed) push(bodyEnd, end, 'plain')
  }
  return out
}

const TRIMMABLE = new Set<TokKind>(['sub', 'word', 'path', 'num', 'var'])

// words that end a command span in prose: the sentence is resuming
const STOP_WORDS = new Set(
  'and or then to the a an in on for with is it that this if of at by from so but you we i will can should after before when do not into was are has have your our'.split(' '),
)
// in prose, bare non-subcommand words tolerated before giving up
const MAX_BARE = 3
// command words that are also plain English: a number after one (`sleep 5
// seconds`, `code across 13 files`) is the sentence, not an argument, so it
// does not count as evidence on its own; a flag, a path or an operator still does
const ENGLISH = new Set(
  'code sleep time watch open sort find cut tree kill touch make head tail less man diff patch which env source echo tee go kind dig ping stat zip tar cat'.split(' '),
)
// text right before a command that marks it as a command line rather than prose
const RUNNER_PREFIXES = ['Ran', 'Run', 'Running', 'Bash(', '$']
// chars that may not precede a command word
const isCmdGlue = (c: string) => isWord(c) || '/.@~-'.includes(c)

export type ProseSpan = { start: number; end: number; kind: SpanKind }

// the next known command word at or after `from`, at a word boundary
function findCmd(t: string, from: number): [number, number] | null {
  let i = from
  while (i < t.length) {
    if (isSpace(t[i]!)) {
      i++
      continue
    }
    const start = i
    while (i < t.length && !isSpace(t[i]!)) i++
    for (let p = start; p < i; p++) {
      if (p === 0 || !isCmdGlue(t[p - 1]!)) {
        if (COMMANDS.has(t.slice(p, i))) return [p, i]
      }
    }
  }
  return null
}

/**
 * Command spans inside prose, claude-hl's hard case. `make sure`, `go ahead`
 * and `next step` are valid command shapes, so a command in a sentence only
 * paints once a flag, path, string, number or operator turns up, or when a
 * runner prefix (`Ran`, `$`) precedes it. `git push --follow-tags` paints,
 * `git status` in a sentence does not, nor does `make sure the build passes`.
 */
export function proseSpans(text: string): ProseSpan[] {
  const t = text
  const out: ProseSpan[] = []
  let pos = 0
  let found: [number, number] | null
  while ((found = findCmd(t, pos))) {
    const [cs, ce] = found
    let cmd = t.slice(cs, ce)
    const mark = out.length
    out.push({ start: cs, end: ce, kind: 'cmd' })
    const before = t.slice(0, cs).trimEnd()
    const strong = RUNNER_PREFIXES.some(p => before.endsWith(p))
    let i = ce
    let subs = 0
    let nargs = 0
    let bare = 0
    let afterEq = false
    let evidence = false
    let after: 'chain' | 'redirect' | null = null
    let tok: Tok | null
    scan: while ((tok = nextArg(t, i))) {
      const { kind, start, end } = tok
      if (kind === 'ws') {
        i = end
        continue
      }
      const word = t.slice(start, end)
      // a lone full stop or comma is the sentence, not an argument
      if (word.length === 1 && isSentencePunct(word)) break
      if (afterEq && (kind === 'sub' || kind === 'word')) {
        afterEq = false
        out.push({ start, end, kind: 'path' })
        nargs++
        i = end
        continue
      }
      afterEq = kind === 'flag' && word.endsWith('=')
      if (after === 'chain' && kind !== 'chain' && kind !== 'redirect') {
        if ((kind === 'sub' || kind === 'word') && COMMANDS.has(word)) {
          out.push({ start, end, kind: 'cmd' })
          cmd = word
          subs = 0
          after = null
          evidence = true
          i = end
          continue
        }
        if ((kind === 'path' && /^(\.\/|\/|~)/.test(word)) || kind === 'var') {
          out.push({ start, end, kind: kind === 'var' ? 'var' : 'path' })
          cmd = ''
          subs = 0
          after = null
          evidence = true
          nargs++
          i = end
          continue
        }
        break
      }
      if (after === 'redirect' && kind !== 'chain' && kind !== 'redirect') {
        if (kind === 'comment' || kind === 'flag') break
        out.push({ start, end, kind: kind === 'str' || kind === 'var' || kind === 'num' ? kind : 'path' })
        after = null
        nargs++
        evidence = true
        i = end
        continue
      }
      let color: SpanKind
      switch (kind) {
        case 'sub':
        case 'word': {
          if (CHAIN_TOOLS.has(cmd) && COMMANDS.has(word)) {
            out.push({ start, end, kind: 'cmd' })
            cmd = word
            subs = 0
            nargs++
            evidence = true
            i = end
            continue
          }
          if (STOP_WORDS.has(word)) break scan
          if (kind === 'sub' && SUBCMD_TOOLS.has(cmd) && subs < MAX_SUB) {
            subs++
            color = 'sub'
          } else if (strong) {
            color = 'path'
          } else {
            // prose: take a few bare words on trust while waiting for
            // evidence; once there is some, a bare word is more likely the
            // sentence resuming than an argument
            bare++
            if (evidence || bare > MAX_BARE) break scan
            color = 'path'
          }
          break
        }
        case 'chain':
        case 'redirect':
          after = kind
          color = 'op'
          break
        default:
          color = kind
      }
      // operators only count once something real follows them; a bare
      // number after an English-word command is not evidence
      if (kind !== 'sub' && kind !== 'word' && kind !== 'chain' && kind !== 'redirect') {
        if (!(kind === 'num' && ENGLISH.has(cmd))) evidence = true
      }
      // a bare word followed by sentence punctuation ends the span
      if (TRIMMABLE.has(kind) && word.length > 1 && isSentencePunct(word[word.length - 1]!)) {
        out.push({ start, end: end - 1, kind: color })
        nargs++
        i = end - 1
        break
      }
      out.push({ start, end, kind: color })
      nargs++
      i = end
    }
    // a trailing chain operator paints nothing on its own
    if (after) {
      const last = out[out.length - 1]
      if (last && last.kind === 'op') {
        i = last.start
        out.pop()
        nargs--
      }
    }
    if (nargs === 0 || (!strong && !evidence)) {
      // bare command word in prose, or `make sure`: leave it alone
      out.length = mark
      pos = ce
      continue
    }
    pos = i
  }
  return out
}
