import { STRINGS } from './strings'

/** What the fork is asked, with the person's own priorities the way `/compact <instructions>` takes them. */
export const handoffPrompt = (focus: string): string =>
  focus.trim() === '' ? STRINGS.handoffPrompt : `${STRINGS.handoffPrompt}\n\n${STRINGS.handoffFocus(focus.trim())}`

/** The first message of the new conversation: the handoff, framed so the model resumes rather than restarts. */
export const handoffMessage = (summary: string): string =>
  `${STRINGS.handoffIntro}\n\n${summary.trim()}\n\n${STRINGS.handoffOutro}`

/**
 * Whether an answer from `$.ui.ask` is the dialog being closed rather than a choice. The desktop's X resolves
 * with the tool's rejection text instead of rejecting, and that text would otherwise read as typed under "Other".
 */
export const isDismissal = (answer: string): boolean =>
  answer.trim() === '' || /doesn'?t want to proceed|was rejected|user (declined|cancel+ed|dismissed)|tool use was/i.test(answer)
