// What a paragraph of Claude's prose asks of the reader, ported from
// claude-hl: a question, an opening instruction, or an attention phrase
// earns a gutter mark. Matters of wording, decided by small tables.

const ATTENTION = [
  // asks of the reader
  'you need', "you'll need", 'you must', 'you should', 'you have to', 'you may want', 'you might want',
  "you can't", 'you cannot', "don't forget", 'your call', 'up to you', 'let me know',
  'do you want', 'should i', 'which one', 'manually', 'by hand', 'before you', 'if you want', 'on your machine',
  'your machine', 'your terminal', 'yourself', 'restart', 'reboot', 'reinstall', 're-run', 'rerun', 'log in',
  'sign in',
  // what did not happen
  'not verif*', "can't verify", 'cannot verify', 'could not verify', "couldn't verify", 'unverified',
  'untested', 'not tested', 'no tests', 'i did not', "i didn't", "i haven't", 'i could not', "i couldn't",
  'skipped', 'left out', 'blocked', 'not yet', "won't work", 'will not work', 'does not work', "doesn't work",
  'still fail*', 'keeps fail*', 'regress*', 'assum*',
  // risk
  'warning', 'caution', 'careful', 'risk*', 'danger*', 'breaking', 'irreversib*', 'destructive', 'data loss',
  'backup', 'security', 'vulnerab*', 'secret*', 'credential*', 'password*', 'deprecat*', 'caveat*', 'however',
  'important', 'todo', 'fixme',
]

// openers that make the paragraph an instruction to the reader
const IMPERATIVE = [
  'run', 'set', 'add', 'install', 'restart', 'open', 'check', 'update', 'remove', 'delete', 'replace',
  'rename', 'export', 'copy', 'paste', 'change', 'edit', 'enable', 'disable', 'confirm', 'review', 'decide',
  'choose', 'pick', 'try', 'note', 'beware', 'remember', "don't", 'do not', 'never', 'always', 'please',
  'make sure', 'be sure',
]

// verbs near the front of a prompt that ask Claude to write something rather
// than do something: the reply is then the thing itself, and nothing in it
// asks the reader for anything
const WRITE_WORDS = new Set([
  'write', 'draft', 'compose', 'reword', 'rewrite', 'rephrase', 'translate', 'proofread', 'polish',
  'shorten', 'expand', 'summarize', 'summarise',
])

const RIGHT_QUOTE = String.fromCodePoint(0x2019)

// ` word word ? word ` so phrases match on word boundaries
function normalize(text: string): string {
  let norm = ' '
  let inWord = false
  for (const c of text) {
    const keep = /[\p{L}\p{N}]/u.test(c) || c === "'" || c === RIGHT_QUOTE || (c === '-' && inWord)
    if (keep) {
      norm += c === RIGHT_QUOTE ? "'" : c.toLowerCase()
      inWord = true
    } else {
      if (inWord) norm += ' '
      inWord = false
      if (c === '?') norm += '? '
    }
  }
  if (inWord) norm += ' '
  return norm
}

/** does this paragraph need the reader? */
export function needsAttention(text: string): boolean {
  const norm = normalize(text)
  if (norm.includes(' ? ')) return true
  const body = norm.slice(1)
  if (IMPERATIVE.some(w => body.startsWith(w + ' '))) return true
  return ATTENTION.some(p => (p.endsWith('*') ? norm.includes(' ' + p.slice(0, -1)) : norm.includes(` ${p} `)))
}

/** does the prompt ask Claude to write something? one of WRITE_WORDS in its first six words */
export function writeIntent(prompt: string): boolean {
  return prompt
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length > 0)
    .slice(0, 6)
    .some(w => WRITE_WORDS.has(w))
}

/** Claude's own planning note: a paragraph opening with Private or Privately */
export function isPrivateNote(text: string): boolean {
  return /^Privately?\b/.test(text.trimStart())
}
