// 0.5.0: every palette has a theme, built from one fixed table; the forward
// slot names glass draws with are the engine's own.
import { expect, test } from 'claude-code/testing'

import { PALETTES } from '../hooks/palette'
import type { PaletteName } from '../hooks/palette'
import { THEME, lift, themeFileName, themeFor, themeJson, themeSetting } from '../hooks/theme'

const NAMES: PaletteName[] = ['tidepool', 'tarnish', 'overprint', 'ironbow', 'lagoon', 'iris', 'water', 'undertow', 'crimson', 'codex', 'rose']
const REQUIRED = [
  'success', 'error', 'warning', 'claude', 'permission', 'planMode', 'autoAccept',
  'promptBorder', 'bashBorder', 'secondaryBorder', 'secondaryText', 'inactive', 'subtle', 'suggestion',
  'userMessageBackground', 'bashMessageBackgroundColor', 'userMessageBackgroundHover', 'thinking',
  'diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed', 'diffAddedWord', 'diffRemovedWord',
]

test('every palette yields a theme: a dark base, every slot in the table, every value a six-digit hex', async () => {
  for (const name of NAMES) {
    const theme = themeFor(PALETTES[name], name)
    expect(theme.name).toBe(`glass-${name}`)
    expect(theme.base).toBe('dark')
    for (const slot of REQUIRED) expect(typeof theme.overrides[slot]).toBe('string')
    for (const v of Object.values(theme.overrides)) expect(/^#[0-9a-f]{6}$/.test(v)).toBe(true)
    // the slots glass reads forward resolve to the palette's own colors under its theme
    expect(theme.overrides.diffAdded).toBe(PALETTES[name].addBg.toLowerCase())
    expect(theme.overrides.diffRemoved).toBe(PALETTES[name].delBg.toLowerCase())
    // the word slots are the engine's word backgrounds: the row tint lifted, not a text color (0.5.3)
    expect(theme.overrides.diffAddedWord).toBe(lift(PALETTES[name].addBg).toLowerCase())
    expect(theme.overrides.diffRemovedWord).toBe(lift(PALETTES[name].delBg).toLowerCase())
    expect(theme.overrides.success).toBe(PALETTES[name].ok.toLowerCase())
    expect(theme.overrides.error).toBe(PALETTES[name].err.toLowerCase())
    // the engine's own autoAccept is a green, so it takes `ok`, apart from `warning`
    expect(theme.overrides.autoAccept).toBe(PALETTES[name].ok.toLowerCase())
    expect(theme.overrides.autoAccept).not.toBe(theme.overrides.warning)
    expect(theme.overrides.warning).toBe(PALETTES[name].warn.toLowerCase())
    expect(theme.overrides.permission).toBe(PALETTES[name].tool.toLowerCase())
    // 0.10.1: the prompt border is the person's color, bash mode the verb's, never the grey rule
    expect(theme.overrides.promptBorder).toBe(PALETTES[name].accentUser.toLowerCase())
    expect(theme.overrides.bashBorder).toBe(PALETTES[name].cmd.toLowerCase())
    expect(theme.overrides.promptBorder).not.toBe(PALETTES[name].rule.toLowerCase())
  }
})

test('the file and setting names, and the JSON round-trips', async () => {
  expect(themeFileName('water')).toBe('glass-water.json')
  expect(themeSetting('water')).toBe('custom:glass-water')
  const theme = themeFor(PALETTES.tidepool, 'tidepool')
  const text = themeJson(theme)
  expect(text.endsWith('\n')).toBe(true)
  expect(JSON.parse(text)).toEqual(theme)
})

test('the forward slot names are the engine keys, spelled exactly', async () => {
  expect(THEME).toEqual({
    success: 'success',
    error: 'error',
    planMode: 'planMode',
    autoAccept: 'autoAccept',
    warning: 'warning',
    diffAdded: 'diffAdded',
    diffRemoved: 'diffRemoved',
    diffAddedWord: 'diffAddedWord',
    diffRemovedWord: 'diffRemovedWord',
  })
})
