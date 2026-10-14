# limits

A Claude Code mod that puts your usage above the prompt, and helps you act on it before it costs you.

![The band in the desktop app](docs/band.png)

- **Four cards**: context, 5-hour limit, 7-day limit and prompt cache. Each has a thin bar of ten steps that fill in part and run from green to red; the cache card runs from red (just written) to blue (about to expire).
- **keepwarm**: a toggle on the cache card, or `/keepwarm [on|off]`. While on, a minimal request re-reads the cache shortly before it expires, for up to 6 hours after your last message. Each ping costs tokens and counts toward your limits.
- **Handoff**: `/handoff [what to keep]`, or the Handoff button that appears past 250k tokens (with **+** to say what matters most). The model writes a summary of goal, plan, decisions, files touched and commit/deploy state; you review it, then the mod runs `/clear` and sends the summary as the first message of a clean conversation. Nothing is written to your project. The old conversation stays available through `/resume`.
- **Context guard**: warnings at 250k and 300k tokens, a **Compact now** button, and automatic compaction at the end of a turn above 85% of the window.
- **Auto-resume**: when a turn stops on a usage limit, the mod waits for the reset and continues the work by itself.

Reset times read as in Claude's own usage panel: `2 hr 23 min`, `4 d 16 hr`.

## States

The first image above is a screenshot of the desktop app. The ones below are rendered from the mod's own bars, colors and strings with `docs/screenshots.ts`, since each state takes a long session to reach.

**keepwarm on**: the cache card counts down to the next ping.

![keepwarm on](docs/keepwarm.png)

**Near the limit**: past 250k tokens the band offers to compact now or hand off to a clean conversation.

![Near the token limit](docs/near-limit.png)

**Handoff under review**: the summary stays above the prompt until you start the new conversation, copy it or cancel. ▲ ▼ scroll it.

![Handoff summary under review](docs/handoff.png)

**Usage limit reached**: the 5-hour window is full and the cache has gone cold. The status line counts down to the reset, then the mod resumes the work by itself.

![5-hour limit reached](docs/limit-reached.png)

## Install

Requires a Claude Code version with mods.

```sh
claude plugin marketplace add justmorenoise/claude-code-limits
claude plugin install limits@justmorenoise
```

## Options

| Option | Values | Default |
| --- | --- | --- |
| `cacheTtl` | `1h`, `5m` | `1h` |

Set it when installing, or later in `settings.json`:

```json
{ "pluginConfigs": { "limits": { "options": { "cacheTtl": "1h" } } } }
```

## Notes

- On the desktop app bars are drawn as SVG; in the terminal they fall back to colored cells.
- The handoff runs `/clear` from the mod. If your Claude Code refuses it, the summary stays on screen with a note to clear and paste it yourself.

## Development

```sh
claude plugin validate .
claude plugin test .
node docs/screenshots.ts   # re-renders the state images
```

## License

MIT
