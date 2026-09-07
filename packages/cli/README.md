# The Token Town CLI

Turn your last 90 days of AI coding into a building in
[The Token Town](https://thetokentown.dev).

```bash
npx thetokentown
```

- **Floors** = `round(10 * log2(1 + value built))` over the last 90 days
- **Facade** = how long you have been building
- **Lights on** = synced in the last 30 minutes

Reads local logs from Claude Code, Codex CLI and Grok CLI. Cursor is detected
but disabled — see below.

## What is sent

Only per-day, per-provider, per-model aggregates:

```json
{ "day": "2026-09-04", "provider": "claude", "model": "claude-opus-5",
  "input": 16962, "output": 1200, "cacheRead": 7552, "cacheWrite": 0,
  "costUsd": 0.0478, "costEstimated": false, "turns": 12, "sessions": 1 }
```

Never: prompts, responses, code, file contents, file names, paths, project
names, branch names. Run `npx thetokentown --json` to read the exact payload
before anything is sent — that is the same object the claim link carries.

The claim travels in a **URL fragment**, gzipped. Fragments are not sent to
servers, so the payload only ever reaches the page after you have signed in.

## Options

```text
--json          print the exact snapshot; send nothing
--demo          preview a building with safe demo data
--no-open       do not open a browser
--since <days>  change the activity window (default: 90)
--site <url>    override the site URL
```

## Sources

| Source | Reads | Status |
|---|---|---|
| Claude Code | `~/.claude/projects`, `~/.config/claude/projects`, `CLAUDE_CONFIG_DIR` | supported |
| Codex CLI | `~/.codex/sessions`, `~/.codex/archived_sessions`, `CODEX_HOME` | supported |
| Grok CLI | `$GROK_HOME/sessions/<cwd>/<uuid>/updates.jsonl` | **community-tested** — written from the documented format, not yet run against a real session |
| Cursor | — | **disabled**. Cursor 3.19 records a `tokenCount` field and leaves it at zero on 99.9% of messages. The full investigation is in [`../sources/src/scanners/NOTES.md`](../sources/src/scanners/NOTES.md) |

## Cost

The dollar figure is **value built at API pricing**: tokens × the provider's
published per-token rate. Most people are on a flat plan, so it is not a bill —
it is a comparable measure of how much was built. Raw tokens are always shown
next to it. Rates live in [`pricing.json`](../core/src/pricing.json); every row
cites the official page it came from and the date it was checked.

Grok reports its own cost and that is used verbatim. Cursor, if it is ever
enabled, is an estimate and is marked with an asterisk everywhere it appears.

## State

One file, `~/.thetokentown/config.json` (mode 0600), holding one uuid so that
two runs from the same computer are not counted as two buildings.

## Development

```bash
pnpm install
pnpm --filter thetokentown build
node packages/cli/dist/thetokentown.mjs --demo --no-open
pnpm test
```

Token parsing follows the data-loading behavior of
[ccusage](https://github.com/ryoppippi/ccusage), with attribution preserved in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

MIT © 2026 Santiago
