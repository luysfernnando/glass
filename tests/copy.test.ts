// The copy formats: Markdown stays the source, HTML and plain text come from
// the parsed blocks; the clipboard helpers per platform.
import { expect, test } from 'claude-code/testing'

import { clipboardCommands } from '../hooks/clipboard'
import { blocksHtml, blocksText, escapeHtml } from '../hooks/html'
import { parseMarkdown } from '../hooks/markdown'

const md = '# Title\n\nSome **bold** and `code` <tag>.\n\n- one\n- two\n\n```sh\nls -la\n```'

test('html: headings, inline marks, escaping, lists and a fence with its language', () => {
  const html = blocksHtml(parseMarkdown(md))
  expect(html).toContain('<h1>Title</h1>')
  expect(html).toContain('<strong>bold</strong>')
  expect(html).toContain('<code>code</code>')
  expect(html).toContain('&lt;tag&gt;')
  expect(html).toContain('<ul>')
  expect(html).toContain('<pre><code class="language-sh">ls -la</code></pre>')
  expect(escapeHtml('a & "b"')).toBe('a &amp; &quot;b&quot;')
})

test('plain text: no markup, blocks apart by a blank line, a fence as its code', () => {
  const text = blocksText(parseMarkdown(md))
  expect(text).toContain('Title\n\nSome bold and code <tag>.')
  expect(text).not.toContain('**')
  expect(text).not.toContain('```')
  expect(text).toContain('ls -la')
})

test('html: a table keeps head and body', () => {
  const html = blocksHtml(parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'))
  expect(html).toContain('<th>a</th>')
  expect(html).toContain('<td>2</td>')
})

test('clipboard helpers: Linux tries CopyQ then wl-copy or xclip, macOS and Windows one script each', () => {
  const x = clipboardCommands('linux', '<b>x</b>', 'x')
  expect(x.map(c => c.argv[0])).toEqual(['copyq', 'xclip'])
  expect(clipboardCommands('linux', '<b>x</b>', 'x', { wayland: true }).map(c => c.argv[0])).toEqual(['copyq', 'wl-copy'])
  expect(JSON.parse(x[0]!.stdin)).toEqual({ html: '<b>x</b>', text: 'x' })
  expect(x[1]!.stdin).toBe('<b>x</b>')
  const mac = clipboardCommands('macos', 'h', 't')
  expect(mac).toHaveLength(1)
  expect(mac[0]!.argv[0]).toBe('/usr/bin/osascript')
  const win = clipboardCommands('windows', 'h\u00e9', 'a\nb', { systemRoot: 'C:\\Windows' })
  expect(win[0]!.argv[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  // ASCII-only stdin, CRLF text
  expect(/^[\x20-\x7e]*$/.test(win[0]!.stdin)).toBe(true)
  expect(win[0]!.stdin).toContain('\\u00e9')
  expect(win[0]!.stdin).toContain('a\\r\\nb')
})
