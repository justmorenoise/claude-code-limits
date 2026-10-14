/** When the session resumes by itself after a usage limit, in $.clock.now() ms; null when nothing is pending. */
export type ResumeAt = number | null

/** The main thread's last completed turn: when it ended and how its prompt met the cache. */
export type LastResponse = {
  at: number
  cacheRead: number
  cacheWrite: number
  /** A compaction installed since: the next request writes a new prefix, so this cache is as good as cold. */
  isCompacted?: boolean
}

/** The latest context fill and usage windows, for the band's bars. */
/** After a compaction and until the next response the context is a local count (`isEstimate`), or not known (`isPending`). */
export type Meters = { context: number | null; isEstimate?: boolean; isPending?: boolean; rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] }

/** The session's keepwarm switch, its next ping and the end of the window pings may run in, in $.clock.now() ms. */
export type Keepwarm = { isOn: boolean; nextPingAt: number | null; stopped: string | null; windowEnd: number }

/** Which warnings this session has shown, so each shows once until its figure drops back. */
export type Warned = { context: boolean; tokens: boolean; overLimit: boolean }

/** The handoff in progress: written by a fork, reviewed in its pane, then started in a cleared conversation. */
export type Handoff = {
  phase: 'idle' | 'writing' | 'review' | 'starting'
  text: string | null
}

/** Compaction from the band: idle, running now, or queued for the end of the turn under way. */
export type Compaction = 'idle' | 'running' | 'queued'

declare module 'claude-code' {
  interface PluginState {
    limits: {
      resumeAt: ResumeAt
      lastResponse: LastResponse | null
      contextTokens: number
      now: number
      meters: Meters
      keepwarm: Keepwarm
      handoff: Handoff
      compaction: Compaction
      warned: Warned
      /** The band shows the bars alone, on one row. */
      minimized: boolean
    }
  }
}
