import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { exhaustedUntil } from '../hooks/format'

const RESET = '2026-10-06T14:00:00.000Z'
const NOW = Date.parse('2026-10-06T11:50:00.000Z')

test('only a window at its limit counts as exhausted', async () => {
  expect(exhaustedUntil([{ kind: 'five_hour', percentUsed: 99, resetsAt: RESET }])).toBeNull()
  expect(exhaustedUntil([{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }])).toBe(Date.parse(RESET))
})

test('a turn that dies on the limit resumes by itself after the reset', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const state = new Map<string, unknown>()
  const submitted: string[] = []
  on('state.get', ($, e) => ({ value: state.has(e.key) ? { value: state.get(e.key), version: 1 } : { value: undefined, version: 0 } }))
  on('state.set', ($, e) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, percent: 40 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }] },
  }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' })
  expect(state.get('resumeAt')).toBe(Date.parse(RESET) + 60_000)

  await clock.advance(Date.parse(RESET) - NOW)
  expect(submitted).toEqual([])

  await clock.advance(61_000)
  expect(submitted[0]).toContain('Continue where you left off')
  expect(state.get('resumeAt')).toBeNull()
})

function fakeSession(on: On, rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[], state = new Map<string, unknown>()) {
  const submitted: string[] = []
  const toasts: string[] = []
  on('state.get', ($, e) => ({ value: state.has(e.key) ? { value: state.get(e.key), version: 1 } : { value: undefined, version: 0 } }))
  on('state.set', ($, e) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('store.get', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 40 }, rateLimits } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => e)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))
  return { state, submitted, toasts }
}

test('a weekly limit does not resume by itself days later', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const weekly = '2026-10-09T11:50:00.000Z'
  const { state, submitted, toasts } = fakeSession(on, [
    { kind: 'five_hour', percentUsed: 100, resetsAt: RESET },
    { kind: 'seven_day', percentUsed: 100, resetsAt: weekly },
  ])

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' })
  expect(state.get('resumeAt') ?? null).toBeNull()
  expect(toasts[0]).toContain('too far off to resume')

  await clock.advance(Date.parse(weekly) - NOW + 120_000)
  expect(submitted).toEqual([])
})

test('a resume long past its time is dropped when the session opens again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { state, submitted } = fakeSession(on, [], new Map([['resumeAt', NOW - 2 * 24 * 60 * 60_000]]))

  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)
  expect(submitted).toEqual([])
  expect(state.get('resumeAt')).toBeNull()
})

test('a resume just due when the session opens still goes out', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { submitted } = fakeSession(on, [], new Map([['resumeAt', NOW - 60_000]]))

  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)
  expect(submitted[0]).toContain('Continue where you left off')
})

test('/clear drops a pending resume and the old cache', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { state, submitted } = fakeSession(on, [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }])

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' })
  expect(state.get('resumeAt')).toBe(Date.parse(RESET) + 60_000)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(state.get('resumeAt')).toBeNull()
  expect(state.get('lastResponse')).toBeNull()

  await clock.advance(Date.parse(RESET) - NOW + 120_000)
  expect(submitted).toEqual([])
})
