import { atom, read, update } from 'claude-code'
import type { EngineInterface, Hook, Register, RenderNode, RenderSurface, Timer } from 'claude-code'

import type { Compaction, Handoff, Keepwarm, LastResponse, Meters, Warned } from '../types'
import { handoffMessage, handoffPrompt, isDismissal } from './handoff'
import { isWarmPing, keepwarmNote, PING_PROMPT, pingDelay, WINDOW_MS } from './keepwarm'
import { cacheLeft, exhaustedUntil, filledSegments, SEGMENTS, segmentColor, segmentFill, thousands, warmthColor } from './format'
import { DEFAULTS, readThresholds, stepThreshold } from './settings'
import type { Thresholds } from './settings'
import { duration, grouped, label, STRINGS } from './strings'

const resumeAt = atom({ plugin: 'limits', key: 'resumeAt' } as const, null)
const lastResponse = atom({ plugin: 'limits', key: 'lastResponse' } as const, null)
const contextTokens = atom({ plugin: 'limits', key: 'contextTokens' } as const, 0)
const now = atom({ plugin: 'limits', key: 'now' } as const, 0)
const meters = atom({ plugin: 'limits', key: 'meters' } as const, { context: null, rateLimits: [] } as Meters)

// From the options at each load; a change in the settings pane reloads the module with the new ones.
let th: Thresholds = DEFAULTS
let invalidOptions: string[] = []
// The context warning comes a step before auto-compaction.
const warnAt = () => th.compactAt - 5
const SETTINGS_PANE = 'limits-settings'
const RESUME_GRACE_MS = 60_000
// Beyond the 5h window's reset, waiting means the weekly or spend limit: resuming by itself days later is not wanted.
const MAX_RESUME_WAIT_MS = 5 * 60 * 60_000 + RESUME_GRACE_MS
// A resume this far past its time belongs to a session reopened later, not to the turn that hit the limit.
const STALE_RESUME_MS = 10 * 60_000

let timer: Timer | undefined
let pingTimer: Timer | undefined
const handoff = atom({ plugin: 'limits', key: 'handoff' } as const, { phase: 'idle', text: null } as Handoff)
const IDLE_HANDOFF: Handoff = { phase: 'idle', text: null }
// The summary under review is read in a pane of its own: the engine scrolls it and draws its Markdown.
const HANDOFF_PANE = 'limits-handoff'
const keepwarm = atom({ plugin: 'limits', key: 'keepwarm' } as const, { isOn: false, nextPingAt: null, stopped: null, windowEnd: 0 } as Keepwarm)
const minimized = atom({ plugin: 'limits', key: 'minimized' } as const, false)
// In state, so a reload does not show the same warning again.
const warned = atom({ plugin: 'limits', key: 'warned' } as const, { context: false, tokens: false, overLimit: false } as Warned)
// In state rather than a variable, so the band redraws as a compaction starts, queues and ends.
const compaction = atom({ plugin: 'limits', key: 'compaction' } as const, 'idle' as Compaction)
// Set from prompt.submit to turn.complete: tells a compaction refused because a turn runs from one that failed.
let isTurnRunning = false
let cacheTtlMs = 60 * 60_000

function cancelPing() {
  pingTimer?.cancel()
  pingTimer = undefined
}

// Compaction rewrites the prefix: the next turn writes a new cache and schedules again. Only a compaction
// that installs counts: a precompute changes nothing, and the mod's own cancel the ping where they run.
const onCompact: Hook<'session.compact'> = async ($, e, next) => {
  const result = await next(e)
  if (e.agentId === undefined && !('skip' in result)) await markCompacted($)
  return result
}

/** The cached prefix is no longer what the next request sends: no ping for it, and the card reads it as cold. */
async function markCompacted($: EngineInterface) {
  cancelPing()
  await update($, lastResponse, r => (r === null ? r : { ...r, isCompacted: true }))
  await update($, keepwarm, s => ({ ...s, nextPingAt: null }))
}

/** A turn of yours restarts the 6h window in which pings may run. */
async function openWindow($: EngineInterface) {
  const t = await $.clock.now()
  await update($, keepwarm, s => ({ ...s, windowEnd: t + WINDOW_MS }))
}

async function setKeepwarm($: EngineInterface, isOn: boolean) {
  if (!isOn) cancelPing()
  await update($, keepwarm, s => ({ ...s, isOn, nextPingAt: null, stopped: null }))
  if (!isOn) return
  await openWindow($)
  const last = await read($, lastResponse)
  if (last && !last.isCompacted) await schedulePing($, last.at)
}

/** Schedules the next ping from `from`, the time the cache was last read or written. */
async function schedulePing($: EngineInterface, from: number) {
  cancelPing()
  const { isOn, windowEnd } = await read($, keepwarm)
  if (!isOn) return
  const at = from + pingDelay(cacheTtlMs)
  if (at >= (windowEnd ?? 0)) {
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
    const why = reply === null ? STRINGS.pingNotSent : STRINGS.pingFailed(reply.reason)
    await update($, keepwarm, s => ({ ...s, nextPingAt: null, stopped: why }))
    return
  }
  if (!isWarmPing(reply.usage.cache_read_input_tokens, reply.usage.cache_creation_input_tokens)) {
    await update($, keepwarm, s => ({ ...s, nextPingAt: null, stopped: STRINGS.cacheGone }))
    return
  }
  // The ping read the cache: its TTL restarts as after a turn.
  await update($, lastResponse, r => (r === null ? r : { ...r, at: t }))
  await update($, now, () => t)
  await schedulePing($, t)
}

async function writeHandoff($: EngineInterface, focus = '') {
  // From review too: a new summary, perhaps with other priorities, replaces the one on screen.
  const { phase } = await read($, handoff)
  if (phase !== 'idle' && phase !== 'review') return
  await update($, handoff, (): Handoff => ({ ...IDLE_HANDOFF, phase: 'writing' }))
  const reply = await $.model.fork({ prompt: handoffPrompt(focus) }).catch(() => null)
  if (reply === null || !reply.isAnswered) {
    await update($, handoff, (): Handoff => IDLE_HANDOFF)
    $.ui.toast(STRINGS.handoffFailed(reply === null ? '' : reply.reason))
    return
  }
  await update($, handoff, (): Handoff => ({ phase: 'review', text: reply.text }))
  await openSummary($)
}

// A pane refused or not placed is not a failed handoff: the band's Open asks for it again.
async function openSummary($: EngineInterface) {
  await $.ui.open({ id: HANDOFF_PANE, title: STRINGS.handoffPaneTitle, closeOnEscape: true }).catch(() => undefined)
}

async function cancelHandoff($: EngineInterface) {
  await update($, handoff, (): Handoff => IDLE_HANDOFF)
  await $.ui.close({ id: HANDOFF_PANE }).catch(() => undefined)
}

// The surface's clipboard first; where it has none (the desktop app reaches the engine as a remote surface),
// the clipboard of the Mac the engine runs on. Never for a phone: the text would land on the Mac, not in its hand.
async function copyHandoff($: EngineInterface, text: string, surface: RenderSurface) {
  const viaUi = await $.ui.copy({ text, surface }).catch(() => null)
  const isCopied = viaUi?.isCopied === true || (surface !== 'mobile' &&
    (await $.process.run(['pbcopy'], { stdin: text, timeoutMs: 5000 }).then(r => r.exitCode === 0, () => false)))
  $.ui.toast(isCopied ? STRINGS.copied : STRINGS.copyFailed)
}

// The engine's own question dialog: presets for the usual priorities, "Other" for the person's own words.
function askHandoffFocus($: EngineInterface) {
  $.clock.after(0, async () => {
    const [none, ...presets] = STRINGS.handoffAskOptions
    const answer = await $.ui.ask(STRINGS.handoffAskQuestion, { header: STRINGS.handoffAskHeader, options: [none, ...presets] }).catch(() => null)
    $.ui.log(`handoff: ask answered ${JSON.stringify(answer)}`, { to: 'debug' })
    if (answer === null || isDismissal(answer)) return
    await writeHandoff($, answer === none ? '' : answer)
  })
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
      $.ui.toast(STRINGS.clearFailed)
      return
    }
    cancelPing()
    await update($, lastResponse, () => null)
    await cancelHandoff($)
    await $.prompt.submit({ text: handoffMessage(text), asUser: true })
  })
}

async function arm($: EngineInterface, at: number) {
  timer?.cancel()
  const wait = Math.max(0, at - (await $.clock.now()))
  timer = $.clock.after(wait, async () => {
    timer = undefined
    // A /clear or a prompt of yours may have dropped the resume before this timer existed to be cancelled.
    if ((await read($, resumeAt)) !== at) return
    await update($, resumeAt, () => null)
    $.ui.status(undefined)
    $.ui.toast(STRINGS.limitReset)
    void $.prompt.submit({ text: STRINGS.resumeText, asUser: true })
  })
}

const COMPACT_RETRIES = 3

/** Compaction at the end of a turn: session.compact rejects while the turn settles, so it waits and retries. */
async function compact($: EngineInterface, percent: number) {
  await update($, compaction, () => 'running')
  const attempt = (n: number) => $.clock.after(n === 0 ? 1500 : 5000, async () => {
    try {
      const done = await $.session.compact({ instructions: STRINGS.compactInstructions })
      if (!('skip' in done)) await markCompacted($)
      await update($, compaction, () => 'idle')
      if (!('skip' in done)) $.ui.toast(STRINGS.contextCompacted(percent))
    } catch (err) {
      if (n < COMPACT_RETRIES) return void attempt(n + 1)
      await update($, compaction, () => 'idle')
      $.ui.toast(STRINGS.compactFailed(errorText(err)))
    }
  })
  attempt(0)
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err ?? ''))

// A press runs inside its own dispatch, where session.compact is refused: run it once the press returns,
// and if a turn is running, at the end of that turn.
async function compactNow($: EngineInterface) {
  // Checked and marked in one update before the dispatch returns: the band shows the compaction at once,
  // and a second press, even one racing this one, finds it.
  let was: Compaction = 'idle'
  await update($, compaction, s => {
    was = s
    return s === 'idle' ? 'running' : s
  })
  if (was !== 'idle') {
    $.ui.toast(was === 'running' ? STRINGS.compactRunning : STRINGS.compactQueued)
    return
  }
  $.clock.after(0, async () => {
    try {
      const done = await $.session.compact({ instructions: STRINGS.compactInstructions })
      if (!('skip' in done)) await markCompacted($)
      await update($, compaction, () => 'idle')
      $.ui.toast('skip' in done ? STRINGS.compactSkipped(String(done.skip ?? '')) : STRINGS.compacted)
    } catch (err) {
      if (isTurnRunning) {
        await update($, compaction, () => 'queued')
        $.ui.toast(STRINGS.compactQueued)
      } else {
        await update($, compaction, () => 'idle')
        $.ui.toast(STRINGS.compactFailed(errorText(err)))
      }
    }
  })
}

async function warnTokens($: EngineInterface, tokens: number) {
  const was = await read($, warned)
  if (tokens < th.warnTokens) {
    if (was.tokens || was.overLimit) await update($, warned, w => ({ ...w, tokens: false, overLimit: false }))
    return
  }
  if (tokens >= th.limitTokens && !was.overLimit) {
    await update($, warned, w => ({ ...w, tokens: true, overLimit: true }))
    $.ui.toast(STRINGS.tokensOver(thousands(tokens), thousands(th.limitTokens)), {
      timeoutMs: 10_000,
    })
  } else if (!was.tokens) {
    await update($, warned, w => ({ ...w, tokens: true }))
    $.ui.toast(STRINGS.tokensNear(thousands(tokens), thousands(th.limitTokens)))
  }
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const TRACK = '#3a3a3a'
const BAR_HEIGHT = 4
// Empty pixels under the bar: Box margins count in rows, too coarse to nudge the note by 2px.
const BAR_SPACE_BELOW = 4
const SEGMENT_GAP = 1.2
// The minimized band: bars alone, on one row.
const MINI_BAR_HEIGHT = 3
const MINIMIZED_KEY = 'minimized'

type Palette = 'usage' | 'cache'

const colorAt = (palette: Palette, i: number) =>
  palette === 'usage' ? segmentColor(i) : warmthColor(i / (SEGMENTS - 1))

/** A thin bar of rounded segments; percentages keep it at the card's width without stretching the corners. */
function barSvg(percent: number, palette: Palette, height = BAR_HEIGHT, spaceBelow = BAR_SPACE_BELOW): string {
  const w = (100 - SEGMENT_GAP * (SEGMENTS - 1)) / SEGMENTS
  const parts = Array.from({ length: SEGMENTS }, (_, i) => {
    const x = i * (w + SEGMENT_GAP)
    const fill = segmentFill(percent, i)
    const shape = `x="${x.toFixed(2)}%" y="0" width="${w.toFixed(2)}%" height="${height}" rx="${height / 2}"`
    // The colored part is clipped to the segment's rounded shape, so a partial step keeps its corners.
    return `<clipPath id="s${i}"><rect ${shape}/></clipPath><rect ${shape} fill="${TRACK}"/>` +
      (fill > 0
        ? `<rect clip-path="url(#s${i})" x="${x.toFixed(2)}%" y="0" width="${(w * fill).toFixed(2)}%" height="${height}" fill="${colorAt(palette, i)}"/>`
        : '')
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height + spaceBelow}">${parts.join('')}</svg>`
}

/** The bar as the surface draws it: an Svg where it has one, colored cells on the terminal. */
function bar(ui: Ui, percent: number, palette: Palette, alt: string, height = BAR_HEIGHT, spaceBelow = BAR_SPACE_BELOW) {
  const { Box } = ui
  if ('Svg' in ui) return <ui.Svg source={barSvg(percent, palette, height, spaceBelow)} alt={alt} height={height + spaceBelow} />
  const filled = filledSegments(percent)
  return (
    <Box gap={1}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <Box key={String(i)} width={0} flexGrow={1} height={1}
          backgroundColor={i < filled ? colorAt(palette, i) : TRACK} />
      ))}
    </Box>
  )
}

// Cards share the row in equal parts so all four always fit on one line.
function card(ui: Ui, title: string, percent: number, value: string, note: string, palette: Palette = 'usage', action?: RenderNode) {
  const { Box, Text } = ui
  const filled = filledSegments(percent)
  const tone = colorAt(palette, Math.max(0, filled - 1))
  return (
    <Box key={title} flexDirection="column" width={0} flexGrow={1} minWidth={0} overflow="hidden">
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Text color={tone}>{value}</Text>
      </Box>
      {bar(ui, percent, palette, `${title} ${value}`)}
      <Box justifyContent="space-between" columnGap={1}>
        <Text dimColor wrap="truncate">{note || ' '}</Text>
        {action}
      </Box>
    </Box>
  )
}

// A view preference, kept across sessions: a band minimized stays so in the next one.
async function setMinimized($: EngineInterface, isMinimized: boolean) {
  await update($, minimized, () => isMinimized)
  await $.store.set(MINIMIZED_KEY, isMinimized).catch(() => undefined)
}

async function openSettings($: EngineInterface) {
  await $.ui.open({ id: SETTINGS_PANE, title: STRINGS.settingsTitle, focus: true, closeOnEscape: true })
}

// Each change is saved as the plugin's own option, which reloads the module with it: one source for the
// band, the pane and settings.json. Run once the press returns, since the reload ends this environment.
function setOption($: EngineInterface, field: keyof Thresholds | 'cacheTtl', value: number | string) {
  $.clock.after(0, async () => {
    const done = await $.config.set({ key: `limits.${field}`, value }).catch(() => null)
    if (done === null || 'deny' in done) $.ui.toast(STRINGS.settingFailed(field))
  })
}

function resetOptions($: EngineInterface) {
  $.clock.after(0, async () => {
    const all = { ...DEFAULTS, cacheTtl: '1h' }
    for (const [field, value] of Object.entries(all)) {
      const done = await $.config.set({ key: `limits.${field}`, value }).catch(() => null)
      if (done === null || 'deny' in done) $.ui.toast(STRINGS.settingFailed(field))
    }
  })
}

export const register: Register = (on, options) => {
  cacheTtlMs = options.cacheTtl === '5m' ? 5 * 60_000 : 60 * 60_000
  const parsed = readThresholds(options)
  th = { warnTokens: parsed.warnTokens, limitTokens: parsed.limitTokens, compactAt: parsed.compactAt }
  invalidOptions = parsed.invalid

  on('session.start', async ($, e, next) => {
    if (invalidOptions.length > 0) {
      $.ui.log(`limits: ${invalidOptions.join(', ')} out of range, using the defaults`, { to: 'debug' })
    }
    // A reload drops the timers of a compaction under way: what is left marked running would never end.
    if ((await read($, compaction)) === 'running') await update($, compaction, () => 'idle')
    const at = await read($, resumeAt)
    if (at !== null && at < (await $.clock.now()) - STALE_RESUME_MS) await update($, resumeAt, () => null)
    else if (at !== null) void arm($, at)
    // Fills the bars before the first turn, so they show as soon as the session opens.
    const usage = await $.session.usage()
    await update($, meters, () => ({ context: usage.context.percent ?? null, rateLimits: usage.rateLimits }))
    await update($, now, () => usage.startedAt)
    const isMinimized = (await $.store.get(MINIMIZED_KEY).catch(() => undefined)) === true
    await update($, minimized, () => isMinimized)
    // keepwarm belongs to the session: off in a new one, kept across a reload, whose timers are gone, so the
    // next ping is scheduled again while the cache it would keep is still warm.
    await update($, keepwarm, s => ({ ...s, nextPingAt: null, stopped: null }))
    const last = await read($, lastResponse)
    if (last && !last.isCompacted && cacheLeft(last.at, cacheTtlMs, await $.clock.now()) > 0) await schedulePing($, last.at)
    await $.command.register({ name: 'keepwarm', description: STRINGS.keepwarmDescription, argumentHint: STRINGS.keepwarmHint })
    await $.command.register({ name: 'handoff', description: STRINGS.handoffDescription, argumentHint: STRINGS.handoffHint })
    await $.command.register({ name: 'limits', description: STRINGS.settingsDescription })
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
    $.ui.status(pending === null ? undefined : STRINGS.resumingIn(duration(pending - t)))

    await update($, meters, () => ({ context: e.context.percent ?? null, rateLimits: e.rateLimits }))

    const percent = e.context.percent ?? 0
    const isWarned = (await read($, warned)).context
    if (percent >= warnAt() && !isWarned) {
      await update($, warned, w => ({ ...w, context: true }))
      $.ui.toast(STRINGS.contextWarn(percent, th.compactAt))
    }
    if (percent < warnAt() && isWarned) await update($, warned, w => ({ ...w, context: false }))

    const tokens = e.context.tokens ?? 0
    await update($, contextTokens, () => tokens)
    await warnTokens($, tokens)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    isTurnRunning = false

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
    if (e.reason === 'error' && until !== null && until + RESUME_GRACE_MS - t > MAX_RESUME_WAIT_MS) {
      $.ui.toast(STRINGS.limitHitNoResume(duration(until - t)), { timeoutMs: 10_000 })
      return result
    }
    if (e.reason === 'error' && until !== null) {
      const at = until + RESUME_GRACE_MS
      await update($, resumeAt, () => at)
      void arm($, at)
      $.ui.status(STRINGS.resumingIn(duration(at - t)))
      $.ui.toast(STRINGS.limitHit(duration(at - t)), {
        timeoutMs: 10_000,
      })
      return result
    }

    const percent = usage.context.percent ?? 0
    const state = await read($, compaction)
    if (state === 'queued' || (state === 'idle' && e.reason === 'answer' && percent >= th.compactAt)) await compact($, percent)

    return result
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const arg = String(e.args ?? '').trim()
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, keepwarm)).isOn
    await setKeepwarm($, isOn)
    return { text: isOn ? STRINGS.keepwarmOn : STRINGS.keepwarmOff }
  })

  on('command.run', { command: 'limits' }, async $ => {
    await openSettings($)
    return { text: STRINGS.settingsOpened }
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const warmth = await read($, keepwarm)
    const ttl = cacheTtlMs === 5 * 60_000 ? '5m' : '1h'
    const LABEL = 20

    const stepper = (field: keyof Thresholds, title: string, value: string, note: string) => (
      <Box key={field} columnGap={1} alignItems="center">
        <Box width={LABEL}><Text>{title}</Text></Box>
        <Button key={`${field}-down`} label="−" onPress={() => setOption($, field, stepThreshold(th, field, -1))} />
        <Box width={7} justifyContent="center"><Text bold>{value}</Text></Box>
        <Button key={`${field}-up`} label="+" onPress={() => setOption($, field, stepThreshold(th, field, 1))} />
        <Text dimColor wrap="truncate">{note}</Text>
      </Box>
    )
    const choice = (key: string, title: string, options: readonly string[], value: string, onPick: (v: string) => void) => (
      <Box key={key} columnGap={1} alignItems="center">
        <Box width={LABEL}><Text>{title}</Text></Box>
        {options.map(o => (
          <Button key={`${key}-${o}`} label={o === value ? `● ${o}` : o} dimColor={o !== value} onPress={() => onPick(o)} />
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1} paddingX={1}>
        {stepper('warnTokens', STRINGS.settingWarn, thousands(th.warnTokens), STRINGS.settingWarnNote)}
        {stepper('limitTokens', STRINGS.settingLimit, thousands(th.limitTokens), STRINGS.settingLimitNote)}
        {stepper('compactAt', STRINGS.settingCompact, `${th.compactAt}%`, STRINGS.settingCompactNote)}
        {choice('cacheTtl', STRINGS.settingTtl, ['5m', '1h'], ttl, v => setOption($, 'cacheTtl', v))}
        {choice('keepwarm', STRINGS.settingKeepwarm, ['off', 'on'], warmth.isOn ? 'on' : 'off', v => void setKeepwarm($, v === 'on'))}
        <Box columnGap={2}>
          <Button key="settings-reset" label={STRINGS.settingsReset} dimColor onPress={() => resetOptions($)} />
          <Button key="settings-close" label={STRINGS.settingsClose} onPress={() => void $.ui.close({ id: SETTINGS_PANE })} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: HANDOFF_PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const ho = await read($, handoff)
    if (ho.phase !== 'review' || ho.text === null) return <Text dimColor>{STRINGS.noSummary}</Text>
    return (
      <Box flexDirection="column" rowGap={1} paddingX={1}>
        <Box columnGap={2} alignItems="center">
          <Button key="handoff-start" label={STRINGS.handoffStart} onPress={() => startHandoff($)} />
          <Button key="handoff-copy" label={STRINGS.copy} onPress={() => copyHandoff($, ho.text ?? '', e.surface)} />
          <Button key="handoff-cancel" label={STRINGS.cancel} dimColor onPress={() => void cancelHandoff($)} />
        </Box>
        <Markdown text={ho.text} />
      </Box>
    )
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const focus = String(e.args ?? '')
    // The fork waits for the session to be free: start it once the command returns.
    $.clock.after(0, () => void writeHandoff($, focus))
    return { text: STRINGS.handoffPreparing }
  })

  // /clear (and a resume) go on without a new session.start: what belonged to the old conversation must not reach the new one.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      timer?.cancel()
      timer = undefined
      cancelPing()
      await update($, resumeAt, () => null)
      await update($, lastResponse, () => null)
      await update($, keepwarm, s => ({ ...s, nextPingAt: null, stopped: null }))
      if ((await read($, compaction)) === 'queued') await update($, compaction, () => 'idle')
      $.ui.status(undefined)
    }
    return next(e)
  })

  on('session.compact', { trigger: 'manual' }, onCompact)
  on('session.compact', { trigger: 'auto' }, onCompact)

  on('prompt.submit', async ($, e, next) => {
    isTurnRunning = true
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const last = await read($, lastResponse)
    const tokens = await read($, contextTokens)
    const { context, rateLimits } = await read($, meters)
    const t = Math.max(await read($, now), last?.at ?? 0)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui

    const warmth = await read($, keepwarm)
    const toggle = (
      <Button key="keepwarm" label={warmth.isOn ? 'keepwarm ●' : 'keepwarm ○'} dimColor={!warmth.isOn}
        onPress={() => setKeepwarm($, !warmth.isOn)} />
    )
    const kwNote = keepwarmNote(warmth, t)
    const left = last ? cacheLeft(last.at, cacheTtlMs, t) : 0
    const cachePercent = last === null || last.isCompacted ? 0 : (left / cacheTtlMs) * 100

    if (await read($, minimized)) {
      // One row: the four bars alone, thinner, and the control that brings the band back.
      const bars: [string, number, Palette][] = [
        ...(context === null ? [] : [[STRINGS.context, context, 'usage'] as [string, number, Palette]]),
        ...rateLimits.map((l): [string, number, Palette] => [label(l.kind), l.percentUsed, 'usage']),
        ['cache', cachePercent, 'cache'],
      ]
      return (
        <Box flexDirection="row" columnGap={3} paddingX={1} alignItems="center">
          {bars.map(([title, percent, palette]) => (
            <Box key={title} width={0} flexGrow={1} minWidth={0}>
              {bar(ui, percent, palette, `${title} ${Math.round(percent)}%`, MINI_BAR_HEIGHT, 0)}
            </Box>
          ))}
          <Button key="view-toggle" label="+" dimColor onPress={() => setMinimized($, false)} />
        </Box>
      )
    }
    // Full and red right after a response, draining to blue as the TTL runs out.
    const cacheCard = last === null
      ? card(ui, 'cache', 0, '–', kwNote || STRINGS.noResponse, 'cache', toggle)
      : last.isCompacted
        ? card(ui, 'cache', 0, 'cold', STRINGS.cacheCompacted, 'cache', toggle)
      : left > 0
        ? card(ui, 'cache', (left / cacheTtlMs) * 100, duration(left),
            kwNote || (last.cacheRead > last.cacheWrite ? 'hit' : 'miss'), 'cache', toggle)
        : card(ui, 'cache', 0, 'cold', kwNote || STRINGS.rewrites(thousands(tokens)), 'cache', toggle)

    const ho = await read($, handoff)
    const isNear = tokens >= th.warnTokens
    // The band keeps one line for the summary under review: the text itself is read in its pane.
    const handoffPanel = ho.phase === 'writing'
      ? <Text dimColor>{STRINGS.handoffWriting}</Text>
      : ho.phase === 'starting'
        ? <Text dimColor>{STRINGS.handoffStarting}</Text>
        : ho.phase === 'review' && ho.text !== null
          ? (
            <Box marginTop={1} columnGap={2} alignItems="center">
              <Text bold>{STRINGS.handoffReady(grouped(ho.text.length))}</Text>
              <Button key="handoff-open" label={STRINGS.handoffOpen} onPress={() => void openSummary($)} />
              <Button key="handoff-start" label={STRINGS.handoffStart} onPress={() => startHandoff($)} />
              <Button key="handoff-copy" label={STRINGS.copy} onPress={() => copyHandoff($, ho.text ?? '', e.surface)} />
              <Button key="handoff-cancel" label={STRINGS.cancel} dimColor onPress={() => void cancelHandoff($)} />
            </Box>
          )
          : null

    const compactState = await read($, compaction)
    const isOver = tokens >= th.limitTokens

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" columnGap={3}>
          {context !== null && card(ui, STRINGS.context, context, `${Math.round(context)}%`, `${thousands(tokens)} tokens`)}
          {rateLimits.map(limit =>
            card(ui, label(limit.kind), limit.percentUsed, `${Math.round(limit.percentUsed)}%`,
              limit.resetsAt === undefined ? '' : `↺ ${duration(Date.parse(limit.resetsAt) - t)}`))}
          {cacheCard}
          <Box flexDirection="column" justifyContent="space-between">
            <Button key="view-toggle" label="−" dimColor onPress={() => setMinimized($, true)} />
            <Button key="settings" label="⚙" dimColor onPress={() => void openSettings($)} />
          </Box>
        </Box>
        {isNear && (
          <Box marginTop={1} columnGap={2} alignItems="center">
            <Text color={isOver ? 'red' : 'yellow'}>
              {isOver
                ? STRINGS.overLimit(thousands(tokens), thousands(th.limitTokens))
                : STRINGS.nearLimit(thousands(tokens), thousands(th.limitTokens))}
            </Text>
            {compactState === 'running'
              ? <Text dimColor>{STRINGS.compacting}</Text>
              : e.props.isWorking || compactState === 'queued'
              ? <Text dimColor>{STRINGS.compactAtEnd}</Text>
              : (
                <Box columnGap={2}>
                  <Button key="compact" label={STRINGS.compactNow} onPress={() => void compactNow($)} />
                  {(ho.phase === 'idle' || ho.phase === 'review') && (
                    // Handoff and its + read as one control: a narrower gap than between the actions.
                    <Box columnGap={1}>
                      <Button key="handoff" label={STRINGS.handoff} onPress={() => { $.clock.after(0, () => void writeHandoff($)) }} />
                      <Button key="handoff-ask" label="+" dimColor onPress={() => askHandoffFocus($)} />
                    </Box>
                  )}
                </Box>
              )}
          </Box>
        )}
        {handoffPanel}
      </Box>
    )
  })
}
