# The Token Town

Your last 90 days of AI coding, built into a living city.
Height = what you built. Lights on = synced in the last 30 minutes.

```bash
npx thetokentown
```

This is the open-source monorepo. The hosted web app lives in a separate private
repository.

| Package | What it is |
|---|---|
| [`packages/cli`](./packages/cli) | The `thetokentown` CLI. Reads local usage, sends only aggregates. |
| [`packages/core`](./packages/core) | Types, validation, pricing, 90-day aggregation, and the building formulas. |
| `packages/sources` | Per-tool loaders (Claude Code, Codex, Grok, Cursor). |
| `fixtures/` | Anonymized session fixtures per source. |

## Development

Requires Node.js 22.18 or newer and pnpm 10.

```bash
pnpm install
pnpm check      # typecheck + test
```

## Privacy

The CLI never reads or transmits prompts, responses, code, file paths, or project
names. Only per-day, per-provider, per-model numeric aggregates leave the machine.
Run `npx thetokentown --json` to see the exact payload before anything is sent.

Loader behavior for Claude Code, Codex and Grok is adapted from
[ccusage](https://github.com/ryoppippi/ccusage); see
[`packages/cli/THIRD_PARTY_NOTICES.md`](./packages/cli/THIRD_PARTY_NOTICES.md).

MIT © 2026 Santiago
