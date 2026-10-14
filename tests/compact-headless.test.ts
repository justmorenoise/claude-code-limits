import type { On, SessionContextBreakdown } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { STRINGS } from '../hooks/strings'

const NOW = Date.parse('2026-10-14T16:00:00.000Z')
const MIN = 60_000
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const SUMMARY = [{ role: 'user' as const, text: 'Summary of the conversation so far', toolUses: [] }]
// What the desktop app's Code tab answered a plugin's $.session.compact.
const HEADLESS = 'limits: $.session.compact: not available in a headless (-p / SDK) session yet: compaction here runs inside a turn (a /compact prompt); catch it and carry on'

/** A headless session past the warning: the engine refuses a plugin's compaction, a /compact turn compacts. */
async function headless($: Engine, on: On, context = { window: 1_000_000, percent: 40 }, compactedTokens: number | null = 30_000) {
  const clock = mock.clock(on, { now: NOW })
  const submitted: string[] = []
  const toasts: string[] = []
  let refused = 0
  on('store.get', () => ({ value: undefined }))
  let isCompacted = false
  on('session.usage', (_, e) => {
    // After a compaction the engine has no fill until the next response; a local count still has one.
    if (!isCompacted) return { value: { startedAt: NOW, context, rateLimits: [] } }
    const breakdown = e?.breakdown !== undefined && compactedTokens !== null
      ? { totalTokens: compactedTokens } as SessionContextBreakdown
      : undefined
    return { value: { startedAt: NOW, context: { window: context.window, breakdown }, rateLimits: [] } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => e)
  on('session.measure', (_, e) => e)
  on('session.compact', (_, e) => {
    // Only a /compact turn compacts here; the mod's own call is refused.
    if (e.trigger !== 'manual') {
      refused++
      throw new Error(HEADLESS)
    }
    isCompacted = true
    return { messages: SUMMARY }
  })
  on('command.run', { command: 'compact' }, (_, e) => {
    submitted.push(String(e.args ?? ''))
    return { text: '' }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, percent: 40, tokens: 400_000 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  return { clock, ui, submitted, toasts, refused: () => refused }
}

test('refused as headless, Compact now runs /compact instead of failing', async ($, on) => {
  const { clock, ui, submitted, toasts } = await headless($, on)

  await ui.press({ key: 'compact' })
  await clock.advance(0)
  expect(submitted).toEqual([STRINGS.compactInstructions])
  expect(toasts.some(t => t.startsWith(STRINGS.compactFailed('')))).toBe(false)
  expect(await ui.find({ text: STRINGS.compacting })).toBeDefined()

  // /compact compacts as the person's own would, and reports through session.compact.
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  expect(await ui.find({ text: STRINGS.compacting })).toBeUndefined()
})

test('once refused, the next press goes straight to /compact', async ($, on) => {
  const { clock, ui, submitted, refused } = await headless($, on)

  await ui.press({ key: 'compact' })
  await clock.advance(0)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  await $.session.measure({ context: { window: 1_000_000, percent: 40, tokens: 400_000 }, rateLimits: [], changed: ['context'] })
  await ui.press({ key: 'compact' })
  await clock.advance(0)

  expect(refused()).toBe(1)
  expect(submitted).toHaveLength(2)
})

test('a /compact that never reports back frees the button after five minutes', async ($, on) => {
  const { clock, ui } = await headless($, on)

  await ui.press({ key: 'compact' })
  await clock.advance(0)
  expect(await ui.find({ key: 'compact' })).toBeUndefined()

  await clock.advance(5 * MIN)
  expect(await ui.find({ key: 'compact' })).toBeDefined()
})

test('auto-compaction above its threshold also falls back to /compact', { options: { compactAt: 70 } }, async ($, on) => {
  const { clock, submitted } = await headless($, on, { window: 200_000, percent: 72 })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  // Its retries come first, as a refusal right after a turn may only mean the turn is still settling.
  await clock.advance(1500 + 2 * 5000)
  expect(submitted).toEqual([])
  await clock.advance(5000)
  expect(submitted).toEqual([STRINGS.compactInstructions])
})

test('after a compaction the context card shows a local estimate until the next response measures it', async ($, on) => {
  const { clock, ui } = await headless($, on)

  await ui.press({ key: 'compact' })
  await clock.advance(0)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  expect(await ui.find({ text: '~3%' })).toBeDefined()
  expect(await ui.find({ text: '~30k tokens' })).toBeDefined()
  expect(await ui.find({ text: STRINGS.overLimit('400k', '300k') })).toBeUndefined()

  // The window's first measure has no fill yet: the estimate stays.
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  expect(await ui.find({ text: '~3%' })).toBeDefined()

  await $.session.measure({ context: { window: 1_000_000, percent: 4, tokens: 41_000 }, rateLimits: [], changed: ['context'] })
  expect(await ui.find({ text: '4%' })).toBeDefined()
  expect(await ui.find({ text: '41k tokens' })).toBeDefined()
})

test('with no local count, the context card stays and says it is measured on the next response', async ($, on) => {
  const { clock, ui } = await headless($, on, undefined, null)

  await ui.press({ key: 'compact' })
  await clock.advance(0)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  expect(await ui.find({ text: STRINGS.contextPending })).toBeDefined()
  expect(await ui.find({ text: '400k tokens' })).toBeUndefined()
})
