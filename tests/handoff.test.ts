import { expect, mock, test } from 'claude-code/testing'

import { handoffMessage, handoffPrompt, reviewWindow } from '../hooks/handoff'
import { STRINGS } from '../hooks/i18n'

test('the handoff asks for the plan and state, and the new conversation resumes from it', async () => {
  expect(STRINGS.it.handoffPrompt).toContain('commit, push e deploy')
  expect(STRINGS.en.handoffPrompt).toContain('commit, push and deploy')
  const msg = handoffMessage('## Obiettivo\nX\n', 'it')
  expect(msg).toContain('## Obiettivo\nX')
  expect(msg).toContain('Riparti dalla prossima azione')
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

  expect(forks).toEqual([STRINGS.en.handoffPrompt])
  expect(state.get('handoff')).toEqual({ phase: 'review', text: '## Obiettivo\nfinire limits', isAsking: false, scroll: 0 })
})

test('priorities given to /handoff reach the prompt, and none leaves it as is', async () => {
  expect(handoffPrompt('  ', 'it')).toBe(STRINGS.it.handoffPrompt)
  expect(handoffPrompt('i comandi di deploy', 'it')).toContain('Dai priorità e più dettaglio a quanto segue, indicato da me: i comandi di deploy')
})

test('the review window moves through the summary and stops at its ends', async () => {
  const text = Array.from({ length: 20 }, (_, i) => `riga ${i + 1}`).join('\n')
  expect(reviewWindow(text, 0, 14)).toMatchObject({ from: 0, to: 14, total: 20, max: 6 })
  expect(reviewWindow(text, 3, 14).text.split('\n')[0]).toBe('riga 4')
  expect(reviewWindow(text, 99, 14)).toMatchObject({ from: 6, to: 20 })
  expect(reviewWindow('breve', 5, 14)).toMatchObject({ from: 0, max: 0 })
})
