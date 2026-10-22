# token-usage-tracker

A Claude Code mod that shows your token usage in a collapsible band above the prompt and, on request, in a side pane:

- **This session's usage** in the band: tokens per model, requests and cost.
- **Tokens per day and per model** for the last 7 days in the pane. It reads the local transcripts (`~/.claude/projects/**/*.jsonl`) and counts each response once.
- **Plan limits** (5-hour and weekly) with a progress bar. A toast fires once per window when one reaches 80%.
- **headroom savings** (optional): tokens and USD saved per day, read from `~/.headroom/proxy_savings.json`. Without headroom, that section stays hidden.

`tok` = input + output + cache write. Cache reads are shown apart: they are cheap, but their volume is huge.

## Install

```
/plugin install token-usage-tracker --marketplace fjah90/token-usage-tracker
```

## Requirements

- Claude Code 2.1.304 or later
- Node.js 20 or later on the `PATH` (the scanner, `hooks/scan.mjs`, runs with `node`)

## Usage

- **Band** above the prompt (terminal and Desktop), with **this session's** usage: `usage  5h 42%  Week 46%  session 1.2M tok · $3.21  ▸ By model`. **By model** expands the session's detail, with the **Refresh** and **All usage** buttons. It remembers whether you left it open.
- **Side pane** with the **overall** usage of the last 7 days: `/token-usage` or the **All usage** button.
- The status line shows `5h 42% · Week 46%`.
- Usage refreshes when the session starts, after each response (at most every 30 seconds), every 5 minutes, and with **Refresh**.

The scanner's cache lives in `~/.claude/token-usage-tracker/cache.json` and is safe to delete.

## With prompt-cache-control

This mod is used alongside [prompt-cache-control](https://github.com/davila7/claude-code-templates) from claude-code-templates, which meters the prompt cache: tokens read and written per request, and a countdown to its expiry. They complement each other: this mod counts how much you use, that one how much of it comes from the cache.

Both bands share the space above the prompt, usage on top and cache below; neither hides the other. Each mod also works on its own.

## Development

```bash
claude plugin validate .
claude plugin test .
node tests/scan-check.mjs
claude --plugin-dir .
```

An installed mod runs from a copy. After a change, bump `version` in `.claude-plugin/plugin.json`, then:

```bash
claude plugin marketplace update aponte-mods
claude plugin update token-usage-tracker@aponte-mods
```

and restart the session.

## License

MIT
