import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DEFAULTS, readThresholds, stepThreshold } from '../hooks/settings'
import { STRINGS } from '../hooks/strings'

const NOW = Date.parse('2026-10-14T10:00:00.000Z')
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const PANE = { title: 'limits settings', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const SUMMARY = [{ role: 'user' as const, text: 'Summary of the conversation so far', toolUses: [] }]

test('thresholds come from the options, and a bad pair falls back to the defaults', async () => {
  expect(readThresholds({ warnTokens: 400_000, limitTokens: 500_000, compactAt: 70 })).toEqual({
    warnTokens: 400_000, limitTokens: 500_000, compactAt: 70, invalid: [],
  })
  expect(readThresholds({ warnTokens: 300_000, limitTokens: 300_000, compactAt: 85 })).toMatchObject({
    warnTokens: DEFAULTS.warnTokens, limitTokens: DEFAULTS.limitTokens, invalid: ['warnTokens', 'limitTokens'],
  })
  expect(readThresholds({ warnTokens: 250_000, limitTokens: 300_000, compactAt: 99 })).toMatchObject({ compactAt: 85, invalid: ['compactAt'] })
})

test('a step keeps each threshold in range and the warning below the limit', async () => {
  expect(stepThreshold(DEFAULTS, 'warnTokens', 1)).toBe(275_000)
  expect(stepThreshold({ ...DEFAULTS, warnTokens: 275_000 }, 'warnTokens', 1)).toBe(275_000)
  expect(stepThreshold(DEFAULTS, 'limitTokens', -1)).toBe(275_000)
  expect(stepThreshold({ ...DEFAULTS, limitTokens: 275_000 }, 'limitTokens', -1)).toBe(275_000)
  expect(stepThreshold({ ...DEFAULTS, compactAt: 95 }, 'compactAt', 1)).toBe(95)
  expect(stepThreshold({ ...DEFAULTS, compactAt: 50 }, 'compactAt', -1)).toBe(50)
})

/** A session that records toasts, compactions, pane opens and option writes. */
async function fakeSession($: Engine, on: On, usage = { window: 1_000_000, percent: 30 }) {
  const toasts: string[] = []
  const opened: string[] = []
  const saved: [string, unknown][] = []
  let compactions = 0
  on('session.usage', () => ({ value: { startedAt: NOW, context: usage, rateLimits: [] } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => e)
  on('session.measure', (_, e) => e)
  on('session.compact', () => {
    compactions++
    return { messages: SUMMARY }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('config.set', (_, e) => {
    saved.push([e.key, e.value])
    return { value: e.value }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  return { toasts, opened, saved, compactions: () => compactions }
}

const measure = ($: Engine, percent: number, tokens: number) =>
  $.session.measure({ context: { window: 1_000_000, percent, tokens }, rateLimits: [], changed: ['context'] })

const answer = ($: Engine) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

test('the warnings follow the configured thresholds', { options: { warnTokens: 400_000, limitTokens: 500_000 } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const { toasts } = await fakeSession($, on)

  await measure($, 32, 320_000)
  expect(toasts).toEqual([])
  await measure($, 42, 420_000)
  expect(toasts).toEqual([STRINGS.tokensNear('420k', '500k')])
})

test('past the token limit the band warns in red but does not compact', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { toasts, compactions } = await fakeSession($, on)
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  await measure($, 32, 320_000)
  await answer($)
  await clock.advance(10_000)
  expect(compactions()).toBe(0)
  expect(toasts).toContain(STRINGS.tokensOver('320k', '300k'))
  expect(await ui.find({ text: STRINGS.overLimit('320k', '300k') })).toBeDefined()
})

test('auto-compaction follows its configured share of the window', { options: { compactAt: 70 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { compactions } = await fakeSession($, on, { window: 200_000, percent: 72 })

  await answer($)
  await clock.advance(1500)
  expect(compactions()).toBe(1)
})

for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
  test(`${surface}: the band's gear opens the settings pane, and a step saves the option`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { opened, saved } = await fakeSession($, on)
    const band = await $.ui.mount({ plugin: 'limits', surface, component: 'AbovePrompt', props: BAND })

    await band.press({ key: 'settings' })
    expect(opened).toEqual(['limits-settings'])

    const pane = await $.ui.mount({ plugin: 'limits', surface, component: 'Pane', props: PANE, requestId: 'limits-settings' })
    expect(await pane.find({ text: '250k' })).toBeDefined()
    await pane.press({ key: 'warnTokens-up' })
    await pane.press({ key: 'compactAt-down' })
    await pane.press({ key: 'cacheTtl-5m' })
    await clock.advance(0)
    expect(saved).toEqual([['limits.warnTokens', 275_000], ['limits.compactAt', 80], ['limits.cacheTtl', '5m']])
  })
}

test('/limits opens the pane; keepwarm and reset act from it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { opened, saved } = await fakeSession($, on)

  await $.command.run({ command: 'limits', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(opened).toEqual(['limits-settings'])

  const pane = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'Pane', props: PANE, requestId: 'limits-settings' })
  await pane.press({ key: 'keepwarm-on' })
  expect(await pane.find({ key: 'keepwarm-on' })).toMatchObject({ props: { label: '● on' } })

  await pane.press({ key: 'settings-reset' })
  await clock.advance(0)
  expect(saved).toEqual([
    ['limits.warnTokens', 250_000], ['limits.limitTokens', 300_000], ['limits.compactAt', 85], ['limits.cacheTtl', '1h'],
  ])
})
