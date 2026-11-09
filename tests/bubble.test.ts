import { expect, mock, test } from 'claude-code/testing'

// the world beneath glass: a turn whose steps stream the given chunks
type Chunk = { kind: 'tool'; id: string; name: string } | { kind: 'text'; text: string }
async function runTurn($: any, turnId: string) {
  await $.turn.start({ text: 'go', turnId })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'm' })) void _
}
const tool = (id: string) => ({
  plugin: 'glass',
  surface: 'terminal',
  component: 'ToolUse',
  props: { tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: { stdout: 'a\n', stderr: '' } },
}) as never
const reply = (text: string) => ({ plugin: 'glass', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } }) as never

test('live: a call with no reply yet draws its activity line in a Claude bubble', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const chunks: Chunk[] = [{ kind: 'tool', id: 'a1', name: 'Bash' }]
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    let index = 0
    for (const c of chunks) yield { ...c, index: index++ } as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  await runTurn($, 'T1')
  const row = await $.ui.mount(tool('a1'))
  expect(await row.find({ type: 'Text', text: /Claude/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /Bash/ })).toBeDefined()
  await row.unmount()
})

test('done: the line moves under the reply, its head row draws nothing', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const chunks: Chunk[] = [{ kind: 'tool', id: 'b1', name: 'Bash' }, { kind: 'text', text: 'Listed the folder for you.' }]
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    let index = 0
    for (const c of chunks) yield { ...c, index: index++ } as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  await runTurn($, 'T2')
  const head = await $.ui.mount(tool('b1'))
  expect(await head.find({ type: 'Text', text: /Bash/ })).toBeUndefined()
  expect(await head.find({ type: 'Text', text: /Claude/ })).toBeUndefined()
  await head.unmount()
  const msg = await $.ui.mount(reply('Listed the folder for you.'))
  expect(await msg.find({ type: 'Text', text: /Listed the folder/ })).toBeDefined()
  expect(await msg.find({ type: 'Text', text: /Bash/ })).toBeDefined()
  await msg.unmount()
})

test('several segments: one line per reply bubble, no orphan rows', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const chunks: Chunk[] = [
    { kind: 'tool', id: 'c1', name: 'Bash' },
    { kind: 'text', text: 'First finding.' },
    { kind: 'tool', id: 'c2', name: 'Bash' },
    { kind: 'text', text: 'Second finding.' },
  ]
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    let index = 0
    for (const c of chunks) yield { ...c, index: index++ } as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  await runTurn($, 'T3')
  for (const id of ['c1', 'c2']) {
    const r = await $.ui.mount(tool(id))
    expect(await r.find({ type: 'Text', text: /Bash/ })).toBeUndefined()
    await r.unmount()
  }
  for (const text of ['First finding.', 'Second finding.']) {
    const m = await $.ui.mount(reply(text))
    expect(await m.find({ type: 'Text', text: /Bash/ })).toBeDefined()
    await m.unmount()
  }
})

test('a reply with no calls before it draws no activity line', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const chunks: Chunk[] = [{ kind: 'text', text: 'Just words, no tools.' }]
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    let index = 0
    for (const c of chunks) yield { ...c, index: index++ } as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  await runTurn($, 'T4')
  const m = await $.ui.mount(reply('Just words, no tools.'))
  expect(await m.find({ type: 'Text', text: /Bash/ })).toBeUndefined()
  await m.unmount()
})
