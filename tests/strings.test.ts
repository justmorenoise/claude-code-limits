import { expect, test } from 'claude-code/testing'

import { cacheLeft, thousands } from '../hooks/format'
import { duration, grouped, label } from '../hooks/strings'

const MIN = 60_000

test('durations carry their units, as in Claude usage panel', async () => {
  expect(duration(143 * MIN)).toBe('2 hr 23 min')
  expect(duration(23 * MIN)).toBe('23 min')
  expect(duration(120 * MIN)).toBe('2 hr')
  expect(duration((4 * 24 + 16) * 60 * MIN)).toBe('4 d 16 hr')
})

test('windows read as short labels and counts are grouped by thousands', async () => {
  expect([label('five_hour'), label('seven_day'), label('other')]).toEqual(['5h', '7d', 'other'])
  expect([grouped(12480), grouped(980)]).toEqual(['12,480', '980'])
})

test('the cache stays warm within its TTL; tokens read in thousands', async () => {
  expect(cacheLeft(0, 60 * MIN, 20 * MIN)).toBe(40 * MIN)
  expect(cacheLeft(0, 60 * MIN, 120 * MIN)).toBe(0)
  expect(thousands(251_400)).toBe('251k')
})
