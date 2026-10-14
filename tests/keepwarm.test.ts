import { expect, mock, test } from 'claude-code/testing'

import { isWarmPing, keepwarmNote, pingDelay } from '../hooks/keepwarm'

const NOW = Date.parse('2026-10-14T10:00:00.000Z')
const MIN = 60_000

test('a ping lands before the cache expires and only a cheap read counts as warm', async () => {
  expect(pingDelay(60 * MIN)).toBe(50 * MIN)
  expect(isWarmPing(100_000, 200)).toBe(true)
  expect(isWarmPing(0, 100_000)).toBe(false)
  expect(keepwarmNote({ isOn: true, nextPingAt: NOW + 32 * MIN, stopped: null }, NOW)).toBe('ping in 32 min')
  expect(keepwarmNote({ isOn: false, nextPingAt: null, stopped: null }, NOW)).toBe('')
})

test('with keepwarm on, a ping goes out 50 minutes after a turn and again after the ping', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const state = new Map<string, unknown>()
  const store = new Map<string, unknown>([['keepwarm', true]])
  let pings = 0
  on('state.get', ($, e) => ({ value: state.has(e.key) ? { value: state.get(e.key), version: 1 } : { value: undefined, version: 0 } }))
  on('state.set', ($, e) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000, percent: 30 }, rateLimits: [] } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => e)
  on('model.fork', () => {
    pings++
    return { value: { isAnswered: true, text: 'warm', usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 20 } } }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 500 } }))

  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'ciao', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  await clock.advance(49 * MIN)
  expect(pings).toBe(0)
  await clock.advance(2 * MIN)
  expect(pings).toBe(1)
  await clock.advance(50 * MIN)
  expect(pings).toBe(2)
})
