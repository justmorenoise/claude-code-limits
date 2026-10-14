import { duration, STRINGS } from './i18n'
import type { Lang } from './i18n'

/** Pings stop this long after the last turn of yours, so a forgotten session does not ping forever. */
export const WINDOW_MS = 6 * 60 * 60_000
export const PING_PROMPT = 'Reply with the single word: warm'

/** A ping lands with a sixth of the TTL to spare: 50 min on a 1 h cache, about 4 min on a 5 min one. */
export const pingDelay = (ttlMs: number): number => Math.round((ttlMs * 5) / 6)

/** A warm ping reads the prefix and writes little: a write of a tenth of the read or more means the cache was gone. */
export const isWarmPing = (read: number, write: number): boolean => read > 0 && write < 0.1 * read

export const keepwarmNote = (s: { isOn: boolean; nextPingAt: number | null; stopped: string | null }, now: number, lang: Lang): string => {
  const t = STRINGS[lang]
  return !s.isOn ? '' : s.stopped ? t.keepwarmStopped(s.stopped) : s.nextPingAt ? t.pingIn(duration(s.nextPingAt - now, lang)) : t.keepwarmWaiting
}
