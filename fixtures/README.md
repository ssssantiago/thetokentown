# fixtures

Real Claude Code and Codex sessions from the author's machine, run through
[`scripts/anonymize-fixtures.mjs`](../scripts/anonymize-fixtures.mjs) before
being committed. This directory is public.

## What survives

Only four kinds of thing, and even those are transformed:

| Kept | How it is transformed |
|---|---|
| Token usage | verbatim — it is the whole point |
| Timestamps | time of day verbatim; the sorted distinct days are remapped onto consecutive days ending `2026-09-05` |
| Ids | remapped to `msg-N` / `req-N` in first-seen order — dedup depends on ids being *distinct*, never on their values |
| Model names | verbatim — needed by the pricing matcher |

Project directories are renamed to `project-alpha`/`-beta`/`-gamma`, because the
real names under `~/.claude/projects` are encoded absolute paths. The Codex
`cwd` becomes `/work/codex-app-N`; only its basename ever reaches a scanner.

## What never appears

Message content, prompts, responses, file paths, file names, repository URLs,
commit hashes, branch names, session ids, uuids, `base_instructions`, rate
limits, tool names, CLI versions. The script is an allow-list: a field it does
not recognize is dropped, not kept.

## Why the dates are remapped

The scanners take a `since` window. With real dates the fixtures would quietly
fall out of any 90-day window a few months from now, and the tests would keep
passing while asserting nothing.

## cursor/usage.jsonl is invented

There is no `~/.cursor/token-usage/usage.jsonl` on the author's machine — that
file only exists once a Cursor stop hook writes it, and nothing installs the
hook yet. Those three lines are synthetic and are the only fabricated data here.

## Regenerating

```bash
node scripts/anonymize-fixtures.mjs           # rebuild from the local logs
node scripts/anonymize-fixtures.mjs --check   # CI: fail if the tree drifted
```

The output depends on the machine it runs on, so regenerating on a different
machine will legitimately produce a different `manifest.json`.
