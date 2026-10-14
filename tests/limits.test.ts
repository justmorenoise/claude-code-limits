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

