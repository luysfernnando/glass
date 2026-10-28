// Screenshots an MCP tool returned (chrome-devtools take_screenshot, a
// Figma screenshot): the picture Claude read, drawn under the call's row so
// the person sees what Claude saw (0.6.0).
//
// The engine hands the result over as the model read it: content blocks,
// the picture an `image` block of base64 PNG, and a text block
// `[Image: source: <path>, ...]` naming the copy it stored under the
// session's tool-results. Proved live 2026-10-12 with a probe mod.

export type Shot = {
  // what the Image draws: the bytes, else the stored file when they are too
  // many. A file source draws its alt where the engine does not know the
  // terminal reads this machine's files; one drew its alt in Ghostty under
  // tmux (live, 2026-10-12). Bytes need no such answer.
  source: { file: string; format: 'png' } | { png: string }
  width: number
  height: number
}

// the most an Image takes as bytes: 2 MiB decoded
const PNG_BASE64_MAX = Math.floor((2 * 1024 * 1024 * 4) / 3)

// A PNG's size from its header (bytes 16 to 24), read from the base64.
export function pngSize(base64: string): { width: number; height: number } | null {
  let bin: string
  try {
    bin = atob(base64.slice(0, 44))
  } catch {
    return null
  }
  if (bin.length < 24 || bin.charCodeAt(0) !== 0x89 || bin.slice(1, 4) !== 'PNG') return null
  const at = (i: number) => ((bin.charCodeAt(i) << 24) | (bin.charCodeAt(i + 1) << 16) | (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3)) >>> 0
  const width = at(16)
  const height = at(20)
  return width > 0 && height > 0 ? { width, height } : null
}

type Block = { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown; source?: { type?: unknown; data?: unknown; media_type?: unknown } }

function blocksOf(output: unknown): Block[] {
  if (Array.isArray(output)) return output.filter((b): b is Block => !!b && typeof b === 'object')
  const content = (output as { content?: unknown } | null | undefined)?.content
  return Array.isArray(content) ? blocksOf(content) : []
}

// The first PNG an MCP result carries, or null. JPEG and WebP stay the
// engine's: the Image element takes PNG or raw pixels only.
export function shotOf(output: unknown): Shot | null {
  const blocks = blocksOf(output)
  for (const b of blocks) {
    if (b.type !== 'image') continue
    // the engine's shape (`source.data`), or MCP's own (`data`, `mimeType`)
    const data = typeof b.source?.data === 'string' ? b.source.data : typeof b.data === 'string' ? b.data : ''
    const mime = typeof b.source?.media_type === 'string' ? b.source.media_type : typeof b.mimeType === 'string' ? b.mimeType : ''
    if (data === '' || mime !== 'image/png') continue
    const size = pngSize(data)
    if (!size) continue
    if (data.length <= PNG_BASE64_MAX) return { source: { png: data }, ...size }
    const file = storedPng(blocks)
    return file ? { source: { file, format: 'png' }, ...size } : null
  }
  return null
}

// The stored copy the engine names in a text block, when it is a PNG.
function storedPng(blocks: Block[]): string | null {
  const file = storedCopy(blocks)
  return file && /\.png$/i.test(file) ? file : null
}

// The stored copy the engine names in a text block, any format:
// `[Image: source: <path>, original 2400x1658, displayed at ...]`.
function storedCopy(blocks: Block[]): string | null {
  for (const b of blocks) {
    if (b.type !== 'text' || typeof b.text !== 'string') continue
    const m = /\[Image: source: (\/[^\]\n]+?\.(?:png|jpe?g|webp|gif))(?=[,\]])/i.exec(b.text)
    if (m) return m[1]!
  }
  return null
}

// ---- any picture Claude looked at (0.8.0) -------------------------------
// An MCP result's image block or a Read of an image file, in any format the
// model reads: PNG draws as it is, the rest is converted to PNG first
// (register.ts, macOS `sips`), from `file` when a copy is on disk.
export type Picture = { mime: string; data: string; file: string | null }
export const CONVERTIBLE = /^image\/(png|jpeg|webp|gif)$/

export function pictureOf(output: unknown, path?: string): Picture | null {
  // Read: `{ type: 'image', file: { base64, type } }`
  const read = output as { type?: unknown; file?: { base64?: unknown; type?: unknown } } | null | undefined
  if (read && typeof read === 'object' && !Array.isArray(read) && read.type === 'image') {
    const data = read.file?.base64, mime = read.file?.type
    return typeof data === 'string' && data !== '' && typeof mime === 'string' ? { mime, data, file: path ?? null } : null
  }
  const blocks = blocksOf(output)
  for (const b of blocks) {
    if (b.type !== 'image') continue
    const data = typeof b.source?.data === 'string' ? b.source.data : typeof b.data === 'string' ? b.data : ''
    const mime = typeof b.source?.media_type === 'string' ? b.source.media_type : typeof b.mimeType === 'string' ? b.mimeType : ''
    if (data !== '' && mime.startsWith('image/')) return { mime, data, file: storedCopy(blocks) }
  }
  return null
}

// A PNG's bytes as the Image takes them, or null: not a PNG, or over 2 MiB.
export function shotFromPng(data: string): Shot | null {
  const size = pngSize(data)
  return size && data.length <= PNG_BASE64_MAX ? { source: { png: data }, ...size } : null
}

// A short stable name for a picture's converted copy.
export function hashOf(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return h.toString(16).padStart(8, '0') + text.length.toString(16)
}

// Whether the person named this file in one of their own prompts: a picture
// they fed Claude is never drawn back (owner's rule, 2026-10-12). Claude
// reads the real, full path, which is rarely what the person typed (live,
// 2026-10-28: `/tmp/x.png` read as `/private/tmp/x.png`, `x.png in this
// folder` read with its folder), so any of these counts: the path, the same
// under `~`, the other side of macOS's `/private` links (`/tmp`, `/var`,
// `/etc`), or the file's name on its own (a word of the prompt: `a.png`
// names `/p/a.png`, not `/p/data.png`). A name another file shares keeps
// that one back too, which only keeps a picture back.
export function namedIn(prompts: readonly string[], path: string, home: string): boolean {
  if (path === '') return false
  const forms = new Set([path])
  const alias = /^\/private\/(tmp|var|etc)\//.test(path) ? path.slice('/private'.length) : /^\/(tmp|var|etc)\//.test(path) ? '/private' + path : null
  if (alias) forms.add(alias)
  for (const f of [...forms]) if (home !== '' && f.startsWith(home + '/')) forms.add('~' + f.slice(home.length))
  const name = path.slice(path.lastIndexOf('/') + 1)
  const word = name === '' ? null : new RegExp(`(^|[\\s'"\`(\\[<{/:=])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s'"\`)\\]>},;:!?]|\\.(?!\\w))`)
  return prompts.some(t => [...forms].some(f => t.includes(f)) || (word !== null && word.test(t)))
}

type Call = { tool_use_id?: string; tool: string; input?: unknown; output?: unknown; isRunning?: boolean; isErrored?: boolean }
export const readPath = (input: unknown) => {
  const p = (input as { file_path?: unknown } | null | undefined)?.file_path
  return typeof p === 'string' ? p : ''
}

// The Reads in a group whose picture may draw, newest first: each returned
// an image the person did not name. The group draws the first of them that
// can draw (a JPEG with no sips cannot), one picture, not one each; /expand
// draws them all.
export function pictureReadOrder(calls: readonly Call[], named: (path: string) => boolean): string[] {
  const order: string[] = []
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]!
    if (c.tool !== 'Read' || c.isRunning || c.isErrored || typeof c.tool_use_id !== 'string') continue
    if (pictureOf(c.output) !== null && !named(readPath(c.input))) order.push(c.tool_use_id)
  }
  return order
}
export const lastPictureRead = (calls: readonly Call[], named: (path: string) => boolean): string | null => pictureReadOrder(calls, named)[0] ?? null

// The picture's box in cells, aspect kept: a cell is about twice as tall
// as it is wide. Never wider than `maxCols`, never taller than `maxRows`.
export function shotBox(width: number, height: number, maxCols: number, maxRows: number): { columns: number; rows: number } {
  let columns = Math.max(1, Math.min(255, maxCols))
  let rows = Math.ceil((columns * height) / width / 2)
  if (rows > maxRows) {
    rows = Math.max(1, maxRows)
    columns = Math.max(1, Math.ceil((rows * 2 * width) / height))
  }
  return { columns: Math.min(255, columns), rows: Math.max(1, Math.min(255, rows)) }
}

