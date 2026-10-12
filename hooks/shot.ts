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
  for (const b of blocks) {
    if (b.type !== 'text' || typeof b.text !== 'string') continue
    // `[Image: source: <path>.png, original 2400x1658, displayed at ...]`
    const m = /\[Image: source: (\/[^\]\n]+?\.png)(?=[,\]])/.exec(b.text)
    if (m) return m[1]!
  }
  return null
}

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

