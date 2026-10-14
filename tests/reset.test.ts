import { expect, mock, test } from 'claude-code/testing'

import { liveLimit } from '../hooks/format'
import { STRINGS } from '../hooks/strings'

const NOW = Date.parse('2026-10-14T16:00:00.000Z')
const MIN = 60_000
const RESET = new Date(NOW + 10 * MIN).toISOString()
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const RATE_LIMITS = [
  { kind: 'five_hour', percentUsed: 94, resetsAt: RESET },
  { kind: 'seven_day', percentUsed: 21, resetsAt: '2026-10-19T05:00:00.000Z' },
]

test('a window past its reset reads as a fresh one', async () => {
  expect(liveLimit(RATE_LIMITS[0]!, NOW)).toMatchObject({ percentUsed: 94, isReset: false })
  expect(liveLimit(RATE_LIMITS[0]!, NOW + 10 * MIN)).toMatchObject({ percentUsed: 0, resetsAt: undefined, isReset: true })
  expect(liveLimit({ kind: 'spend_limit', percentUsed: 40 }, NOW)).toMatchObject({ percentUsed: 40, isReset: false })
})

test('with no response since, the band shows the 5h window reset once its time has come', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('store.get', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1_000_000, percent: 40 }, rateLimits: RATE_LIMITS } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ text: '94%' })).toBeDefined()
  expect(await ui.find({ text: '↺ 10 min' })).toBeDefined()

  // The band's own tick redraws it every 30 seconds; no response, so no new figures.
  await clock.advance(10 * MIN + 30_000)
  expect(await ui.find({ text: '94%' })).toBeUndefined()
  expect(await ui.find({ text: '0%' })).toBeDefined()
  expect(await ui.find({ text: `↺ ${STRINGS.windowReset}` })).toBeDefined()
  expect(await ui.find({ text: '21%' })).toBeDefined()
})
