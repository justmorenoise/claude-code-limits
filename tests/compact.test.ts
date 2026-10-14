import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { STRINGS } from '../hooks/strings'

const NOW = Date.parse('2026-10-14T10:00:00.000Z')
const SURFACES = ['terminal', 'desktop'] as const
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} }

const SUMMARY = [{ role: 'user' as const, text: 'Summary of the conversation so far', toolUses: [] }]
type Compacted = { messages: typeof SUMMARY } | { skip: string }

/** A session past 250k tokens, so the band offers Compact now; `compact` answers each session.compact. */
async function fakeSession($: Engine, on: On, compact: () => Promise<Compacted>) {
  const toasts: string[] = []
  let compactions = 0
  on('store.get', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1_000_000, percent: 27 }, rateLimits: [] } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => e)
  on('session.measure', (_, e) => e)
  on('session.compact', async () => {
    compactions++
    return compact()
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.measure({ context: { window: 1_000_000, percent: 27, tokens: 268_000 }, rateLimits: [], changed: ['context'] })
  return { toasts, compactions: () => compactions }
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => (resolve = r))
  return { promise, resolve }
}

for (const surface of SURFACES) {
  test(`${surface}: Compact now shows the compaction at once and brings the button back when it ends`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const done = deferred<Compacted>()
    const { toasts, compactions } = await fakeSession($, on, () => done.promise)
    const ui = await $.ui.mount({ plugin: 'limits', surface, component: 'AbovePrompt', props: PROPS })

    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await ui.press({ key: 'compact' })
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
    expect(await ui.find({ text: STRINGS.compacting })).toBeDefined()

    await clock.advance(0)
    expect(compactions()).toBe(1)

    done.resolve({ messages: SUMMARY })
    await clock.advance(0)
    expect(toasts).toContain(STRINGS.compacted)
    expect(await ui.find({ key: 'compact' })).toBeDefined()
  })
}

test('a second press while the first is compacting says so and starts nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const done = deferred<Compacted>()
  const { toasts, compactions } = await fakeSession($, on, () => done.promise)
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  await Promise.all([ui.press({ key: 'compact' }), ui.press({ key: 'compact' })])
  await clock.advance(0)
  expect(compactions()).toBe(1)
  expect(toasts).toContain(STRINGS.compactRunning)

  done.resolve({ messages: SUMMARY })
  await clock.advance(0)
  expect(toasts.filter(t => t === STRINGS.compacted)).toHaveLength(1)
})

test('refused while a turn runs, the compaction queues and runs when the turn ends', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let isBusy = true
  const { toasts, compactions } = await fakeSession($, on, async () => {
    if (isBusy) throw new Error('a turn is running')
    return { messages: SUMMARY }
  })
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
  await ui.press({ key: 'compact' })
  await clock.advance(0)
  expect(toasts).toContain(STRINGS.compactQueued)
  expect(await ui.find({ text: STRINGS.compactAtEnd })).toBeDefined()

  isBusy = false
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await ui.find({ text: STRINGS.compacting })).toBeDefined()
  await clock.advance(1500)
  expect(compactions()).toBe(2)
  expect(toasts).toContain(STRINGS.contextCompacted(27))
  expect(await ui.find({ key: 'compact' })).toBeDefined()
})

test('refused with no turn running, the press reports the failure and the button comes back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { toasts } = await fakeSession($, on, async () => {
    throw new Error('nothing to compact')
  })
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  await ui.press({ key: 'compact' })
  await clock.advance(0)
  expect(toasts.some(t => t.startsWith(STRINGS.compactFailed('')))).toBe(true)
  expect(await ui.find({ key: 'compact' })).toBeDefined()
})

test('a compaction left running by a reload is cleared when the session starts', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { compactions } = await fakeSession($, on, () => new Promise<Compacted>(() => {}))
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'compact' })
  await clock.advance(0)
  expect(compactions()).toBe(1)
  expect(await ui.find({ key: 'compact' })).toBeUndefined()

  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  expect(await ui.find({ key: 'compact' })).toBeDefined()
})
