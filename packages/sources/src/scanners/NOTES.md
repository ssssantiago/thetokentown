# Cursor: what its local database actually holds

Investigated 2026-09-06 against **Cursor 3.19.13** on macOS. SPEC §6 and §13.

**Verdict: not usable. `detect()` returns false.**

## Method

`~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` was
**copied to a temp directory together with its `-wal` and `-shm` sidecars** and
opened read-only with `node:sqlite`. The live file is never opened — Cursor
holds it open in WAL mode, and reading it in place risks both a torn read and
interfering with the running editor.

## Schema

Three tables: `ItemTable` (281 rows, VS Code settings), `cursorDiskKV`
(25,782 rows, the interesting one) and `composerHeaders` (14 rows).

`cursorDiskKV` keys are `<prefix>:<id>`. The prefixes that matter:

| Prefix | Rows | What it holds |
|---|---|---|
| `bubbleId:<composerId>:<bubbleId>` | 7,697 | one chat message |
| `composerData:<composerId>` | 64 | one conversation |
| `agentKv:*` | 15,792 | agent scratch state, no usage |

A `bubbleId` record has ~70 top-level fields. The three that matter:

```
createdAt                        ISO 8601 string, present on all 7,697
modelInfo.modelName              e.g. "gpt-5.3-codex", "grok-code-fast-1"
tokenCount.inputTokens           number
tokenCount.outputTokens          number
```

`composerHeaders` carries `composerId`, `createdAt` and `lastUpdatedAt` as
epoch milliseconds, so a conversation can be dated even without its bubbles.

## Why it is not usable

**`tokenCount` is present on every message and zero on almost all of them.**

```
bubbles total                : 7697
  with createdAt             : 7697   (100%)
  with a tokenCount object   : 7697   (100%)
  with tokenCount > 0        :    6   (0.08%)
```

The six exceptions are all from a single day (2026-02-03), are all assistant
messages, and none of them carries a `modelInfo.modelName`. Together they
account for ~1.1M tokens against months of real use — noise, not a signal.

`composerData.usageData` exists on all 64 conversations and is `{}` in every
one of them.

So the schema is there and the writer is not: Cursor allocates the field and
leaves it at zero. There is nothing to backfill and nothing to read going
forward. This matches what the README already told users — Cursor "no longer
keeps complete historical token totals in its standard local database".

## The cache question, answered by the data

Open question #18 was whether a Cursor token total should include cache reads
and writes. It is moot: **`tokenCount` has exactly two members, `inputTokens`
and `outputTokens`.** Zero of the 7,697 records carried any third field. There
is no cache breakdown to include or exclude.

If Cursor ever starts writing these numbers, the rule is therefore forced:

```
tokens     = inputTokens + outputTokens
cacheRead  = 0
cacheWrite = 0
costUsd    = estimateCursorCostUsd({ tokens })   // costEstimated: true
```

## The other path, and why it is also dead

`~/.cursor/token-usage/usage.jsonl` is an append-only log written by a Cursor
**stop hook**. The scanner reads it and the format works, but nothing installs
that hook yet (SPEC §7, task 10), so the file does not exist on this machine.
Even once it does it cannot backfill: it starts counting at install.

## What would change the verdict

1. A Cursor release that actually populates `tokenCount`. Re-run the counts
   above; if the zero rate drops, the reader is a few lines away — `createdAt`
   and `modelInfo.modelName` are already there and already correct.
2. Shipping the stop hook (task 10), which gives forward-looking data only.

Until one of those happens, `detect()` stays false and `/how` says "soon".
