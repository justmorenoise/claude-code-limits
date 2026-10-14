/** Units as Claude's own usage panel writes them: "2 hr 23 min", "4 d 16 hr". */
export const duration = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const d = Math.floor(h / 24)
  if (d > 0) return h % 24 > 0 ? `${d} d ${h % 24} hr` : `${d} d`
  if (h > 0) return m > 0 ? `${h} hr ${m} min` : `${h} hr`
  return `${m} min`
}

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }

export const label = (kind: string): string => LABELS[kind] ?? kind

type Strings = {
  context: string
  noResponse: string
  rewrites: (tokens: string) => string
  nearLimit: (tokens: string, limit: string) => string
  overLimit: (tokens: string, limit: string) => string
  compactAtEnd: string
  compactNow: string
  handoff: string
  handoffWriting: string
  handoffStarting: string
  handoffReady: (chars: string) => string
  copy: string
  copied: string
  copyFailed: string
  handoffStart: string
  cancel: string
  handoffAskQuestion: string
  handoffAskHeader: string
  /** The first option means no priorities; the others are passed on as they read. */
  handoffAskOptions: [string, string, string, string]
  handoffOpen: string
  handoffPaneTitle: string
  noSummary: string
  windowReset: string
  resumingIn: (d: string) => string
  limitReset: string
  limitHit: (d: string) => string
  limitHitNoResume: (d: string) => string
  contextWarn: (percent: number, at: number) => string
  contextCompacted: (percent: number) => string
  compactSkipped: (why: string) => string
  compacted: string
  compactQueued: string
  compacting: string
  compactRunning: string
  compactFailed: (why: string) => string
  tokensOver: (tokens: string, limit: string) => string
  tokensNear: (tokens: string, limit: string) => string
  handoffFailed: (reason: string) => string
  clearFailed: string
  keepwarmOn: string
  keepwarmOff: string
  handoffPreparing: string
  keepwarmDescription: string
  keepwarmHint: string
  handoffDescription: string
  handoffHint: string
  pingIn: (d: string) => string
  keepwarmStopped: (why: string) => string
  keepwarmWaiting: string
  pingNotSent: string
  pingFailed: (reason: string) => string
  cacheGone: string
  cacheCompacted: string
  contextPending: string
  settingsDescription: string
  settingsOpened: string
  settingsTitle: string
  settingWarn: string
  settingWarnNote: string
  settingLimit: string
  settingLimitNote: string
  settingCompact: string
  settingCompactNote: string
  settingTtl: string
  settingKeepwarm: string
  settingsReset: string
  settingsClose: string
  settingFailed: (field: string) => string
  resumeText: string
  compactInstructions: string
  handoffPrompt: string
  handoffFocus: (focus: string) => string
  handoffIntro: string
  handoffOutro: string
}

export const STRINGS: Strings = {
  context: 'context',
  noResponse: 'no response yet',
  rewrites: tokens => `rewrites ${tokens} tokens`,
  nearLimit: (tokens, limit) => `Near the limit: ${tokens} / ${limit} tokens`,
  overLimit: (tokens, limit) => `⚠ ${tokens} tokens: over ${limit} without compacting`,
  compactAtEnd: 'compacting at end of turn',
  compactNow: 'Compact now',
  handoff: 'Handoff',
  handoffWriting: 'Writing the handoff…',
  handoffStarting: 'Starting the new conversation…',
  handoffReady: chars => `Summary ready · ${chars} characters`,
  copy: 'Copy',
  copied: 'Summary copied to the clipboard',
  copyFailed: 'Could not copy: open the summary and select it by hand',
  handoffStart: 'Start new conversation',
  cancel: 'Cancel',
  handoffAskQuestion: 'What should the handoff keep in more detail?',
  handoffAskHeader: 'Handoff',
  handoffAskOptions: ['Everything equally', 'Decisions and their reasons', 'Files touched and git state', 'Commands and checks'],
  handoffOpen: 'Open',
  handoffPaneTitle: 'Handoff summary',
  noSummary: 'No summary under review.',
  windowReset: 'reset',
  resumingIn: d => `resuming in ${d}`,
  limitReset: 'Limit reset: resuming work',
  limitHit: d => `Usage limit reached: resuming by itself in ${d}`,
  limitHitNoResume: d => `Usage limit reached: it resets in ${d}, too far off to resume by itself`,
  contextWarn: (percent, at) => `Context at ${percent}%: compacting at the end of the next turn above ${at}%`,
  contextCompacted: percent => `Context at ${percent}%: compacted at end of turn`,
  compactSkipped: why => `Compaction skipped: ${why}`,
  compacted: 'Context compacted',
  compactQueued: 'Turn running: compacting as soon as it ends',
  compacting: 'Compacting…',
  compactRunning: 'Already compacting: the summary is on its way',
  compactFailed: why => `Compaction failed${why ? `: ${why}` : ''}`,
  tokensOver: (tokens, limit) => `Context at ${tokens} tokens: over ${limit} without compacting`,
  tokensNear: (tokens, limit) => `Context at ${tokens} tokens: compact before ${limit}`,
  handoffFailed: reason => `Handoff failed${reason ? ` (${reason})` : ''}`,
  clearFailed: 'Could not run /clear: press Copy, run /clear and paste',
  keepwarmOn: 'keepwarm on for this session: one ping before the cache expires, for up to 6 hr after your last message',
  keepwarmOff: 'keepwarm off',
  handoffPreparing: 'Writing the handoff: it appears above the prompt for review',
  keepwarmDescription: 'Keeps this session\'s prompt cache warm during breaks: on, off or toggle (limits)',
  keepwarmHint: '[on | off]',
  handoffDescription: 'Summarizes the session and continues it in a clean conversation, after your review (limits)',
  handoffHint: '[what to keep]',
  pingIn: d => `ping in ${d}`,
  keepwarmStopped: why => `keepwarm stopped: ${why}`,
  keepwarmWaiting: 'keepwarm waiting',
  pingNotSent: 'ping not sent',
  pingFailed: reason => `ping failed (${reason})`,
  cacheGone: 'cache already expired',
  cacheCompacted: 'rewritten by compaction',
  contextPending: 'compacted, measured on the next response',
  settingsDescription: 'Opens the limits settings: warning thresholds, auto-compaction, cache TTL, keepwarm',
  settingsOpened: 'Settings opened in a pane',
  settingsTitle: 'limits settings',
  settingWarn: 'Warning at',
  settingWarnNote: 'tokens: yellow line, Compact now and Handoff',
  settingLimit: 'Limit at',
  settingLimitNote: 'tokens: red warning only, no compaction',
  settingCompact: 'Auto-compact at',
  settingCompactNote: 'of the context window, at the end of a turn',
  settingTtl: 'Cache TTL',
  settingKeepwarm: 'keepwarm (session)',
  settingsReset: 'Reset to defaults',
  settingsClose: 'Close',
  settingFailed: field => `Could not save ${field}`,
  resumeText: 'I hit my usage limit while you were working, but it has now reset. Continue where you left off.',
  compactInstructions:
    'Keep the current plan with the steps done and to do, the current step, the decisions made, ' +
    'the constraints and preferences I gave, the files touched and the state of commit, push and deploy.',
  handoffPrompt: [
    'Write the handoff message to continue this work in a new conversation that will see nothing of the current one.',
    'It must stand on its own. Include, in short sections:',
    '- Goal: what we are doing and why.',
    '- Plan: steps done, current step, steps to do.',
    '- Decisions made and why; paths ruled out and why.',
    '- Constraints and preferences I gave.',
    '- Files touched, with paths, and what changed in each.',
    '- State of commit, push and deploy; useful commands to check it.',
    '- Open problems and the next concrete action.',
    'No preamble or greetings: only the content, in English, in Markdown.',
  ].join('\n'),
  handoffFocus: focus => `Give priority and more detail to the following, which I asked for: ${focus}`,
  handoffIntro: 'We are continuing the work of an earlier conversation. This is its handoff:',
  handoffOutro: 'Pick up from the next action it names. If anything does not match the current state of the files, check it before going on.',
}

/** 12,480: written out by hand, since the module's runtime may lack locale data. */
export const grouped = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
