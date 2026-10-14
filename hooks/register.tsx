import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Handoff, Keepwarm, LastResponse, Meters } from '../types'
import { handoffMessage, handoffPrompt, reviewWindow } from './handoff'
import { isWarmPing, keepwarmNote, PING_PROMPT, pingDelay, WINDOW_MS } from './keepwarm'
import { cacheLeft, exhaustedUntil, filledSegments, SEGMENTS, segmentColor, segmentFill, thousands, warmthColor } from './format'
import { duration, label, pickLang, STRINGS } from './i18n'
import type { Lang } from './i18n'

const resumeAt = atom({ plugin: 'limits', key: 'resumeAt' } as const, null)
const lastResponse = atom({ plugin: 'limits', key: 'lastResponse' } as const, null)
const contextTokens = atom({ plugin: 'limits', key: 'contextTokens' } as const, 0)
const now = atom({ plugin: 'limits', key: 'now' } as const, 0)
const meters = atom({ plugin: 'limits', key: 'meters' } as const, { context: null, rateLimits: [] } as Meters)

const WARN_AT = 80
const COMPACT_AT = 85
const TOKENS_WARN = 250_000
const TOKENS_LIMIT = 300_000
const RESUME_GRACE_MS = 60_000

let lang: Lang = 'en'
const tr = () => STRINGS[lang]

let timer: Timer | undefined
let pingTimer: Timer | undefined
let windowEnd = 0
const handoff = atom({ plugin: 'limits', key: 'handoff' } as const, { phase: 'idle', text: null, isAsking: false, scroll: 0 } as Handoff)
const IDLE_HANDOFF: Handoff = { phase: 'idle', text: null, isAsking: false, scroll: 0 }
// Rows of the summary the review shows at once: the band sits above the prompt and must not push it off screen.
const REVIEW_ROWS = 14
const KEEPWARM_KEY = 'keepwarm'
const keepwarm = atom({ plugin: 'limits', key: 'keepwarm' } as const, { isOn: false, nextPingAt: null, stopped: null } as Keepwarm)
let hasWarned = false
let hasWarnedTokens = false
let hasWarnedOverLimit = false
let isCompacting = false
let cacheTtlMs = 60 * 60_000

function cancelPing() {
  pingTimer?.cancel()
  pingTimer = undefined
}

/** A turn of yours restarts the 6h window in which pings may run. */
async function openWindow($: EngineInterface) {
  windowEnd = (await $.clock.now()) + WINDOW_MS
}

async function setKeepwarm($: EngineInterface, isOn: boolean) {
  await $.store.set(KEEPWARM_KEY, isOn)
  if (!isOn) cancelPing()
  await update($, keepwarm, () => ({ isOn, nextPingAt: null, stopped: null }))
  if (!isOn) return
  await openWindow($)
  const last = await read($, lastResponse)
  if (last) await schedulePing($, last.at)
}

/** Schedules the next ping from `from`, the time the cache was last read or written. */
async function schedulePing($: EngineInterface, from: number) {
  cancelPing()
  if (!(await read($, keepwarm)).isOn) return
  const at = from + pingDelay(cacheTtlMs)
  if (at >= windowEnd) {
    await update($, keepwarm, s => ({ ...s, nextPingAt: null }))
    return
  }
  await update($, keepwarm, s => ({ ...s, nextPingAt: at, stopped: null }))
  pingTimer = $.clock.after(Math.max(1000, at - (await $.clock.now())), () => {
    pingTimer = undefined
    void ping($)
  })
}

async function ping($: EngineInterface) {
  const reply = await $.model.fork({ prompt: PING_PROMPT }).catch(() => null)
  const t = await $.clock.now()
  if (reply === null || !reply.isAnswered) {
    const why = reply === null ? tr().pingNotSent : tr().pingFailed(reply.reason)
    await update($, keepwarm, s => ({ ...s, nextPingAt: null, stopped: why }))
    return
  }
  if (!isWarmPing(reply.usage.cache_read_input_tokens, reply.usage.cache_creation_input_tokens)) {
    await update($, keepwarm, s => ({ ...s, nextPingAt: null, stopped: tr().cacheGone }))
    return
  }
  // The ping read the cache: its TTL restarts as after a turn.
  await update($, lastResponse, r => (r === null ? r : { ...r, at: t }))
  await update($, now, () => t)
  await schedulePing($, t)
}

async function writeHandoff($: EngineInterface, focus = '') {
  if ((await read($, handoff)).phase !== 'idle') return
  await update($, handoff, (): Handoff => ({ ...IDLE_HANDOFF, phase: 'writing' }))
  const reply = await $.model.fork({ prompt: handoffPrompt(focus, lang) }).catch(() => null)
  if (reply === null || !reply.isAnswered) {
    await update($, handoff, (): Handoff => IDLE_HANDOFF)
    $.ui.toast(tr().handoffFailed(reply === null ? '' : reply.reason))
    return
  }
  await update($, handoff, (): Handoff => ({ ...IDLE_HANDOFF, phase: 'review', text: reply.text }))
}

// A press runs inside its own dispatch: /clear and the first message go out once it returns.
function startHandoff($: EngineInterface) {
  $.clock.after(0, async () => {
    const { phase, text } = await read($, handoff)
    if (phase !== 'review' || text === null) return
    await update($, handoff, (s): Handoff => ({ ...s, phase: 'starting' }))
    try {
      await $.command.run({ command: 'clear' })
    } catch {
      await update($, handoff, (s): Handoff => ({ ...s, phase: 'review' }))
      $.ui.toast(tr().clearFailed)
      return
    }
    cancelPing()
    await update($, lastResponse, () => null)
    await update($, handoff, (): Handoff => IDLE_HANDOFF)
    await $.prompt.submit({ text: handoffMessage(text, lang), asUser: true })
  })
}

async function arm($: EngineInterface, at: number) {
  timer?.cancel()
  const wait = Math.max(0, at - (await $.clock.now()))
  timer = $.clock.after(wait, () => {
    timer = undefined
    void update($, resumeAt, () => null)
    $.ui.status(undefined)
    $.ui.toast(tr().limitReset)
    void $.prompt.submit({ text: tr().resumeText, asUser: true })
  })
}

function compact($: EngineInterface, percent: number, attempt = 0) {
  // session.compact rejects while a turn runs: wait for turn.complete to settle.
  $.clock.after(attempt === 0 ? 1500 : 5000, async () => {
    try {
      const done = await $.session.compact({ instructions: tr().compactInstructions })
      if (!('skip' in done)) $.ui.toast(tr().contextCompacted(percent))
      isCompacting = false
    } catch {
      if (attempt < 3) compact($, percent, attempt + 1)
      else isCompacting = false
    }
  })
}

let isCompactQueued = false

// A press runs inside its own dispatch, where session.compact is refused: run it once the press returns,
// and if a turn is running, at the end of that turn.
function compactNow($: EngineInterface) {
  if (isCompacting) return
  $.clock.after(0, async () => {
    if (isCompacting) return
    isCompacting = true
    try {
      const done = await $.session.compact({ instructions: tr().compactInstructions })
      $.ui.toast('skip' in done ? tr().compactSkipped(String(done.skip ?? '')) : tr().compacted)
    } catch {
      isCompactQueued = true
      $.ui.toast(tr().compactQueued)
    } finally {
      isCompacting = false
    }
  })
}

async function warnTokens($: EngineInterface, tokens: number) {
  if (tokens < TOKENS_WARN) {
    hasWarnedTokens = false
    hasWarnedOverLimit = false
    return
  }
  if (tokens >= TOKENS_LIMIT && !hasWarnedOverLimit) {
    hasWarnedOverLimit = true
    hasWarnedTokens = true
    $.ui.toast(tr().tokensOver(thousands(tokens), thousands(TOKENS_LIMIT)), {
      timeoutMs: 10_000,
    })
  } else if (!hasWarnedTokens) {
    hasWarnedTokens = true
    $.ui.toast(tr().tokensNear(thousands(tokens), thousands(TOKENS_LIMIT)))
  }
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const TRACK = '#3a3a3a'
const BAR_HEIGHT = 4
// Empty pixels under the bar: Box margins count in rows, too coarse to nudge the note by 2px.
const BAR_SPACE_BELOW = 2
const SEGMENT_GAP = 1.2

type Palette = 'usage' | 'cache'

const colorAt = (palette: Palette, i: number) =>
  palette === 'usage' ? segmentColor(i) : warmthColor(i / (SEGMENTS - 1))

/** A thin bar of rounded segments; percentages keep it at the card's width without stretching the corners. */
function barSvg(percent: number, palette: Palette): string {
  const w = (100 - SEGMENT_GAP * (SEGMENTS - 1)) / SEGMENTS
  const parts = Array.from({ length: SEGMENTS }, (_, i) => {
    const x = i * (w + SEGMENT_GAP)
    const fill = segmentFill(percent, i)
    const shape = `x="${x.toFixed(2)}%" y="0" width="${w.toFixed(2)}%" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}"`
    // The colored part is clipped to the segment's rounded shape, so a partial step keeps its corners.
    return `<clipPath id="s${i}"><rect ${shape}/></clipPath><rect ${shape} fill="${TRACK}"/>` +
      (fill > 0
        ? `<rect clip-path="url(#s${i})" x="${x.toFixed(2)}%" y="0" width="${(w * fill).toFixed(2)}%" height="${BAR_HEIGHT}" fill="${colorAt(palette, i)}"/>`
        : '')
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${BAR_HEIGHT + BAR_SPACE_BELOW}">${parts.join('')}</svg>`
}

// Cards share the row in equal parts so all four always fit on one line.
function card(ui: Ui, hasSvg: boolean, title: string, percent: number, value: string, note: string, palette: Palette = 'usage', action?: unknown) {
  const { Box, Text } = ui
  const filled = filledSegments(percent)
  const tone = colorAt(palette, Math.max(0, filled - 1))
  return (
    <Box key={title} flexDirection="column" width={0} flexGrow={1} minWidth={0} overflow="hidden">
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Text color={tone}>{value}</Text>
      </Box>
      {!hasSvg
        ? (
          <Box gap={1}>
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <Box key={String(i)} width={0} flexGrow={1} height={1}
                backgroundColor={i < filled ? colorAt(palette, i) : TRACK} />
            ))}
          </Box>
        )
        : 'Svg' in ui && <ui.Svg source={barSvg(percent, palette)} alt={`${title} ${value}`} height={BAR_HEIGHT + BAR_SPACE_BELOW} />}
      <Box justifyContent="space-between" columnGap={1}>
        <Text dimColor wrap="truncate">{note || ' '}</Text>
        {action as never}
      </Box>
    </Box>
  )
}

export const register: Register = (on, options) => {
  cacheTtlMs = options.cacheTtl === '5m' ? 5 * 60_000 : 60 * 60_000

  on('session.start', async ($, e, next) => {
    // The language is a nicety: a host that cannot answer leaves the band in English rather than without its hooks.
    const configured = await $.config.list().then(rows => rows.find(row => row.key === 'language')?.value, () => undefined)
    const locale = await $.env.get('LC_ALL').then(v => v || $.env.get('LANG'), () => undefined)
    lang = pickLang(typeof options.language === 'string' ? options.language : undefined, configured, locale)
    const at = await read($, resumeAt)
    if (at !== null) void arm($, at)
    // Fills the bars before the first turn, so they show as soon as the session opens.
    const usage = await $.session.usage()
    await update($, meters, () => ({ context: usage.context.percent ?? null, rateLimits: usage.rateLimits }))
    await update($, now, () => usage.startedAt)
    const isOn = (await $.store.get(KEEPWARM_KEY)) === true
    await update($, keepwarm, () => ({ isOn, nextPingAt: null, stopped: null }))
    await $.command.register({ name: 'keepwarm', description: tr().keepwarmDescription, argumentHint: tr().keepwarmHint })
    await $.command.register({ name: 'handoff', description: tr().handoffDescription, argumentHint: tr().handoffHint })
    // Redraws the cache countdown in the band between turns.
    $.clock.every(30_000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const t = await $.clock.now()
    const pending = await read($, resumeAt)
    // The band shows the figures; the status line only speaks while a resume is pending.
    $.ui.status(pending === null ? undefined : tr().resumingIn(duration(pending - t, lang)))

    await update($, meters, () => ({ context: e.context.percent ?? null, rateLimits: e.rateLimits }))

    const percent = e.context.percent ?? 0
    if (percent >= WARN_AT && !hasWarned) {
      hasWarned = true
      $.ui.toast(tr().contextWarn(percent, COMPACT_AT))
    }
    if (percent < WARN_AT) hasWarned = false

    const tokens = e.context.tokens ?? 0
    await update($, contextTokens, () => tokens)
    await warnTokens($, tokens)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const result = await next(e)
    const t = await $.clock.now()
    if (result.usage) {
      const response: LastResponse = {
        at: t,
        cacheRead: result.usage.cache_read_input_tokens,
        cacheWrite: result.usage.cache_creation_input_tokens,
      }
      await update($, lastResponse, () => response)
    }
    await update($, now, () => t)
    if (result.usage) await schedulePing($, t)

    const usage = await $.session.usage()
    const until = exhaustedUntil(usage.rateLimits)
    if (e.reason === 'error' && until !== null) {
      const at = until + RESUME_GRACE_MS
      await update($, resumeAt, () => at)
      void arm($, at)
      $.ui.status(tr().resumingIn(duration(at - t, lang)))
      $.ui.toast(tr().limitHit(duration(at - t, lang)), {
        timeoutMs: 10_000,
      })
      return result
    }

    const percent = usage.context.percent ?? 0
    if (isCompactQueued && !isCompacting) {
      isCompactQueued = false
      isCompacting = true
      compact($, percent)
      return result
    }
    if (e.reason === 'answer' && percent >= COMPACT_AT && !isCompacting) {
      isCompacting = true
      compact($, percent)
    }

    return result
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const arg = String(e.args ?? '').trim()
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, keepwarm)).isOn
    await setKeepwarm($, isOn)
    return { text: isOn ? tr().keepwarmOn : tr().keepwarmOff }
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const focus = String(e.args ?? '')
    // The fork waits for the session to be free: start it once the command returns.
    $.clock.after(0, () => void writeHandoff($, focus))
    return { text: tr().handoffPreparing }
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    // Compaction rewrites the prefix: the next turn writes a new cache and schedules again.
    if (e.agentId === undefined) cancelPing()
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const isOwn = e.origin?.kind === 'plugin'
    if (!isOwn) {
      cancelPing()
      await openWindow($)
    }
    if (!isOwn && timer !== undefined) {
      timer.cancel()
      timer = undefined
      await update($, resumeAt, () => null)
      $.ui.status(undefined)
    }
    return next(e)
  })

  // While a summary is under review, scrolling the band moves through the summary instead of the band.
  on('ui.scroll', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ho = await read($, handoff)
    if (ho.phase !== 'review' || ho.text === null) return next(e)
    const { max } = reviewWindow(ho.text, 0, REVIEW_ROWS)
    if (max === 0) return next(e)
    await update($, handoff, (s): Handoff => ({ ...s, scroll: Math.min(max, Math.max(0, s.scroll + e.by)) }))
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const last = await read($, lastResponse)
    const tokens = await read($, contextTokens)
    const { context, rateLimits } = await read($, meters)
    const t = Math.max(await read($, now), last?.at ?? 0)
    const ui = $.ui.resolve(e)
    // The terminal has no Svg: there the bar falls back to colored cells.
    const hasSvg = 'Svg' in ui
    const { Box, Button, Text } = ui

    const warmth = await read($, keepwarm)
    const toggle = (
      <Button key="keepwarm" label={warmth.isOn ? 'keepwarm ●' : 'keepwarm ○'} dimColor={!warmth.isOn}
        onPress={() => setKeepwarm($, !warmth.isOn)} />
    )
    const kwNote = keepwarmNote(warmth, t, lang)
    const left = last ? cacheLeft(last.at, cacheTtlMs, t) : 0
    // Full and red right after a response, draining to blue as the TTL runs out.
    const cacheCard = last === null
      ? card(ui, hasSvg, 'cache', 0, '–', kwNote || tr().noResponse, 'cache', toggle)
      : left > 0
        ? card(ui, hasSvg, 'cache', (left / cacheTtlMs) * 100, duration(left, lang),
            kwNote || (last.cacheRead > last.cacheWrite ? 'hit' : 'miss'), 'cache', toggle)
        : card(ui, hasSvg, 'cache', 0, 'cold', kwNote || tr().rewrites(thousands(tokens)), 'cache', toggle)

    const ho = await read($, handoff)
    const askPanel = ho.phase === 'idle' && ho.isAsking
      ? (
        <Box paddingX={1} marginTop={1}>
          {'Input' in ui
            ? (
              <ui.Input key="handoff-focus" autoFocus placeholder={tr().handoffFocusPlaceholder}
                submitLabel={tr().handoff} onSubmit={focus => { $.clock.after(0, () => void writeHandoff($, focus)) }} />
            )
            : <Text dimColor>{tr().handoffFocusHint}</Text>}
        </Box>
      )
      : null
    const view = reviewWindow(ho.text ?? '', ho.scroll, REVIEW_ROWS)
    const handoffPanel = ho.phase === 'writing'
      ? <Text dimColor>{tr().handoffWriting}</Text>
      : ho.phase === 'starting'
        ? <Text dimColor>{tr().handoffStarting}</Text>
        : ho.phase === 'review' && ho.text !== null
          ? (
            <Box flexDirection="column" paddingX={1} marginTop={1}>
              <Text bold>{tr().handoffReview}</Text>
              <Box flexDirection="column" height={REVIEW_ROWS} overflow="hidden">
                {'Markdown' in ui ? <ui.Markdown text={view.text} /> : <Text>{view.text}</Text>}
              </Box>
              {view.max > 0 && <Text dimColor>{tr().reviewRows(view.from + 1, view.to, view.total)}</Text>}
              <Box columnGap={2} marginTop={1}>
                <Button key="handoff-start" label={tr().handoffStart} onPress={() => startHandoff($)} />
                <Button key="handoff-cancel" label={tr().cancel} dimColor
                  onPress={() => update($, handoff, (): Handoff => IDLE_HANDOFF)} />
              </Box>
            </Box>
          )
          : null

    const isOver = tokens >= TOKENS_LIMIT
    const isNear = tokens >= TOKENS_WARN

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={3} paddingX={1}>
          {context !== null && card(ui, hasSvg, tr().context, context, `${Math.round(context)}%`, `${thousands(tokens)} token${lang === 'en' ? 's' : ''}`)}
          {rateLimits.map(limit =>
            card(ui, hasSvg, label(limit.kind, lang), limit.percentUsed, `${Math.round(limit.percentUsed)}%`,
              limit.resetsAt === undefined ? '' : `↺ ${duration(Date.parse(limit.resetsAt) - t, lang)}`))}
          {cacheCard}
        </Box>
        {isNear && (
          <Box>
            <Text color={isOver ? 'red' : 'yellow'}>
              {isOver
                ? tr().overLimit(thousands(tokens), thousands(TOKENS_LIMIT))
                : tr().nearLimit(thousands(tokens), thousands(TOKENS_LIMIT))}
            </Text>
            {e.props.isWorking || isCompactQueued
              ? <Text dimColor>{tr().compactAtEnd}</Text>
              : (
                <Box columnGap={2}>
                  <Button key="compact" label={tr().compactNow} onPress={() => compactNow($)} />
                  {ho.phase === 'idle' && <Button key="handoff" label={tr().handoff} onPress={() => { $.clock.after(0, () => void writeHandoff($)) }} />}
                  {ho.phase === 'idle' && (
                    <Button key="handoff-ask" label={ho.isAsking ? '−' : '+'} dimColor={!ho.isAsking}
                      onPress={() => update($, handoff, (s): Handoff => ({ ...s, isAsking: !s.isAsking }))} />
                  )}
                </Box>
              )}
          </Box>
        )}
        {askPanel}
        {handoffPanel}
      </Box>
    )
  })
}
