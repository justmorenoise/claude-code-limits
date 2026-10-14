// Renders the README's state images from the mod's own colors, bars and strings.
// Run from the repository root: node docs/screenshots.ts (Node 23+, Google Chrome; CHROME overrides its path).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MOD = join(import.meta.dirname, '..')
const OUT = import.meta.dirname
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const { SEGMENTS, filledSegments, segmentColor, segmentFill, warmthColor } = await import(join(MOD, 'hooks/format.ts'))
const { STRINGS, duration, grouped } = await import(join(MOD, 'hooks/strings.ts'))

const MIN = 60_000
const TRACK = '#3a3a3a'
const GAP = 1.2

type Palette = 'usage' | 'cache'
const colorAt = (p: Palette, i: number): string => (p === 'usage' ? segmentColor(i) : warmthColor(i / (SEGMENTS - 1)))

// Same geometry as barSvg in register.tsx.
function bar(percent: number, p: Palette, height = 4, below = 4): string {
  const w = (100 - GAP * (SEGMENTS - 1)) / SEGMENTS
  const parts = Array.from({ length: SEGMENTS }, (_, i) => {
    const x = i * (w + GAP)
    const fill = segmentFill(percent, i)
    const shape = `x="${x.toFixed(2)}%" y="0" width="${w.toFixed(2)}%" height="${height}" rx="${height / 2}"`
    return `<clipPath id="c${p}${percent}${i}"><rect ${shape}/></clipPath><rect ${shape} fill="${TRACK}"/>` +
      (fill > 0 ? `<rect clip-path="url(#c${p}${percent}${i})" x="${x.toFixed(2)}%" y="0" width="${(w * fill).toFixed(2)}%" height="${height}" fill="${colorAt(p, i)}"/>` : '')
  })
  return `<svg width="100%" height="${height + below}">${parts.join('')}</svg>`
}

const button = (label: string, dim = false) => `<span class="btn${dim ? ' dim' : ''}">${label}</span>`

function card(title: string, percent: number, value: string, note: string, p: Palette = 'usage', action = ''): string {
  const tone = colorAt(p, Math.max(0, filledSegments(percent) - 1))
  return `<div class="card"><div class="row"><b>${title}</b><span style="color:${tone}">${value}</span></div>${bar(percent, p)}` +
    `<div class="row"><span class="note">${note}</span>${action}</div></div>`
}

type State = {
  context: number
  tokens: number
  fiveHour: number
  fiveReset: number
  weekly: number
  weeklyReset: number
  cache: { left: number; note: string } | 'cold'
  keepwarm: boolean
  extra?: string
  isMinimized?: boolean
}

function band(s: State): string {
  if (s.isMinimized) {
    const cachePercent = s.cache === 'cold' ? 0 : (s.cache.left / (60 * MIN)) * 100
    const mini = (percent: number, p: Palette = 'usage') => `<div class="mini">${bar(percent, p, 3, 0)}</div>`
    return `<div class="band slim"><div class="cards center">${mini(s.context)}${mini(s.fiveHour)}${mini(s.weekly)}${mini(cachePercent, 'cache')}` +
      `${button('+', true)}</div></div>`
  }
  const toggle = button(s.keepwarm ? 'keepwarm ●' : 'keepwarm ○', !s.keepwarm)
  const cache = s.cache === 'cold'
    ? card('cache', 0, 'cold', STRINGS.rewrites(`${Math.round(s.tokens / 1000)}k`), 'cache', toggle)
    : card('cache', (s.cache.left / (60 * MIN)) * 100, duration(s.cache.left), s.cache.note, 'cache', toggle)
  return `<div class="band"><div class="cards">` +
    card(STRINGS.context, s.context, `${s.context}%`, `${Math.round(s.tokens / 1000)}k tokens`) +
    card('5h', s.fiveHour, `${s.fiveHour}%`, `↺ ${duration(s.fiveReset)}`) +
    card('7d', s.weekly, `${s.weekly}%`, `↺ ${duration(s.weeklyReset)}`) +
    cache + `<div class="side">${button('−', true)}${button('⚙', true)}</div></div>${s.extra ?? ''}</div>`
}

const nearLimit = (tokens: string) =>
  `<div class="line"><span style="color:#e5c07b">${STRINGS.nearLimit(tokens, '300k')}</span>` +
  `<span class="group">${button(STRINGS.compactNow)}<span class="pair">${button(STRINGS.handoff)}${button('+', true)}</span></span></div>`

// The band keeps one line for the summary; the summary itself is read in its pane.
const review = `<div class="line"><b class="link">${STRINGS.handoffReady(grouped(3412))}</b>` +
  `<span class="group">${button(STRINGS.handoffOpen)}${button(STRINGS.handoffStart)}${button(STRINGS.copy)}${button(STRINGS.cancel, true)}</span></div>`

const stepper = (title: string, value: string, note: string) =>
  `<div class="set"><span class="lbl">${title}</span>${button('−')}<b class="val">${value}</b>${button('+')}<span class="note">${note}</span></div>`
const pick = (title: string, options: string[], value: string) =>
  `<div class="set"><span class="lbl">${title}</span>${options.map(o => button(o === value ? `● ${o}` : o, o !== value)).join('')}</div>`

const SETTINGS = `<div class="pane"><div class="pane-title">${STRINGS.settingsTitle}</div><div class="pane-body">` +
  stepper(STRINGS.settingWarn, '250k', STRINGS.settingWarnNote) +
  stepper(STRINGS.settingLimit, '300k', STRINGS.settingLimitNote) +
  stepper(STRINGS.settingCompact, '85%', STRINGS.settingCompactNote) +
  pick(STRINGS.settingTtl, ['5m', '1h'], '1h') +
  pick(STRINGS.settingKeepwarm, ['off', 'on'], 'off') +
  `<div class="group">${button(STRINGS.settingsReset, true)}${button(STRINGS.settingsClose)}</div></div></div>`

const PANE = `<div class="pane"><div class="pane-title">${STRINGS.handoffPaneTitle}</div><div class="pane-body">` +
  `<div class="group">${button(STRINGS.handoffStart)}${button(STRINGS.copy)}${button(STRINGS.cancel, true)}</div>` +
  `<div class="md"><h3>Goal</h3><p>Move sign-in from session cookies to OAuth with refresh tokens.</p>` +
  `<h3>Plan</h3><ul><li><b>Done</b>: token endpoint, refresh middleware</li><li><b>Now</b>: migrate the existing sessions</li>` +
  `<li><b>Next</b>: remove the cookie store, deploy to staging</li></ul>` +
  `<h3>Files</h3><ul><li><code>src/auth/refresh.ts</code>: retries once on 401, then signs out</li>` +
  `<li><code>src/auth/session.ts</code>: cookie store kept read-only until the migration ends</li></ul>` +
  `<h3>State</h3><p>Committed on <code>feat/oauth</code>, not pushed. Staging deploy pending.</p></div></div></div>`

const STATES: Record<string, { state: State; height: number }> = {
  band: {
    height: 96,
    state: { context: 12, tokens: 123_000, fiveHour: 53, fiveReset: 93 * MIN, weekly: 16, weeklyReset: (4 * 24 + 14) * 60 * MIN,
      cache: { left: 59 * MIN, note: 'hit' }, keepwarm: false },
  },
  keepwarm: {
    height: 96,
    state: { context: 31, tokens: 62_000, fiveHour: 38, fiveReset: 201 * MIN, weekly: 21, weeklyReset: (5 * 24 + 3) * 60 * MIN,
      cache: { left: 41 * MIN, note: STRINGS.pingIn(duration(32 * MIN)) }, keepwarm: true },
  },
  'near-limit': {
    height: 136,
    state: { context: 27, tokens: 268_000, fiveHour: 74, fiveReset: 52 * MIN, weekly: 33, weeklyReset: (4 * 24 + 2) * 60 * MIN,
      cache: { left: 55 * MIN, note: 'hit' }, keepwarm: false, extra: nearLimit('268k') },
  },
  handoff: {
    height: 164,
    state: { context: 28, tokens: 281_000, fiveHour: 77, fiveReset: 44 * MIN, weekly: 34, weeklyReset: (4 * 24 + 1) * 60 * MIN,
      cache: { left: 58 * MIN, note: 'hit' }, keepwarm: false, extra: nearLimit('281k') + review },
  },
  minimized: {
    height: 52,
    state: { context: 31, tokens: 62_000, fiveHour: 53, fiveReset: 93 * MIN, weekly: 16, weeklyReset: (4 * 24 + 14) * 60 * MIN,
      cache: { left: 52 * MIN, note: 'hit' }, keepwarm: false, isMinimized: true },
  },
  'limit-reached': {
    height: 96,
    state: { context: 46, tokens: 92_000, fiveHour: 100, fiveReset: 62 * MIN, weekly: 41, weeklyReset: (3 * 24 + 9) * 60 * MIN,
      cache: 'cold', keepwarm: false },
  },
}

const CSS = `
*{box-sizing:border-box;margin:0}
body{background:#141414;padding:8px;font:13px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;color:#e8e8e8;-webkit-font-smoothing:antialiased}
.band{background:#232323;border-radius:12px;padding:12px 16px}
.cards{display:flex;gap:24px}
.band.slim{padding:6px 16px}
.cards.center{align-items:center}
.mini{flex:1 1 0;min-width:0;display:flex}
.side{display:flex;flex-direction:column;justify-content:space-between;align-items:center}
.card{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:3px}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:22px}
.row b{font-size:14px}
.note{color:#8f8f8f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{background:#353535;border-radius:6px;padding:1px 8px;color:#e0e0e0;white-space:nowrap}
.btn.dim{color:#9a9a9a}
.line{display:flex;align-items:center;gap:16px;margin-top:12px}
.line.left{gap:8px;margin-top:8px}
.group{display:flex;gap:16px;align-items:center}
.pair{display:flex;gap:8px;align-items:center}
.link{font-size:13px}
.pane{background:#1c1c1c;border:1px solid #333;border-radius:10px;overflow:hidden}
.pane-title{padding:8px 16px;border-bottom:1px solid #333;color:#bdbdbd;font-weight:600}
.pane-body{padding:12px 16px;display:flex;flex-direction:column;gap:12px}
.set{display:flex;align-items:center;gap:8px}
.set .lbl{width:150px}
.set .val{width:48px;text-align:center}
.md{color:#dcdcdc}
.md h3{font-size:14px;margin:10px 0 4px}
.md h3:first-child{margin-top:0}
.md ul{padding-left:20px;margin:0}
.md p{margin:0}
code{font:12px ui-monospace,Menlo,monospace;background:#303030;border-radius:4px;padding:0 4px}
`

const tmp = mkdtempSync(join(tmpdir(), 'limits-shots-'))
for (const [name, { state, height }] of Object.entries(STATES)) {
  const html = join(tmp, `${name}.html`)
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${band(state)}</body>`)
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=900,${height}`, `--screenshot=${join(OUT, `${name}.png`)}`, `file://${html}`], { stdio: 'ignore' })
  console.log(`docs/${name}.png`)
}

const PANES: [string, string, number, number][] = [['handoff-pane', PANE, 560, 372], ['settings', SETTINGS, 640, 262]]
for (const [name, body, width, height] of PANES) {
  const html = join(tmp, `${name}.html`)
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${body}</body>`)
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${width},${height}`, `--screenshot=${join(OUT, `${name}.png`)}`, `file://${html}`], { stdio: 'ignore' })
  console.log(`docs/${name}.png`)
}
