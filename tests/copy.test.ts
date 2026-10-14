import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { STRINGS } from '../hooks/strings'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const SUMMARY = '## Goal\nmove sign-in to OAuth'

/** A summary under review, a surface clipboard that declines, and a Mac clipboard that works. */
async function reviewing($: Engine, on: On) {
  const clock = mock.clock(on, { now: 0 })
  const toasts: string[] = []
  const runs: string[][] = []
  on('model.fork', () => ({
    value: { isAnswered: true, text: SUMMARY, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } },
  }))
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run({ command: 'handoff', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await clock.advance(0)
  return { toasts, runs }
}

test('on the desktop, a declined clipboard falls back to the Mac it runs on', async ($, on) => {
  const { toasts, runs } = await reviewing($, on)
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  await ui.press({ key: 'handoff-copy' })
  expect(runs).toEqual([['pbcopy']])
  expect(toasts).toContain(STRINGS.copied)
})

test('on a phone, the summary is not copied to the Mac and the toast says so', async ($, on) => {
  const { toasts, runs } = await reviewing($, on)
  const ui = await $.ui.mount({ plugin: 'limits', surface: 'mobile', component: 'AbovePrompt', props: PROPS })

  await ui.press({ key: 'handoff-copy' })
  expect(runs).toEqual([])
  expect(toasts).toContain(STRINGS.copyFailed)
})
