import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { STRINGS } from '../hooks/strings'

const SUMMARY = '## Goal\nMove sign-in to OAuth.\n\n## Plan\n- Done: token endpoint\n- Now: migrate the sessions'
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const PANE = { title: STRINGS.handoffPaneTitle, isFocused: false, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }

/** /handoff run to the point the summary is under review; records panes opened and closed. */
async function reviewing($: Engine, on: On) {
  const clock = mock.clock(on, { now: 0 })
  const opened: string[] = []
  const closed: string[] = []
  const submitted: string[] = []
  const commands: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('model.fork', () => ({
    value: { isAnswered: true, text: SUMMARY, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } },
  }))
  on('command.run', { command: 'clear' }, (_, e) => {
    commands.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await $.command.run({ command: 'handoff', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await clock.advance(0)
  return { clock, opened, closed, submitted, commands }
}

test('the summary opens in its own pane, in Markdown, and the band keeps one line for it', async ($, on) => {
  const { opened } = await reviewing($, on)
  expect(opened).toEqual(['limits-handoff'])

  const pane = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'Pane', props: PANE, requestId: 'limits-handoff' })
  expect(await pane.find({ type: 'Markdown' })).toMatchObject({ props: { text: SUMMARY } })

  const band = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ text: STRINGS.handoffReady(String(SUMMARY.length)) })).toBeDefined()
  expect(await band.find({ type: 'Markdown', text: SUMMARY })).toBeUndefined()
  expect(await band.find({ text: 'Move sign-in to OAuth.' })).toBeUndefined()
})

test('Open on the band brings the pane back after it was closed', async ($, on) => {
  const { opened } = await reviewing($, on)
  const band = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  await band.press({ key: 'handoff-open' })
  expect(opened).toEqual(['limits-handoff', 'limits-handoff'])
})

test('Start in the pane clears, closes the pane and sends the summary', async ($, on) => {
  const { clock, closed, submitted, commands } = await reviewing($, on)
  const pane = await $.ui.mount({ plugin: 'limits', surface: 'desktop', component: 'Pane', props: PANE, requestId: 'limits-handoff' })

  await pane.press({ key: 'handoff-start' })
  await clock.advance(0)
  expect(commands).toEqual(['clear'])
  expect(closed).toEqual(['limits-handoff'])
  expect(submitted[0]).toContain('## Goal')
})

test('Cancel drops the summary and closes its pane', async ($, on) => {
  const { closed } = await reviewing($, on)
  const pane = await $.ui.mount({ plugin: 'limits', surface: 'mobile', component: 'Pane', props: PANE, requestId: 'limits-handoff' })

  await pane.press({ key: 'handoff-cancel' })
  expect(closed).toEqual(['limits-handoff'])
  expect(await pane.find({ text: STRINGS.noSummary })).toBeDefined()
})
