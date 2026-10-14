/** The thresholds a person can set: tokens for the warnings, percent of the window for auto-compaction. */
export type Thresholds = { warnTokens: number; limitTokens: number; compactAt: number }

export const DEFAULTS: Thresholds = { warnTokens: 250_000, limitTokens: 300_000, compactAt: 85 }

export const TOKEN_STEP = 25_000
export const PERCENT_STEP = 5
export const MIN_WARN = 50_000
export const MAX_LIMIT = 2_000_000
export const MIN_COMPACT = 50
export const MAX_COMPACT = 95

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The thresholds from the options, each checked: a value out of range, or a warning not below the limit,
 * falls back to its default and is named in `invalid`, so a bad setting never silences the warnings.
 */
export function readThresholds(options: Readonly<Record<string, unknown>>): Thresholds & { invalid: string[] } {
  const invalid: string[] = []
  let { warnTokens, limitTokens, compactAt } = DEFAULTS
  const warn = options.warnTokens
  const limit = options.limitTokens
  const compact = options.compactAt
  // The two are checked as a pair: either alone may be in range and still not below the other.
  if (isNumber(warn) && isNumber(limit) && warn >= MIN_WARN && limit <= MAX_LIMIT && warn < limit) {
    warnTokens = warn
    limitTokens = limit
  } else if (warn !== undefined || limit !== undefined) {
    invalid.push('warnTokens', 'limitTokens')
  }
  if (isNumber(compact) && compact >= MIN_COMPACT && compact <= MAX_COMPACT) compactAt = compact
  else if (compact !== undefined) invalid.push('compactAt')
  return { warnTokens, limitTokens, compactAt, invalid }
}

/** One step of a threshold up or down, held inside its range and keeping the warning a step below the limit. */
export function stepThreshold(t: Thresholds, field: keyof Thresholds, by: 1 | -1): number {
  if (field === 'compactAt') return Math.min(MAX_COMPACT, Math.max(MIN_COMPACT, t.compactAt + by * PERCENT_STEP))
  if (field === 'warnTokens') return Math.min(t.limitTokens - TOKEN_STEP, Math.max(MIN_WARN, t.warnTokens + by * TOKEN_STEP))
  return Math.min(MAX_LIMIT, Math.max(t.warnTokens + TOKEN_STEP, t.limitTokens + by * TOKEN_STEP))
}
