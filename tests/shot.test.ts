// 0.6.0: an MCP screenshot draws under its row, the picture Claude read.
import { expect, test } from 'claude-code/testing'

import { CONVERTIBLE, lastPictureRead, namedIn, pictureOf, pngSize, shotBox, shotFromPng, shotOf } from '../hooks/shot'

// a PNG header for a picture `w` by `h`: the signature, then IHDR
function pngHeader(w: number, h: number): string {
  const b = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]
  for (const n of [w, h]) b.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
  // bit depth, colour type, three flags, and a CRC byte: 30 bytes, no base64 padding
  b.push(8, 6, 0, 0, 0, 0)
  return btoa(String.fromCharCode(...b))
}
// a whole 1x1 PNG, for trees the validator reads
const ONE_PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const STORED = '/Users/someone/.claude/projects/p/s/tool-results/mcp-chrome-devtools-blob-1-abc.png'

// the result as the engine handed it over live (probe, 2026-10-12)
const engineResult = (data: string, mime = 'image/png', stored: string | null = STORED) => [
  { type: 'text', text: "Took a screenshot of the current page's viewport." },
  { type: 'image', source: { type: 'base64', media_type: mime, data } },
  ...(stored ? [{ type: 'text', text: `[Image: source: ${stored}, original 2400x1658, displayed at 2000x1382. Multiply coordinates by 1.20 to map to original image.]` }] : []),
]

test('the size comes from the PNG header', () => {
  expect(pngSize(pngHeader(2000, 1382))).toEqual({ width: 2000, height: 1382 })
  expect(pngSize(ONE_PX)).toEqual({ width: 1, height: 1 })
  expect(pngSize(btoa('not a png at all, just some text here'))).toBe(null)
  expect(pngSize('***')).toBe(null)
})

test('the bytes are drawn, even when the engine names a stored copy', () => {
  const head = pngHeader(2000, 1382)
  expect(shotOf(engineResult(head))).toEqual({ source: { png: head }, width: 2000, height: 1382 })
  expect(shotOf(engineResult(ONE_PX, 'image/png', null))).toEqual({ source: { png: ONE_PX }, width: 1, height: 1 })
  // MCP's own block shape, under `content`
  expect(shotOf({ content: [{ type: 'image', data: ONE_PX, mimeType: 'image/png' }] })).toEqual({ source: { png: ONE_PX }, width: 1, height: 1 })
})

test('no picture, a JPEG, or too many bytes stays the engine\'s', () => {
  expect(shotOf(engineResult(pngHeader(10, 10), 'image/jpeg'))).toBe(null)
  expect(shotOf([{ type: 'text', text: 'Navigated to https://example.com' }])).toBe(null)
  expect(shotOf('a string')).toBe(null)
  expect(shotOf(undefined)).toBe(null)
  expect(shotOf(engineResult(pngHeader(10, 10) + 'A'.repeat(3_000_000), 'image/png', null))).toBe(null)
})

test('past 2 MiB of bytes the stored copy is drawn instead', () => {
  const big = pngHeader(2000, 9000) + 'A'.repeat(3_000_000)
  expect(shotOf(engineResult(big))).toEqual({ source: { file: STORED, format: 'png' }, width: 2000, height: 9000 })
})

test('the box keeps the aspect and stays inside its caps', () => {
  // a wide page: width-bound
  expect(shotBox(2000, 1000, 100, 40)).toEqual({ columns: 100, rows: 25 })
  // a tall page: height-bound, narrower
  expect(shotBox(1000, 4000, 100, 24)).toEqual({ columns: 12, rows: 24 })
})

// the trees go through the engine's validator: a refused tree would fall
// back to the engine's own drawing in a session
test('mounted: a screenshot result draws an Image on the trunk', async ($, on) => {
  // the engine's own body, beneath glass
  on('ui.render', { component: 'ToolResult' }, (engine, e) => engine.ui.resolve(e).Text({ children: ['engine body'] }) as never)
  const row = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_s1', tool: 'mcp__plugin_jev-reach_chrome-devtools__take_screenshot', isErrored: false, output: engineResult(ONE_PX, 'image/png', null) },
  })
  expect(await row.find({ type: 'Image' })).toBeDefined()
  await row.unmount()

  // a text-only MCP result keeps the engine's body
  const plain = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_s2', tool: 'mcp__plugin_jev-reach_chrome-devtools__navigate_page', isErrored: false, output: [{ type: 'text', text: 'Navigated.' }] },
  })
  expect(await plain.find({ type: 'Image' })).toBeUndefined()
  expect(await plain.find({ type: 'Text', text: /engine body/ })).toBeDefined()
  await plain.unmount()
})

test('screenshots off: the result keeps the engine body, the group stays folded', { options: { screenshots: false } }, async ($, on) => {
  on('ui.render', { component: 'ToolResult' }, (engine, e) => engine.ui.resolve(e).Text({ children: ['engine body'] }) as never)
  on('ui.render', { component: 'ToolGroup' }, (engine, e) => engine.ui.resolve(e).Text({ children: [e.props.isExpanded ? 'opened' : 'folded'] }) as never)
  const output = engineResult(ONE_PX, 'image/png', null)
  const row = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_o1', tool: 'mcp__plugin_jev-reach_chrome-devtools__take_screenshot', isErrored: false, output },
  })
  expect(await row.find({ type: 'Image' })).toBeUndefined()
  expect(await row.find({ type: 'Text', text: /engine body/ })).toBeDefined()
  await row.unmount()
  const group = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolGroup',
    props: {
      calls: [{ tool_use_id: 'toolu_o2', tool: 'mcp__plugin_jev-reach_chrome-devtools__take_screenshot', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output }],
      isActive: false,
      isExpanded: false,
    },
  })
  // glass draws its own folded row: the engine's beneath is never asked to open
  expect(await group.find({ type: 'Text', text: /opened/ })).toBeUndefined()
  await group.unmount()
})

test('mounted: a group with a screenshot opens, and the row draws the picture', async ($, on) => {
  // the engine's group, beneath glass: it says whether glass opened it
  on('ui.render', { component: 'ToolGroup' }, (engine, e) => engine.ui.resolve(e).Text({ children: [e.props.isExpanded ? 'opened' : 'folded'] }) as never)
  const shot = { tool_use_id: 'toolu_g2', tool: 'mcp__plugin_jev-reach_chrome-devtools__take_screenshot', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: engineResult(ONE_PX, 'image/png', null) }
  const group = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolGroup',
    props: {
      calls: [
        { tool_use_id: 'toolu_g1', tool: 'mcp__plugin_jev-reach_chrome-devtools__new_page', input: { url: 'https://example.com' }, isRunning: false, isErrored: false, isInterrupted: false, output: [{ type: 'text', text: 'ok' }] },
        shot,
      ],
      isActive: false,
      isExpanded: false,
    },
  })
  expect(await group.find({ type: 'Text', text: /opened/ })).toBeDefined()
  await group.unmount()
  const row = await $.ui.mount({ plugin: 'glass', surface: 'terminal', component: 'ToolUse', props: shot })
  expect(await row.find({ type: 'Image' })).toBeDefined()
  await row.unmount()
})


// ---- 0.8.0: any picture Claude looked at ------------------------------------
const readCall = (id: string, path: string, data = ONE_PX, mime = 'image/png') => ({
  tool_use_id: id, tool: 'Read', input: { file_path: path }, isRunning: false, isErrored: false, isInterrupted: false,
  output: { type: 'image', file: { base64: data, type: mime, originalSize: 70 } },
})

test('a picture from a Read, or an MCP block in any format, with its copy on disk', () => {
  expect(pictureOf({ type: 'image', file: { base64: ONE_PX, type: 'image/png' } }, '/p/a.png')).toEqual({ mime: 'image/png', data: ONE_PX, file: '/p/a.png' })
  const jpeg = [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } },
    { type: 'text', text: '[Image: source: /t/shot.jpg, original 2400x1658, displayed at 2000x1382.]' },
  ]
  expect(pictureOf(jpeg)).toEqual({ mime: 'image/jpeg', data: '/9j/4AAQ', file: '/t/shot.jpg' })
  expect(pictureOf({ type: 'text', file: { content: 'x' } })).toBe(null)
  expect(pictureOf([{ type: 'text', text: 'Navigated.' }])).toBe(null)
  expect(CONVERTIBLE.test('image/jpeg') && CONVERTIBLE.test('image/webp') && !CONVERTIBLE.test('image/svg+xml')).toBe(true)
})

test('a PNG draws as bytes; not a PNG, or over 2 MiB, does not', () => {
  expect(shotFromPng(ONE_PX)).toEqual({ source: { png: ONE_PX }, width: 1, height: 1 })
  expect(shotFromPng('/9j/4AAQSkZJRgABAQAAAQABAAD')).toBe(null)
  expect(shotFromPng(pngHeader(10, 10) + 'A'.repeat(3_000_000))).toBe(null)
})

test('a file the person named in a prompt, as written or under ~, is theirs', () => {
  const prompts = ['look at /Users/me/Desktop/Screenshot 1.png please', 'and ~/shots/b.png']
  expect(namedIn(prompts, '/Users/me/Desktop/Screenshot 1.png', '/Users/me')).toBe(true)
  expect(namedIn(prompts, '/Users/me/shots/b.png', '/Users/me')).toBe(true)
  expect(namedIn(prompts, '/tmp/qa/after.png', '/Users/me')).toBe(false)
  expect(namedIn(prompts, '', '/Users/me')).toBe(false)
})

test('a group draws one Read picture: the last the person did not name', () => {
  const calls = [readCall('r1', '/tmp/a.png'), readCall('r2', '/tmp/b.png'), { tool_use_id: 'g1', tool: 'Grep', input: {}, isRunning: false, isErrored: false, output: {} }]
  expect(lastPictureRead(calls, () => false)).toBe('r2')
  expect(lastPictureRead(calls, p => p === '/tmp/b.png')).toBe('r1')
  expect(lastPictureRead([{ ...readCall('r3', '/tmp/c.png'), isRunning: true }], () => false)).toBe(null)
  expect(lastPictureRead([{ tool_use_id: 'r4', tool: 'Read', input: { file_path: '/a.ts' }, output: { type: 'text', file: {} } }], () => false)).toBe(null)
})

test('mounted: two image reads in a folded group draw exactly one Image', async ($, on) => {
  on('ui.render', { component: 'ToolGroup' }, (engine, e) => engine.ui.resolve(e).Text({ children: [e.props.isExpanded ? 'opened' : 'folded'] }) as never)
  const group = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [readCall('m1', '/tmp/a.png'), readCall('m2', '/tmp/b.png')], isActive: false, isExpanded: false },
  })
  expect(await group.findAll({ type: 'Image' })).toHaveLength(1)
  expect(await group.find({ type: 'Text', text: /opened/ })).toBeUndefined()
  await group.unmount()
})

test('mounted: screenshots off, a folded run of image reads draws none', { options: { screenshots: false } }, async $ => {
  const group = await $.ui.mount({
    plugin: 'glass',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [readCall('n1', '/tmp/a.png')], isActive: false, isExpanded: false },
  })
  expect(await group.findAll({ type: 'Image' })).toHaveLength(0)
  await group.unmount()
})
