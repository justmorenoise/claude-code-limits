import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { isWarmPing, keepwarmNote, pingDelay } from '../hooks/keepwarm'
import { STRINGS } from '../hooks/strings'

const NOW = Date.parse('2026-10-14T10:00:00.000Z')
const MIN = 60_000
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const SUMMARY = [{ role: 'user' as const, text: 'Summary of the conversation so far', toolUses: [] }]
const COMPOSER = { kind: 'composer' } as const
const PRESENTATION = { isFullscreen: false, columns: 120 }

test('a ping lands before the cache expires and only a cheap read counts as warm', async () => {
  expect(pingDelay(60 * MIN)).toBe(50 * MIN)
  expect(isWarmPing(100_000, 200)).toBe(true)
  expect(isWarmPing(0, 100_000)).toBe(false)
  expect(keepwarmNote({ isOn: true, nextPingAt: NOW + 32 * MIN, stopped: null }, NOW)).toBe('ping in 32 min')
  expect(keepwarmNote({ isOn: false, nextPingAt: null, stopped: null }, NOW)).toBe('')
})

/** A session whose turns read a warm cache; counts the pings keepwarm sends. */
function fakeSession(on: On) {
  let pings = 0
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000, percent: 30 }, rateLimits: [] } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => e)
  on('session.compact', () => ({ messages: SUMMARY }))
  on('model.fork', () => {
    pings++
    return { value: { isAnswered: true, text: 'warm', usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 20 } } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 500 } }))
  return { pings: () => pings }
}

async function turn($: Engine) {
  await $.prompt.submit({ text: 'go on', wait: false, origin: COMPOSER })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

const keepwarmOn = ($: Engine) => $.command.run({ command: 'keepwarm', args: 'on', origin: COMPOSER, presentation: PRESENTATION })

test('a new session starts with keepwarm off and sends no ping', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { pings } = fakeSession(on)

  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await turn($)
  await clock.advance(120 * MIN)
  expect(pings()).toBe(0)
})

test('with keepwarm on, a ping goes out 50 minutes after a turn and again after the ping', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { pings } = fakeSession(on)

  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await keepwarmOn($)
  await turn($)

  await clock.advance(49 * MIN)
  expect(pings()).toBe(0)
  await clock.advance(2 * MIN)
  expect(pings()).toBe(1)
  await clock.advance(50 * MIN)
  expect(pings()).toBe(2)
})

test('a reload keeps keepwarm on and schedules the next ping again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { pings } = fakeSession(on)

  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await keepwarmOn($)
  await turn($)
  await clock.advance(10 * MIN)
  // A reload runs session.start again with the session's state as it was.
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  await clock.advance(41 * MIN)
  expect(pings()).toBe(1)
})

test('after a compaction the cache reads as cold and keepwarm waits for the next turn', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { pings } = fakeSession(on)
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await keepwarmOn($)
  await turn($)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })

  expect(await ui.find({ text: STRINGS.cacheCompacted })).toBeDefined()
  await clock.advance(120 * MIN)
  expect(pings()).toBe(0)

  await turn($)
  expect(await ui.find({ text: STRINGS.cacheCompacted })).toBeUndefined()
  await clock.advance(51 * MIN)
  expect(pings()).toBe(1)
})

test('a precompute leaves the cache and the ping alone', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { pings } = fakeSession(on)

  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await keepwarmOn($)
  await turn($)
  await $.session.compact({ trigger: 'precompute', messages: SUMMARY })

  await clock.advance(51 * MIN)
  expect(pings()).toBe(1)
})
