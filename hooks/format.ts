import type { SessionRateLimit } from 'claude-code'

/** The time the exhausted window resets, or null when no window is at its limit. */
export const exhaustedUntil = (limits: readonly SessionRateLimit[]): number | null => {
  const resets = limits
    .filter(limit => limit.percentUsed >= 100 && limit.resetsAt !== undefined)
    .map(limit => Date.parse(limit.resetsAt as string))
    .filter(t => !Number.isNaN(t))

  return resets.length === 0 ? null : Math.max(...resets)
}

/**
 * A usage window as of `now`. Its figures come with each response, so one whose reset has passed since is
 * a fresh window: 0%, no reset time, until the next figures arrive.
 */
export const liveLimit = <L extends { percentUsed: number; resetsAt?: string }>(limit: L, now: number): L & { isReset: boolean } => {
  const at = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)
  return !Number.isNaN(at) && at <= now
    ? { ...limit, percentUsed: 0, resetsAt: undefined, isReset: true }
    : { ...limit, isReset: false }
}

/**
 * The windows in the account's usage answer (`/api/oauth/usage`, what the native panel reads), in the
 * engine's shape: `utilization` is already a percent there.
 */
export const accountLimits = (body: unknown): SessionRateLimit[] => {
  if (typeof body !== 'object' || body === null) return []
  return (['five_hour', 'seven_day'] as const).flatMap(kind => {
    const w = (body as Record<string, { utilization?: unknown; resets_at?: unknown } | null | undefined>)[kind]
    if (!w || typeof w.utilization !== 'number') return []
    const limit: SessionRateLimit = { kind, percentUsed: Math.round(w.utilization * 10) / 10 }
    return [typeof w.resets_at === 'string' ? { ...limit, resetsAt: w.resets_at } : limit]
  })
}

export const thousands =(tokens: number): string => `${Math.round(tokens / 1000)}k`

/** Milliseconds the cache stays warm after a response at `at`; 0 once it has expired. */
export const cacheLeft = (at: number, ttlMs: number, now: number): number => Math.max(0, at + ttlMs - now)

export const SEGMENTS = 10

/** The color of segment `i` (0–9): hue steps from green (120°) to red (0°), one step per 10%. */
export const segmentColor = (i: number): string => {
  const hue = 120 - (120 * Math.min(SEGMENTS - 1, Math.max(0, i))) / (SEGMENTS - 1)
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    const v = 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * (0.15 + 0.7 * v)).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Filled segments for a percent: a started 10% step counts, so any use above 0 shows. */
export const filledSegments = (percent: number): number =>
  Math.min(SEGMENTS, Math.max(0, Math.ceil(Math.min(100, percent) / 10)))

/** How much of segment `i` a percent covers, 0 to 1: a step colors in part as it starts. */
export const segmentFill = (percent: number, i: number): number =>
  Math.min(1, Math.max(0, Math.min(100, percent) / 10 - i))

/** Blue at 0 (cold or about to be) to red at 1 (just written), for the cache. */
export const warmthColor = (t: number): string => {
  const k = Math.min(1, Math.max(0, t))
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k).toString(16).padStart(2, '0')
  return `#${mix(0x3b, 0xe5)}${mix(0x82, 0x48)}${mix(0xf6, 0x4d)}`
}
