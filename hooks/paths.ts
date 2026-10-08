// Paths and URLs as claude-hl recognized them, used in prose and in tool
// output. Absolute, relative and home paths always count; otherwise a known
// extension or a dotfile is needed, so "and/or" and "e.g." stay plain.

export const EXTENSIONS = new Set(
  `rs ts tsx js jsx mjs cjs mts cts json jsonc toml yaml yml md mdx txt py pyi go rb java kt kts swift c cc cpp h
hpp cs php html htm css scss sass less sh bash zsh fish lock sql env xml svg png jpg jpeg gif webp ico csv tsv log ini cfg conf lua vim el
ex exs erl hs ml scala dart proto graphql gql wasm zip tar gz tgz pdf ipynb sum mod
vue svelte astro tf hcl nix zig jl r m mm tex bib rst adoc ps1 bat cmd gradle properties
pem crt key plist ttf otf woff woff2 mp3 mp4 wav sqlite db bak mk cmake prisma sol toml`.split(/\s+/),
)

// files named by convention, no extension: a path when the case matches
export const SPECIAL_NAMES = new Set(['Makefile', 'Dockerfile', 'Justfile', 'Gemfile', 'Rakefile', 'Procfile', 'Containerfile', 'Vagrantfile'])

const isWord = (c: string) => /[A-Za-z0-9_]/.test(c)

export function isUrl(tok: string): boolean {
  return ['http://', 'https://', 'ssh://', 'git@', 'file://', 'www.'].some(p => tok.startsWith(p)) && tok.length > 8
}

export type PathMatch = {
  /** the path itself */
  path: string
  /** a trailing `:line` or `:line:col`, empty when absent */
  lineno: string
}

/** does `tok` look like a file path? */
export function pathLike(tok: string): PathMatch | null {
  let end = tok.length
  // peel up to two `:digits` suffixes
  for (let k = 0; k < 2; k++) {
    const colon = tok.lastIndexOf(':', end - 1)
    if (colon <= 0) break
    const tail = tok.slice(colon + 1, end)
    if (tail.length > 0 && /^\d+$/.test(tail)) end = colon
    else break
  }
  const p = tok.slice(0, end)
  if (p.length < 2 || p.includes('//')) return null
  // brackets inside a path segment are a router's (`app/[id]/page.tsx`,
  // `app/(auth)/layout.tsx`): allowed only balanced, so `foo(bar.js` stays prose
  if (![...p].every(c => isWord(c) || '/.-~@+[]()'.includes(c))) return null
  if (/[[\]()]/.test(p) && !(p.includes('/') && balanced(p, '[', ']') && balanced(p, '(', ')'))) return null
  const rooted = p.startsWith('/') || p.startsWith('./') || p.startsWith('../') || p.startsWith('~/')
  const last = p.split('/').pop() ?? p
  const dot = last.lastIndexOf('.')
  const extOk = dot > 0 && EXTENSIONS.has(last.slice(dot + 1).toLowerCase())
  const special = SPECIAL_NAMES.has(last)
  const dotfile = !p.includes('/') && p.startsWith('.') && /^[\w.-]+$/.test(p.slice(1)) && /[A-Za-z]/.test(p.slice(1))
  if (!(rooted || extOk || special || dotfile)) return null
  return { path: p, lineno: tok.slice(end) }
}

// as many openers as closers, every closer after its opener
function balanced(p: string, open: string, close: string): boolean {
  let depth = 0
  for (const c of p) {
    if (c === open) depth++
    else if (c === close && --depth < 0) return false
  }
  return depth === 0
}

/** strip the brackets and quotes a word in prose may carry: `(src/x.rs),` */
export function bareWord(tok: string): { lead: string; word: string; tail: string } {
  let a = 0
  let b = tok.length
  while (a < b && '([{"\'`<'.includes(tok[a]!)) a++
  while (a < b && ')]}"\'`>,.;:!?'.includes(tok[b - 1]!)) b--
  return { lead: tok.slice(0, a), word: tok.slice(a, b), tail: tok.slice(b) }
}
