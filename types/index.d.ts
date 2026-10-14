/** When the session resumes by itself after a usage limit, in $.clock.now() ms; null when nothing is pending. */
export type ResumeAt = number | null

/** The main thread's last completed turn: when it ended and how its prompt met the cache. */
export type LastResponse = { at: number; cacheRead: number; cacheWrite: number }

/** The latest context fill and usage windows, for the band's bars. */
export type Meters = { context: number | null; rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] }

/** The keepwarm switch and its next ping, in $.clock.now() ms. */
export type Keepwarm = { isOn: boolean; nextPingAt: number | null; stopped: string | null }

/** The handoff in progress: written by a fork, shown for review, then started in a cleared conversation. */
export type Handoff = {
  phase: 'idle' | 'writing' | 'review' | 'starting'
  text: string | null
  /** The priorities field under the Handoff button is open. */
  isAsking: boolean
  /** The first row of the summary the review window shows. */
  scroll: number
}

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
    }
  }
}
