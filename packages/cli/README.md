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

## Commands

| Command | Does |
|---|---|
| `thetokentown` | `install` if hooks are not installed yet, otherwise `status` |
| `thetokentown scan` | scan the sources and print a table; sends nothing |
| `thetokentown --json` | print the exact Snapshot v2 a claim would carry; sends nothing |
| `thetokentown claim` | scan and open `/claim#<snapshot>` in the browser; no token, no request |
| `thetokentown login` | device flow; stores the hook token in `~/.thetokentown/config.json` (0600). `--token <t>` stores a token pasted from `/me` instead |
| `thetokentown publish [--yes]` | scan, preview, confirm, then `POST /api/snapshot` with the token |
| `thetokentown install` | `claim` → `login` → choose building → hooks, with the exact diff and a `[y/N]` per tool |
| `thetokentown sync` | sync now, in the foreground |
| `thetokentown sync --hook [--flush]` | what the hooks call — see below |
| `thetokentown uninstall [--purge]` | remove only our hook entries; `--purge` also removes `~/.thetokentown` |
| `thetokentown status` | sources, hooks, last sync, link |

Global flags: `--json`, `--no-open`, `--since <days>` (default 90),
`--site <url>` (or `THETOKENTOWN_SITE_URL`), `--demo`, `--yes`.

## Hooks

`install` keeps the building alive by asking the tools to run
`thetokentown sync --hook` when a session ends. Every change is shown as a
diff and confirmed per tool; the original file is kept next to it as
`*.bak.thetokentown`, and `uninstall` puts it back.

| Tool | File | Entry |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `hooks.Stop` and `hooks.SessionEnd` (`--flush`): `{ "type": "command", "command": "<abs> sync --hook", "async": true, "timeout": 10 }` |
| Codex CLI | `~/.codex/config.toml` | `notify = ["<abs>", "sync", "--hook"]`. If a `notify` is already configured, a wrapper in `~/.thetokentown/bin` runs ours and then the previous one |
| Grok CLI | — | rides along with the other hooks; a 15-minute schedule (launchd / cron / schtasks) is offered only when Grok is the sole source |

Rules: absolute path to this binary, never `npx`; our entries are identified by
the substring `thetokentown sync`; a file that does not parse is not touched;
third-party hooks are preserved, and when the file was not edited since
`install`, `uninstall` restores the pre-install bytes verbatim.

`sync --hook` never makes the host tool wait: it reads stdin for at most
200 ms (and ignores it, except `stop_hook_active`), checks the 10-minute
throttle in `~/.thetokentown/last-sync`, hands off to a detached worker and
exits 0 — always, whatever happens. The worker rescans only the sources whose
files changed (per-file cursors in `state.json`; a corrupt state means a full
rescan), posts the full snapshot with a 3-second timeout, and on any failure
leaves it in `queue.json` for the next run. Everything is logged to
`~/.thetokentown/hook.log`, rotated at 1 MB.

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

Everything lives in `~/.thetokentown` (relocate it with `THETOKENTOWN_HOME`):

| File | Holds |
|---|---|
| `config.json` (0600) | the machine uuid, the hook token, handle, site, building, what the hooks changed |
| `state.json` | per-file cursors and the last scan of each source, for the incremental hook |
| `queue.json` | a snapshot that could not be posted; retried by the next sync |
| `last-sync` | the throttle stamp |
| `hook.log`, `hook.log.1` | what the hooks did |
| `bin/` | the Codex notify wrapper, when one was needed |

On Windows the 0600 mode is not enforced by NTFS; the directory inherits the
user profile's ACL instead.

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
