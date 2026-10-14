import { expect, test } from 'claude-code/testing'

import { cacheLeft, thousands } from '../hooks/format'
import { duration, label, pickLang } from '../hooks/i18n'

const MIN = 60_000

test('durations carry their units, as in Claude usage panel', async () => {
  expect(duration(143 * MIN, 'it')).toBe('2 h 23 min')
  expect(duration(143 * MIN, 'en')).toBe('2 hr 23 min')
  expect(duration(23 * MIN, 'it')).toBe('23 min')
  expect(duration(120 * MIN, 'en')).toBe('2 hr')
  expect(duration((4 * 24 + 16) * 60 * MIN, 'it')).toBe('4 g 16 h')
  expect(duration((4 * 24 + 16) * 60 * MIN, 'en')).toBe('4 d 16 hr')
})

test('the language follows the option, then the setting, then the locale', async () => {
  expect(pickLang('it', 'english', 'en_US.UTF-8')).toBe('it')
  expect(pickLang('auto', 'italiano', 'en_US.UTF-8')).toBe('it')
  expect(pickLang('auto', undefined, 'it_IT.UTF-8')).toBe('it')
  expect(pickLang('auto', undefined, 'de_DE.UTF-8')).toBe('en')
  expect([label('seven_day', 'it'), label('seven_day', 'en')]).toEqual(['7g', '7d'])
})

test('the cache stays warm within its TTL; tokens read in thousands', async () => {
  expect(cacheLeft(0, 60 * MIN, 20 * MIN)).toBe(40 * MIN)
  expect(cacheLeft(0, 60 * MIN, 120 * MIN)).toBe(0)
  expect(thousands(251_400)).toBe('251k')
})
