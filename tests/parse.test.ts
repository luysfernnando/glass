import { expect, test } from 'claude-code/testing'

import { G } from '../hooks/glyphs'
import { inlineText, parseMarkdown } from '../hooks/markdown'
import { paintLine } from '../hooks/output'
import { quoteRows } from '../hooks/render'
import { pathLike } from '../hooks/paths'
import { needsAttention, writeIntent } from '../hooks/prose'
import { proseSpans, shellSpans } from '../hooks/shell'
import { cellWidth } from '../hooks/width'
import { cleanHint } from '../hooks/chrome'

const cp = (n: number) => String.fromCodePoint(n)

test('cellWidth mirrors the engine ruler on the glyphs the mod draws', async () => {
  const cases: Array<[string, number]> = [
    ['cmd', 3],
    ['hooks/render.ts:88', 18],
    [cp(0x2705) + ' done', 7],
    [cp(0x274c) + ' fail', 7],
    [cp(0x4e2d) + cp(0x6587), 4],
    ['e' + cp(0x301), 1],
    [G.bullet + ' next', 6],
    [G.check + ' task', 6],
    [G.ring + ' sub', 5],
    [G.rule.repeat(5), 5],
    [G.bar + ' quote', 7],
    [G.capL + 'x' + G.capR, 3],
    [cp(0x1b) + '[38;2;1;2;3m' + 'ab' + cp(0x1b) + '[39m', 2],
  ]
  for (const [s, want] of cases) expect(cellWidth(s)).toBe(want)
})

test('every glyph survived into the module as one code point', async () => {
  for (const g of Object.values(G)) expect([...g].length).toBe(1)
})

test('a Bottom line card forms on its head line and keeps rows while streaming', async () => {
  const b = parseMarkdown('**Bottom line**\nVerified: x\nIss')[0]
  expect(b?.kind).toBe('callout')
  if (b?.kind !== 'callout') return
  expect(b.rows.map(r => r.label)).toEqual(['Verified', ''])
  expect(inlineText(b.rows[1]!.inlines)).toBe('Iss')
})

test('a title-only Bottom line takes the list under it as rows', async () => {
  const b = parseMarkdown('**Bottom line**\n\n- **Verified:** a\n- Issue: b\n- Fix: c')[0]
  expect(b?.kind).toBe('callout')
  if (b?.kind !== 'callout') return
  expect(b.rows.map(r => r.label)).toEqual(['Verified', 'Issue', 'Fix'])
})

test('tables start under a paragraph, keep raw text, and need matching cell counts', async () => {
  const blocks = parseMarkdown('intro\n| a | b |\n|---|---|\n| 1 | 2 |\n\nx | y\n---')
  expect(blocks.map(b => b.kind)).toEqual(['paragraph', 'table', 'paragraph', 'rule'])
  const table = blocks[1]
  if (table?.kind !== 'table') return
  expect(table.raw).toBe('| a | b |\n|---|---|\n| 1 | 2 |')
})

test('control characters and CRLF never reach the tree', async () => {
  const blocks = parseMarkdown('a\r\nb' + cp(0x07) + 'c')
  expect(blocks.map(b => (b.kind === 'paragraph' ? inlineText(b.inlines) : b.kind))).toEqual(['a\nbc'])
})

test('a fence info string with attributes still yields the language', async () => {
  const b = parseMarkdown('```ts title=x\ncode\n```')[0]
  expect(b?.kind).toBe('code')
  if (b?.kind === 'code') expect(b.lang).toBe('ts')
})

test('the shell tokenizer keeps command color across a newline after &&', async () => {
  const spans = shellSpans('git add .\n&& git commit -m "x"', true) ?? []
  const cmds = spans.filter(s => s.kind === 'cmd').map(s => s.text)
  expect(cmds).toEqual(['git', 'git'])
})

test('prose commands paint only with evidence, as claude-hl did', async () => {
  const paint = (s: string) => proseSpans(s).map(x => `${x.kind}:${s.slice(x.start, x.end)}`)
  expect(paint('then run git push --follow-tags to publish')).toEqual(['cmd:git', 'sub:push', 'flag:--follow-tags'])
  expect(paint('make sure the build passes')).toEqual([])
  expect(paint('go ahead and open it')).toEqual([])
  expect(paint('run git status in a sentence.')).toEqual([])
  expect(paint('Ran git status')).toEqual(['cmd:git', 'sub:status'])
  expect(paint('use cd ~/src and ls -la.')).toEqual(['cmd:cd', 'path:~/src', 'cmd:ls', 'flag:-la'])
  // English words that are also commands: a bare number is the sentence
  expect(paint('three agents that each sleep 5 seconds.')).toEqual([])
  expect(paint('3,336 total lines of code across 13 files.')).toEqual([])
  expect(paint('Ran sleep 5')).toEqual(['cmd:sleep', 'num:5'])
  expect(paint('then sleep 5 && echo one')).toEqual(['cmd:sleep', 'num:5', 'op:&&', 'cmd:echo'])
  expect(paint('open the file with code -r .')).toEqual(['cmd:code', 'flag:-r'])
})

test('paragraphs that need the reader are recognized', async () => {
  expect(needsAttention('Do you want me to keep the tests?')).toBe(true)
  expect(needsAttention('Run the migration before you deploy.')).toBe(true)
  expect(needsAttention('I did not verify the dark theme.')).toBe(true)
  expect(needsAttention('The parser handles tables and quotes.')).toBe(false)
  expect(writeIntent('can you draft an email to the team')).toBe(true)
  expect(writeIntent('fix the failing test')).toBe(false)
})

test('paths anywhere: rooted, known extension or dotfile, with a line suffix', async () => {
  expect(pathLike('src/main.rs:42:7')).toEqual({ path: 'src/main.rs', lineno: ':42:7' })
  expect(pathLike('README.md')).toEqual({ path: 'README.md', lineno: '' })
  expect(pathLike('.gitignore')).toEqual({ path: '.gitignore', lineno: '' })
  expect(pathLike('~/.config/app.toml')).toEqual({ path: '~/.config/app.toml', lineno: '' })
  expect(pathLike('and/or')).toBe(null)
  expect(pathLike('e.g.')).toBe(null)
})

test('tool output lines paint like claude-hl: git codes, commands, paths, numbers, status words', async () => {
  const colored = (line: string) => paintLine(line).filter(s => s.color).map(s => `${s.color}:${s.text}`)
  expect(colored('M hooks/render.ts')).toEqual(['warn:M', 'path:hooks/render.ts'])
  expect(colored('?? docs/demo.png')).toEqual(['comment:?', 'comment:?', 'path:docs/demo.png'])
  expect(colored('tmux new-session -s main')).toEqual(['cmd:tmux', 'sub:new-session', 'flag:-s', 'sub:main'])
  expect(colored('test result: ok. 12 passed; 0 failed; finished in 0.16s')).toEqual([
    'ok:ok', 'num:12', 'ok:passed', 'num:0', 'err:failed', 'num:0.16s',
  ])
  expect(colored('warning: unused at src/main.rs:120:9')).toEqual(['warn:warning', 'path:src/main.rs', 'num::120:9'])
})

test('a text-default symbol loses its emoji selector so widths agree', async () => {
  const warn = String.fromCodePoint(0x26a0) + String.fromCodePoint(0xfe0f)
  const check = String.fromCodePoint(0x2705)
  const b = parseMarkdown(`${warn} check and ${check} done`)[0]
  expect(b?.kind === 'paragraph' ? inlineText(b.inlines) : '').toBe(`${String.fromCodePoint(0x26a0)} check and ${check} done`)
})

test('the sandbox knows the local time zone for the footer clock', async () => {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone
  expect(typeof zone).toBe('string')
  expect(zone.length).toBeGreaterThan(0)
})

test('prose-like code is not painted as a command', async () => {
  expect(shellSpans('RenderElement')).toBe(null)
  expect(shellSpans('shell.ts')).toBe(null)
  expect(shellSpans('npm run dev')?.map(s => s.kind)).toEqual(['cmd', 'plain', 'sub', 'plain', 'sub'])
})

test('a quote bar covers every row: wrapped paragraph, blank, list items', async () => {
  const blocks = parseMarkdown('> one two three four five six\n>\n> - a\n> - b')
  expect(blocks[0]?.kind).toBe('quote')
  if (blocks[0]?.kind !== 'quote') return
  // inner measure 12: the paragraph wraps to 3 rows, a blank, two items
  expect(quoteRows(blocks[0].blocks, 14)).toBe(6)
  // wide enough: 1 row, a blank, two items
  expect(quoteRows(blocks[0].blocks, 80)).toBe(4)
})

test('a quote bar is as tall as each kind of fence draws', async () => {
  const bar = (lang: string, code: string[]) => {
    const blocks = parseMarkdown(['> ```' + lang, ...code.map(l => '> ' + l), '> ```'].join('\n'))
    if (blocks[0]?.kind !== 'quote') throw new Error('expected a quote')
    return quoteRows(blocks[0].blocks, 60)
  }
  const ten = Array.from({ length: 10 }, (_, i) => `const a${i} = ${i}`)
  const box = [cp(0x250c) + cp(0x2500).repeat(4) + cp(0x2510), cp(0x2502) + ' ab ' + cp(0x2502), cp(0x2514) + cp(0x2500).repeat(4) + cp(0x2518)]
  // short code: no header row
  expect(bar('ts', ['const a = 1', 'const b = 2'])).toBe(2)
  // long code: the header row, then a row per line
  expect(bar('ts', ten)).toBe(11)
  // a diagram: its rows, no header, even past 8 lines
  expect(bar('', [...box, ...box, ...box, ...box])).toBe(12)
  // a diagram wider than the card is cut, so still one row a line
  expect(bar('', [cp(0x250c) + cp(0x2500).repeat(90) + cp(0x2510), cp(0x2514) + cp(0x2500).repeat(90) + cp(0x2518)])).toBe(2)
  // a code line wider than the card wraps: 120 cells at 56 is 3 rows
  expect(bar('ts', ['x'.repeat(120), 'const b = 2'])).toBe(4)
  // an indent counts toward the wrap: 6 + 52 cells is past 56
  expect(bar('ts', [' '.repeat(6) + 'y'.repeat(52)])).toBe(2)
  // an empty fence still draws a row
  expect(bar('ts', [])).toBe(1)
})

test('mounted: the quote bar is one glyph column as tall as the quote', async $ => {
  const ui = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '> one two\n>\n> - a\n> - b', isFirstOfReply: true },
  })
  // a paragraph row, a blank, two list rows: four marks joined by newlines
  const bar = await ui.find({ type: 'Text', text: new RegExp(`^(${G.mark}\\n){3}${G.mark}$`) })
  expect(bar).toBeDefined()
  await ui.unmount()
})

test("an apostrophe inside a word is English, not a quote: diff card's stays prose", async () => {
  const painted = (l: string) => paintLine(l).filter(s => s.color && s.color !== 'num')
  expect(painted("0.3.9: the diff card's frame row by row, at the card's room")).toEqual([])
  expect(painted("0.3.8: the diff card's title; 0.3.7's border title")).toEqual([])
  expect(shellSpans("grep -n 'a b' x.ts")?.some(s => s.kind === 'str' && s.text === "'a b'")).toBe(true)
})

test('the hint line drops its key reminders and keeps the vim and permission modes', async () => {
  const left = String.fromCodePoint(0x2190)
  const mid = String.fromCodePoint(0xb7)
  const auto = String.fromCodePoint(0x23f5, 0x23f5) + ' auto mode on'
  expect(cleanHint(`-- INSERT -- ${auto} (shift+tab to cycle) ${mid} ${left} for agents`)).toEqual({ vim: '-- INSERT --', rest: auto })
  expect(cleanHint(`${auto} (shift+tab to cycle)`)).toEqual({ vim: '', rest: auto })
  // nothing to drop: the engine keeps its own line
  // live order: the mode first, the vim mode after a middot
  expect(cleanHint(`${auto} ${mid} -- INSERT --`)).toEqual({ vim: '-- INSERT --', rest: auto })
  expect(cleanHint(`${auto} (shift+tab to cycle) ${mid} -- INSERT -- ${mid} ${left} for agents`)).toEqual({ vim: '-- INSERT --', rest: auto })
  expect(cleanHint('? for shortcuts')).toBeNull()
  expect(cleanHint('esc to interrupt')).toBeNull()
})
