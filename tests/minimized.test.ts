import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { STRINGS } from '../hooks/strings'

const NOW = Date.parse('2026-10-14T10:00:00.000Z')
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const RATE_LIMITS = [
  { kind: 'five_hour', percentUsed: 53, resetsAt: '2026-10-14T11:33:00.000Z' },
  { kind: 'seven_day', percentUsed: 16, resetsAt: '2026-10-19T00:00:00.000Z' },
]

/** A session past 250k tokens, so the expanded band also shows its warning line. */
async function fakeSession($: Engine, on: On, entries: Record<string, unknown> = {}) {
  mock.clock(on, { now: NOW })
  const store = new Map(Object.entries(entries))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1_000_000, percent: 27 }, rateLimits: RATE_LIMITS } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => e)
  on('session.measure', (_, e) => e)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, percent: 27, tokens: 268_000 }, rateLimits: RATE_LIMITS, changed: ['context'] })
  return store
}

test('minimized, the band is the four bars on one row and its + brings the cards back', async ($, on) => {
  await fakeSession($, on)
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'view-toggle' })).toMatchObject({ props: { label: '−' } })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(4)
  await ui.press({ key: 'view-toggle' })

  expect(await ui.find({ key: 'view-toggle' })).toMatchObject({ props: { label: '+' } })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(4)
  for (const svg of await ui.findAll({ type: 'Svg' })) expect(svg.props.height).toBe(3)
  expect(await ui.findAll({ type: 'Text' })).toEqual([])
  expect(await ui.find({ key: 'settings' })).toBeUndefined()
  expect(await ui.find({ key: 'compact' })).toBeUndefined()

  await ui.press({ key: 'view-toggle' })
  expect(await ui.find({ text: STRINGS.context })).toBeDefined()
  expect(await ui.find({ key: 'settings' })).toBeDefined()
  expect(await ui.find({ key: 'compact' })).toBeDefined()
})

test('on the terminal the minimized bars are colored cells, still with no text', async ($, on) => {
  await fakeSession($, on)
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  await ui.press({ key: 'view-toggle' })
  expect(await ui.findAll({ type: 'Text' })).toEqual([])
  expect(await ui.find({ key: 'view-toggle' })).toMatchObject({ props: { label: '+' } })
})

test('the choice is kept for the next session', async ($, on) => {
  const store = await fakeSession($, on, { minimized: true })
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'view-toggle' })).toMatchObject({ props: { label: '+' } })
  await ui.press({ key: 'view-toggle' })
  expect(store.get('minimized')).toBe(false)
})
