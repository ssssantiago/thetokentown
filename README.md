# TokenTown CLI

Turn your last 90 days of AI coding into a building in [TokenTown](https://token-town.santitiago.chatgpt.site).

- Building height = tokens used
- Windows = active coding days
- Footprint = projects
- Lights on = coding within the last 10 minutes

```bash
npx github:ssssantiago/tokentown
```

The GitHub invocation is temporary while the final npm package name is selected.

The zero-dependency CLI reads local logs from Claude Code and Codex. Cursor activity is supported when a compatible stop hook writes its usage log.

It never includes prompt text, responses, file contents, file names, repository names, or code in the claim. The payload contains only daily token totals, tool names, number of projects, and the most recent activity timestamp.

Cursor no longer keeps complete historical token totals in its standard local database. TokenTown detects the append-only `~/.cursor/token-usage/usage.jsonl` format created by Cursor stop hooks; this tracks activity after the hook is installed and cannot backfill earlier sessions.

Use `npx tokentown --json` to inspect the exact aggregate before opening a claim. No API keys are required.

## Options

```text
--json          print the aggregate without opening a claim
--demo          preview TokenTown with safe demo data
--no-open       do not open a browser
--since <days>  change the activity window (default: 90)
--site <url>    override the TokenTown site URL
```

## Development

```bash
npm install
npm test
node bin/tokentown.mjs --demo --no-open
```

The hosted TokenTown product is proprietary and is not part of this repository. This repository contains only the open-source local CLI.

Token parsing follows the data-loading behavior of [ccusage](https://github.com/ryoppippi/ccusage), with attribution preserved in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

MIT © 2026 Santiago
