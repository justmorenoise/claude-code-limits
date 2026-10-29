import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { STRINGS } from '../hooks/strings'

const NOW = Date.parse('2026-10-14T10:00:00.000Z')
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const SUMMARY = [{ role: 'user' as const, text: 'Summary', toolUses: [] }]

async function fakeSession($: Engine, on: On, rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] = []) {
  on('store.get', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1_000_000 }, rateLimits } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: '' }))
  on('session.start', (_, e) => e)
  on('session.measure', (_, e) => e)
  on('session.end', () => ({ sessionId: 's' }))
  on('session.compact', async () => ({ messages: SUMMARY, tokensBefore: 268_000, tokensAfter: 21_000 }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, percent: 27, tokens: 268_000 }, rateLimits, changed: ['context'] })
}

test('a compaction shows its new size at once, and a later measure of the old response does not bring it back', async ($, on) => {
  mock.clock(on, { now: NOW })
  await fakeSession($, on)
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: '268k tokens' })).toBeDefined()

  await $.session.compact({ trigger: 'auto', messages: SUMMARY })
  expect(await ui.find({ text: '~21k tokens' })).toBeDefined()
  expect(await ui.find({ key: 'compact' })).toBeUndefined()

  // The turn after the compaction reports no fill yet, and the last response's count from before it.
  await $.session.measure({ context: { window: 1_000_000, tokens: 268_000 }, rateLimits: [], changed: ['context'] })
  expect(await ui.find({ text: '~21k tokens' })).toBeDefined()
  expect(await ui.find({ text: '268k tokens' })).toBeUndefined()
})

test('/clear drops the old conversation\'s figures', async ($, on) => {
  mock.clock(on, { now: NOW })
  await fakeSession($, on)
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(await ui.find({ text: STRINGS.contextPending })).toBeDefined()
  expect(await ui.find({ text: '268k tokens' })).toBeUndefined()
})

test('a reset countdown turns over on the minute, not on a 30 s beat', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // 10 min 29 s away reads "10 min" until 9 min 30 s are left, then "9 min".
  const resetsAt = new Date(NOW + 10 * 60_000 + 29_000).toISOString()
  await fakeSession($, on, [{ kind: 'five_hour', percentUsed: 40, resetsAt }])
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: '↺ 10 min' })).toBeDefined()

  await clock.advance(59_000)
  expect(await ui.find({ text: '↺ 10 min' })).toBeDefined()
  await clock.advance(1_000)
  expect(await ui.find({ text: '↺ 9 min' })).toBeDefined()
})
