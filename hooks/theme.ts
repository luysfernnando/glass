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
  base: 'dark'
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
  ['autoAccept', 'warn'],
  ['promptBorder', 'rule'],
  ['bashBorder', 'rule'],
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
  ['diffAddedWord', 'ok'],
  ['diffRemovedWord', 'err'],
]

const HEX = /^#[0-9a-f]{6}$/i

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
    const v = p[role]
    if (typeof v === 'string' && HEX.test(v)) overrides[slot] = v.toLowerCase()
  }
  return { name: `glass-${name}`, base: 'dark', overrides }
}

/** the theme as the file holds it: serialised, never templated */
export function themeJson(theme: ThemeFile): string {
  return JSON.stringify(theme, null, 2) + '\n'
}
