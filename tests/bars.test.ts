import { expect, test } from 'claude-code/testing'

import { filledSegments, segmentColor, segmentFill, warmthColor } from '../hooks/format'

test('segments fill one per started 10% and step from green to red', async () => {
  expect([filledSegments(0), filledSegments(9), filledSegments(10), filledSegments(81), filledSegments(130)]).toEqual([0, 1, 1, 9, 10])
  expect(segmentColor(0)).toBe('#26d926')
  expect(segmentColor(9)).toBe('#d92626')
})

test('a step colors in part and the cache runs from blue to red', async () => {
  expect([segmentFill(12, 0), segmentFill(12, 1), segmentFill(12, 2)].map(f => Math.round(f * 10) / 10)).toEqual([1, 0.2, 0])
  expect(warmthColor(0)).toBe('#3b82f6')
  expect(warmthColor(1)).toBe('#e5484d')
})
