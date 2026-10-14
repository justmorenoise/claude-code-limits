export type Lang = 'it' | 'en'

/** `auto` follows Claude Code's `language` setting, then the system locale; anything not Italian reads in English. */
export const pickLang = (setting: string | undefined, configured: unknown, locale: string | undefined): Lang => {
  if (setting === 'it' || setting === 'en') return setting
  const hint = (typeof configured === 'string' && configured !== '' ? configured : locale ?? '').toLowerCase()
  return hint.startsWith('it') ? 'it' : 'en'
}

/** Units as Claude's own usage panel writes them: "2 h 23 min" in Italian, "2 hr 23 min" in English. */
export const duration = (ms: number, lang: Lang): string => {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const d = Math.floor(h / 24)
  const [day, hour] = lang === 'it' ? ['g', 'h'] : ['d', 'hr']
  if (d > 0) return h % 24 > 0 ? `${d} ${day} ${h % 24} ${hour}` : `${d} ${day}`
  if (h > 0) return m > 0 ? `${h} ${hour} ${m} min` : `${h} ${hour}`
  return `${m} min`
}

const LABELS: Record<Lang, Record<string, string>> = {
  it: { five_hour: '5h', seven_day: '7g', spend_limit: '$' },
  en: { five_hour: '5h', seven_day: '7d', spend_limit: '$' },
}

export const label = (kind: string, lang: Lang): string => LABELS[lang][kind] ?? kind

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
  handoffReview: string
  handoffStart: string
  cancel: string
  handoffFocusPlaceholder: string
  handoffFocusHint: string
  reviewRows: (from: number, to: number, total: number) => string
  resumingIn: (d: string) => string
  limitReset: string
  limitHit: (d: string) => string
  contextWarn: (percent: number, at: number) => string
  contextCompacted: (percent: number) => string
  compactSkipped: (why: string) => string
  compacted: string
  compactQueued: string
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
  resumeText: string
  compactInstructions: string
  handoffPrompt: string
  handoffFocus: (focus: string) => string
  handoffIntro: string
  handoffOutro: string
}

export const STRINGS: Record<Lang, Strings> = {
  it: {
    context: 'contesto',
    noResponse: 'nessuna risposta',
    rewrites: tokens => `riscrive ${tokens} token`,
    nearLimit: (tokens, limit) => `Vicino al limite: ${tokens} / ${limit} token `,
    overLimit: (tokens, limit) => `⚠ ${tokens} token: oltre ${limit} senza compattazione `,
    compactAtEnd: 'compatto a fine turno',
    compactNow: 'Compatta ora',
    handoff: 'Handoff',
    handoffWriting: "Preparo l'handoff…",
    handoffStarting: 'Avvio la conversazione nuova…',
    handoffReview: 'Handoff da rivedere',
    handoffStart: 'Avvia conversazione nuova',
    cancel: 'Annulla',
    handoffFocusPlaceholder: "Cosa tenere nell'handoff (es. le decisioni sul database, i comandi di deploy)",
    handoffFocusHint: 'Scrivi /handoff seguito da cosa tenere',
    reviewRows: (from, to, total) => `righe ${from}–${to} di ${total} · scorri con la rotella o le frecce`,
    resumingIn: d => `riprendo tra ${d}`,
    limitReset: 'Limite ripristinato: riprendo il lavoro',
    limitHit: d => `Limite di utilizzo raggiunto: riprendo da solo tra ${d}`,
    contextWarn: (percent, at) => `Contesto all'${percent}%: lo compatto alla fine del prossimo turno sopra il ${at}%`,
    contextCompacted: percent => `Contesto al ${percent}%: compattato a fine turno`,
    compactSkipped: why => `Compattazione saltata: ${why}`,
    compacted: 'Contesto compattato',
    compactQueued: 'Turno in corso: compatto appena finisce',
    tokensOver: (tokens, limit) => `Contesto a ${tokens} token: oltre ${limit} senza compattazione`,
    tokensNear: (tokens, limit) => `Contesto a ${tokens} token: compatta prima di ${limit}`,
    handoffFailed: reason => `Handoff non riuscito${reason ? ` (${reason})` : ''}`,
    clearFailed: 'Non riesco a eseguire /clear: copia il testo, fai /clear e incollalo',
    keepwarmOn: 'keepwarm attivo: un ping prima che la cache scada, fino a 6 h dopo il tuo ultimo messaggio',
    keepwarmOff: 'keepwarm spento',
    handoffPreparing: "Preparo l'handoff: lo trovi sopra il prompt da rivedere",
    keepwarmDescription: 'Tiene la prompt cache warm nelle pause: on, off o toggle (limits)',
    keepwarmHint: '[on | off]',
    handoffDescription: 'Riassume la sessione e la prosegue in una conversazione pulita, dopo la tua revisione (limits)',
    handoffHint: '[cosa tenere]',
    pingIn: d => `ping tra ${d}`,
    keepwarmStopped: why => `keepwarm fermo: ${why}`,
    keepwarmWaiting: 'keepwarm in attesa',
    pingNotSent: 'ping non inviato',
    pingFailed: reason => `ping fallito (${reason})`,
    cacheGone: 'cache già scaduta',
    resumeText:
      'Ho raggiunto il mio limite di utilizzo mentre stavi lavorando, ma ora è stato ripristinato. Continua da dove avevi interrotto.',
    compactInstructions:
      'Mantieni il piano in corso con i passi fatti e quelli da fare, il passo attuale, le decisioni prese, ' +
      'i vincoli e le preferenze che ho indicato, i file toccati e lo stato di commit, push e deploy.',
    handoffPrompt: [
      'Scrivi il messaggio di handoff per proseguire questo lavoro in una conversazione nuova, che non vedrà nulla di quella attuale.',
      'Deve bastare da solo. Includi, in sezioni brevi:',
      '- Obiettivo: cosa stiamo facendo e perché.',
      '- Piano: passi fatti, passo attuale, passi da fare.',
      '- Decisioni prese e il loro motivo; strade scartate e perché.',
      '- Vincoli e preferenze che ho indicato.',
      '- File toccati, con percorso, e cosa è cambiato in ciascuno.',
      '- Stato di commit, push e deploy; comandi utili per verificare.',
      '- Problemi aperti e la prossima azione concreta.',
      'Niente preamboli né saluti: solo il contenuto, in italiano, in Markdown.',
    ].join('\n'),
    handoffFocus: focus => `Dai priorità e più dettaglio a quanto segue, indicato da me: ${focus}`,
    handoffIntro: 'Proseguiamo il lavoro di una conversazione precedente. Questo è il suo handoff:',
    handoffOutro: 'Riparti dalla prossima azione indicata. Se qualcosa non torna con lo stato attuale dei file, verificalo prima di procedere.',
  },
  en: {
    context: 'context',
    noResponse: 'no response yet',
    rewrites: tokens => `rewrites ${tokens} tokens`,
    nearLimit: (tokens, limit) => `Near the limit: ${tokens} / ${limit} tokens `,
    overLimit: (tokens, limit) => `⚠ ${tokens} tokens: over ${limit} without compacting `,
    compactAtEnd: 'compacting at end of turn',
    compactNow: 'Compact now',
    handoff: 'Handoff',
    handoffWriting: 'Writing the handoff…',
    handoffStarting: 'Starting the new conversation…',
    handoffReview: 'Handoff to review',
    handoffStart: 'Start new conversation',
    cancel: 'Cancel',
    handoffFocusPlaceholder: 'What to keep in the handoff (e.g. the database decisions, the deploy commands)',
    handoffFocusHint: 'Type /handoff followed by what to keep',
    reviewRows: (from, to, total) => `lines ${from}–${to} of ${total} · scroll with the wheel or arrows`,
    resumingIn: d => `resuming in ${d}`,
    limitReset: 'Limit reset: resuming work',
    limitHit: d => `Usage limit reached: resuming by itself in ${d}`,
    contextWarn: (percent, at) => `Context at ${percent}%: compacting at the end of the next turn above ${at}%`,
    contextCompacted: percent => `Context at ${percent}%: compacted at end of turn`,
    compactSkipped: why => `Compaction skipped: ${why}`,
    compacted: 'Context compacted',
    compactQueued: 'Turn running: compacting as soon as it ends',
    tokensOver: (tokens, limit) => `Context at ${tokens} tokens: over ${limit} without compacting`,
    tokensNear: (tokens, limit) => `Context at ${tokens} tokens: compact before ${limit}`,
    handoffFailed: reason => `Handoff failed${reason ? ` (${reason})` : ''}`,
    clearFailed: 'Could not run /clear: copy the text, run /clear and paste it',
    keepwarmOn: 'keepwarm on: one ping before the cache expires, for up to 6 hr after your last message',
    keepwarmOff: 'keepwarm off',
    handoffPreparing: 'Writing the handoff: it appears above the prompt for review',
    keepwarmDescription: 'Keeps the prompt cache warm during breaks: on, off or toggle (limits)',
    keepwarmHint: '[on | off]',
    handoffDescription: 'Summarizes the session and continues it in a clean conversation, after your review (limits)',
    handoffHint: '[what to keep]',
    pingIn: d => `ping in ${d}`,
    keepwarmStopped: why => `keepwarm stopped: ${why}`,
    keepwarmWaiting: 'keepwarm waiting',
    pingNotSent: 'ping not sent',
    pingFailed: reason => `ping failed (${reason})`,
    cacheGone: 'cache already expired',
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
  },
}
