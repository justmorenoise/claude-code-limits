import { expect, mock, test } from 'claude-code/testing'

import { handoffMessage, handoffPrompt, isDismissal, reviewWindow } from '../hooks/handoff'
import { STRINGS } from '../hooks/strings'

test('the handoff asks for the plan and state, and the new conversation resumes from it', async () => {
  expect(STRINGS.handoffPrompt).toContain('commit, push and deploy')
  const msg = handoffMessage('## Goal\nX\n')
  expect(msg).toContain('## Goal\nX')
  expect(msg).toContain('Pick up from the next action')
})

test('/handoff writes the summary with a fork and holds it for review', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const state = new Map<string, unknown>()
  const forks: string[] = []
  on('state.get', ($, e) => ({ value: state.has(e.key) ? { value: state.get(e.key), version: 1 } : { value: undefined, version: 0 } }))
  on('state.set', ($, e) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('model.fork', ($, e) => {
    forks.push(e.prompt)
    return { value: { isAnswered: true, text: '## Obiettivo\nfinire limits', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } } }
  })

  await $.command.run({ command: 'handoff', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await clock.advance(0)

  expect(forks).toEqual([STRINGS.handoffPrompt])
  expect(state.get('handoff')).toEqual({ phase: 'review', text: '## Obiettivo\nfinire limits', scroll: 0, isExpanded: false })
})

test('priorities given to /handoff reach the prompt, and none leaves it as is', async () => {
  expect(handoffPrompt('  ')).toBe(STRINGS.handoffPrompt)
  expect(handoffPrompt('the deploy commands')).toContain('Give priority and more detail to the following, which I asked for: the deploy commands')
})

test('the review window moves through the summary and stops at its ends', async () => {
  const text = Array.from({ length: 20 }, (_, i) => `riga ${i + 1}`).join('\n')
  expect(reviewWindow(text, 0, 14)).toMatchObject({ from: 0, to: 14, total: 20, max: 6 })
  expect(reviewWindow(text, 3, 14).text.split('\n')[0]).toBe('riga 4')
  expect(reviewWindow(text, 99, 14)).toMatchObject({ from: 6, to: 20 })
  expect(reviewWindow('breve', 5, 14)).toMatchObject({ from: 0, max: 0 })
})

test('closing the dialog is not an answer, typed text is', async () => {
  expect(isDismissal("The user doesn't want to proceed with this tool use. The tool use was rejected.")).toBe(true)
  expect(isDismissal('  ')).toBe(true)
  expect(isDismissal('le decisioni sul database')).toBe(false)
})
