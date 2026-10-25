// The engine's theme and glass, both ways (0.5.0).
//
// Forward: where glass mirrors an engine panel it names the theme's own
// slot, not a hex, so the drawing follows whatever theme is active: the
// diff card's tints and marks, the hint line's mode word. THEME holds the
// slot names a Text or Box color may carry.
//
// Reverse: every palette has a theme. `themeFor` maps a palette's roles onto
// the engine's slots by one fixed table, and `/glass-theme` writes the result
// to ~/.claude/themes/glass-<palette>.json. Under a glass theme the forward
// slots resolve to the palette's own colors, so the two directions agree.
import type { Palette, PaletteName } from './palette'

/** the theme slots glass reads, by the names the engine resolves */
export const THEME = {
  success: 'success',
  error: 'error',
  planMode: 'planMode',
  autoAccept: 'autoAccept',
  warning: 'warning',
  diffAdded: 'diffAdded',
  diffRemoved: 'diffRemoved',
  diffAddedWord: 'diffAddedWord',
  diffRemovedWord: 'diffRemovedWord',
} as const

/** a custom theme as ~/.claude/themes/<name>.json holds it */
export type ThemeFile = {
  name: string
  base: 'dark' | 'light'
  overrides: Record<string, string>
}

// slot -> palette role; a role the palette leaves empty leaves the slot out
const SLOTS: ReadonlyArray<[slot: string, role: keyof Palette]> = [
  ['success', 'ok'],
  ['error', 'err'],
  ['warning', 'warn'],
  ['claude', 'accent'],
  ['permission', 'tool'],
  ['planMode', 'cmd'],
  ['autoAccept', 'ok'], // the engine's own autoAccept is a green (0.5.3; `warn` made it one color with `warning`)
  // the prompt box is the person's: it takes their color, as the user row
  // does (0.10.1; `rule` is a grey step in water, codex and rose, so the
  // border looked uncolored); bash mode takes the verb's. A palette may set
  // its own `promptBorder` (0.14.0: prism's box takes the band's purple)
  ['promptBorder', 'promptBorder'],
  ['bashBorder', 'cmd'],
  ['secondaryBorder', 'rule'],
  // no `text` row: prose is the terminal's own foreground in every palette
  ['secondaryText', 'meta'],
  ['inactive', 'faint'],
  ['subtle', 'faint'],
  ['suggestion', 'url'],
  ['userMessageBackground', 'blockBg'],
  ['bashMessageBackgroundColor', 'blockBg'],
  ['userMessageBackgroundHover', 'rowHover'],
  ['thinking', 'private'],
  ['diffAdded', 'addBg'],
  ['diffRemoved', 'delBg'],
  ['diffAddedDimmed', 'addBg'],
  ['diffRemovedDimmed', 'delBg'],
]

// the engine paints diff*Word as the background behind a changed word, a
// step brighter than the row tint; a text color there was a bright block
// behind the text (0.5.3). Lifted from the row tint toward white; on a
// light palette, deepened toward black (0.16.0)
const LIFT = 0.18
const DEEPEN = 0.1
const WORD_SLOTS: ReadonlyArray<[slot: string, role: keyof Palette]> = [
  ['diffAddedWord', 'addBg'],
  ['diffRemovedWord', 'delBg'],
]
export function lift(hex: string, k = LIFT): string {
  const ch = (i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  return '#' + [0, 1, 2].map(i => Math.round(ch(i) + (255 - ch(i)) * k).toString(16).padStart(2, '0')).join('')
}
export function deepen(hex: string, k = DEEPEN): string {
  const ch = (i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  return '#' + [0, 1, 2].map(i => Math.round(ch(i) * (1 - k)).toString(16).padStart(2, '0')).join('')
}

/** a palette's word tint: a step from its row tint, away from the ground */
export function wordTint(p: Palette, hex: string): string {
  return p.ground === 'light' ? deepen(hex) : lift(hex)
}

const HEX = /^#[0-9a-f]{6}$/i

// an optional role and the role that stands in when a palette leaves it out
const FALLBACK: Partial<Record<keyof Palette, keyof Palette>> = { promptBorder: 'accentUser' }

/** the file name a palette's theme is written under, inside ~/.claude/themes */
export function themeFileName(name: PaletteName): string {
  return `glass-${name}.json`
}

/** the `theme` setting that selects a palette's theme */
export function themeSetting(name: PaletteName): string {
  return `custom:glass-${name}`
}

/** a palette's theme: every slot in the table whose role holds a hex color */
export function themeFor(p: Palette, name: PaletteName): ThemeFile {
  const overrides: Record<string, string> = {}
  for (const [slot, role] of SLOTS) {
    const stand = FALLBACK[role]
    const v = p[role] ?? (stand ? p[stand] : undefined)
    if (typeof v === 'string' && HEX.test(v)) overrides[slot] = v.toLowerCase()
  }
  for (const [slot, role] of WORD_SLOTS) {
    const v = p[role]
    if (typeof v === 'string' && HEX.test(v)) overrides[slot] = wordTint(p, v).toLowerCase()
  }
  return { name: `glass-${name}`, base: p.ground ?? 'dark', overrides }
}

/** the theme as the file holds it: serialised, never templated */
export function themeJson(theme: ThemeFile): string {
  return JSON.stringify(theme, null, 2) + '\n'
}
