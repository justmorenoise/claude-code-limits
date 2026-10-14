import { STRINGS } from './i18n'
import type { Lang } from './i18n'

/** What the fork is asked, with the person's own priorities the way `/compact <instructions>` takes them. */
export const handoffPrompt = (focus: string, lang: Lang): string =>
  focus.trim() === '' ? STRINGS[lang].handoffPrompt : `${STRINGS[lang].handoffPrompt}\n\n${STRINGS[lang].handoffFocus(focus.trim())}`

/** The first message of the new conversation: the handoff, framed so the model resumes rather than restarts. */
export const handoffMessage = (summary: string, lang: Lang): string =>
  `${STRINGS[lang].handoffIntro}\n\n${summary.trim()}\n\n${STRINGS[lang].handoffOutro}`

/** The rows of `text` a window of `rows` shows from `offset`, the offset clamped so the window never runs past the end. */
export const reviewWindow = (text: string, offset: number, rows: number) => {
  const lines = text.split('\n')
  const max = Math.max(0, lines.length - rows)
  const from = Math.min(max, Math.max(0, offset))
  return { text: lines.slice(from, from + rows).join('\n'), from, to: Math.min(lines.length, from + rows), total: lines.length, max }
}
