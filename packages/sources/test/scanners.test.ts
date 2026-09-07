import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { createSnapshotSchema } from "@thetokentown/core";
import type { Reader } from "../src/reader.ts";
import type { ScanResult } from "../src/types.ts";
import { createFsReader } from "../src/readers/fs.ts";
import { scanClaude, detect as detectClaude } from "../src/scanners/claude.ts";
import { scanCodex } from "../src/scanners/codex.ts";
import { scanGrok } from "../src/scanners/grok.ts";
import { scanCursor, detect as detectCursor } from "../src/scanners/cursor.ts";
import { FIXTURES, NOW, SCAN, directoryHandleFor, fileListReaderFor } from "./helpers.ts";

const fs = createFsReader();
const diskRoot = (...segments: string[]) => join(FIXTURES, ...segments);

interface Adapter {
  name: string;
  reader: () => Promise<Reader>;
  claudeRoot: string;
  codexRoot: string;
  grokRoot: string;
  cursorLog: string;
}

const ADAPTERS: Adapter[] = [
  {
    name: "fs",
    reader: async () => fs,
    claudeRoot: diskRoot("claude", "projects"),
    codexRoot: diskRoot("codex", "sessions"),
    grokRoot: diskRoot("grok", "sessions"),
    cursorLog: diskRoot("cursor", "usage.jsonl"),
  },
  {
    name: "File[] (drop zone)",
    reader: async () => fileListReaderFor("."),
    claudeRoot: "claude/projects",
    codexRoot: "codex/sessions",
    grokRoot: "grok/sessions",
    cursorLog: "cursor/usage.jsonl",
  },
  {
    name: "FileSystemDirectoryHandle (showDirectoryPicker)",
    reader: () => directoryHandleFor("."),
    claudeRoot: "./claude/projects",
    codexRoot: "./codex/sessions",
    grokRoot: "./grok/sessions",
    cursorLog: "./cursor/usage.jsonl",
  },
];

const tokensOf = (result: ScanResult) =>
  result.daily.reduce((sum, row) => sum + row.input + row.output + row.cacheRead + row.cacheWrite, 0);
const costOf = (result: ScanResult) => result.daily.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);

async function scanAll(adapter: Adapter) {
  const reader = await adapter.reader();
  return {
    claude: await scanClaude(reader, [adapter.claudeRoot], SCAN),
    codex: await scanCodex(reader, [adapter.codexRoot], SCAN),
    grok: await scanGrok(reader, [adapter.grokRoot], SCAN),
    cursor: await scanCursor(reader, adapter.cursorLog, SCAN),
  };
}

// ---------------------------------------------------------------- shape

test("every scanner emits DailyUsage rows that pass the v2 schema", async () => {
  const { claude, codex, grok, cursor } = await scanAll(ADAPTERS[0]!);
  const schema = createSnapshotSchema({ now: NOW });

  const daily = [...claude.daily, ...codex.daily, ...grok.daily, ...cursor.daily];
  assert.ok(daily.length > 0);

  const parsed = schema.safeParse({
    version: 2,
    cliVersion: "0.1.0",
    generatedAt: new Date(NOW).toISOString(),
    machineId: "test-machine",
    source: "cli",
    building: "main",
    daily,
    undedupedLines: claude.undedupedLines,
  });
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

test("rows are one per day x provider x model, sorted", async () => {
  const { claude, codex } = await scanAll(ADAPTERS[0]!);
  const rows = [...claude.daily, ...codex.daily];

  const keys = rows.map((row) => `${row.day}|${row.provider}|${row.model}`);
  assert.equal(new Set(keys).size, keys.length, "a (day, provider, model) triple must appear once");

  for (const source of [claude.daily, codex.daily]) {
    const sorted = [...source].sort(
      (a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model),
    );
    assert.deepEqual(source, sorted, "rows must come out in a stable order");
  }
});

test("the fixtures carry the models this machine really uses, all priced", async () => {
  const { claude, codex } = await scanAll(ADAPTERS[0]!);
  const models = new Set([...claude.daily, ...codex.daily].map((row) => row.model));

  assert.ok(models.has("claude-opus-5"));
  assert.ok(models.has("gpt-5.3-codex"), "codex model comes from turn_context");
  assert.equal(claude.unknownModels.size, 0, `unpriced: ${[...claude.unknownModels]}`);
  assert.equal(codex.unknownModels.size, 0, `unpriced: ${[...codex.unknownModels]}`);
  assert.ok(costOf(claude) > 0, "a priced model must produce a cost");
  assert.ok(costOf(codex) > 0);
});

test("the day is computed in the requested zone, not the machine's", async () => {
  const reader = fileListReaderFor(".");
  const utc = await scanClaude(reader, ["claude/projects"], { ...SCAN, timeZone: "UTC" });
  const kiritimati = await scanClaude(reader, ["claude/projects"], {
    ...SCAN,
    timeZone: "Pacific/Kiritimati", // UTC+14
  });

  assert.equal(tokensOf(kiritimati), tokensOf(utc), "the same tokens, only bucketed differently");
  const utcDays = new Set(utc.daily.map((row) => row.day));
  const farDays = new Set(kiritimati.daily.map((row) => row.day));
  assert.notDeepEqual([...farDays].sort(), [...utcDays].sort(), "a +14 zone must shift some day");
});

// ---------------------------------------------------------------- adapters

for (const adapter of ADAPTERS.slice(1)) {
  test(`${adapter.name} produces exactly what fs produces`, async () => {
    const onDisk = await scanAll(ADAPTERS[0]!);
    const other = await scanAll(adapter);

    for (const source of ["claude", "codex", "grok", "cursor"] as const) {
      assert.deepEqual(
        other[source].daily,
        onDisk[source].daily,
        `${source} differs between fs and ${adapter.name}`,
      );
      assert.deepEqual([...other[source].projects].sort(), [...onDisk[source].projects].sort());
    }
  });
}

test("a project name never carries a path separator or an identity", async () => {
  const { claude, codex, grok, cursor } = await scanAll(ADAPTERS[0]!);
  for (const result of [claude, codex, grok, cursor]) {
    for (const project of result.projects) {
      assert.doesNotMatch(project, /[\\/]/, `${project} looks like a path`);
      assert.doesNotMatch(project, /Users|home|santiago|%2F/i, `${project} leaks an identity`);
    }
  }
});

// ---------------------------------------------------------------- claude

test("claude: an exact duplicate is dropped, a keyless line is kept and counted", async () => {
  const usage = { input_tokens: 100, output_tokens: 50 };
  const line = (extra: object) => ({
    type: "assistant",
    timestamp: "2026-09-04T10:00:00.000Z",
    message: { model: "claude-opus-5", usage },
    ...extra,
  });

  const rows = [
    line({ requestId: "req-1", message: { id: "msg-1", model: "claude-opus-5", usage } }),
    line({ requestId: "req-1", message: { id: "msg-1", model: "claude-opus-5", usage } }),
    line({ message: { id: "msg-2", model: "claude-opus-5", usage } }), // no requestId
    line({ requestId: "req-3" }), // no message.id
  ];

  const reader = {
    async list() {
      return [{ path: "p/one.jsonl", relativePath: "one.jsonl", lastModified: 0 }];
    },
    async read() {
      return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    },
  };

  const result = await scanClaude(reader, ["p"], SCAN);
  assert.equal(result.undedupedLines, 2, "both keyless lines are reported");
  assert.equal(tokensOf(result), 450, "three of the four lines survive, 150 each");
});

test("claude: two files with the same base name no longer eat each other's lines", async () => {
  // The old scanner keyed on `basename(file):lineIndex` when a line had no
  // requestId. Two files called session-1.jsonl, both missing requestId at the
  // same line, therefore collided and one line vanished. SPEC §6.
  const row = {
    type: "assistant",
    timestamp: "2026-09-04T10:00:00.000Z",
    message: { id: "msg-shared", model: "claude-opus-5", usage: { input_tokens: 1000, output_tokens: 0 } },
  };
  const body = `${JSON.stringify(row)}\n`;

  const reader = {
    async list() {
      return [
        { path: "alpha/session-1.jsonl", relativePath: "alpha/session-1.jsonl", lastModified: 0 },
        { path: "beta/session-1.jsonl", relativePath: "beta/session-1.jsonl", lastModified: 0 },
      ];
    },
    async read() {
      return body;
    },
  };

  const result = await scanClaude(reader, ["root"], SCAN);
  assert.equal(tokensOf(result), 2000, "both files count; the old key collided and kept only one");
  assert.equal(result.undedupedLines, 2);
  assert.deepEqual([...result.projects].sort(), ["alpha", "beta"]);
});

test("claude: a real duplicated message across two files is still deduplicated", async () => {
  const row = {
    type: "assistant",
    timestamp: "2026-09-04T10:00:00.000Z",
    requestId: "req-9",
    message: { id: "msg-9", model: "claude-opus-5", usage: { input_tokens: 1000, output_tokens: 0 } },
  };
  const body = `${JSON.stringify(row)}\n`;

  const reader = {
    async list() {
      return [
        { path: "alpha/a.jsonl", relativePath: "alpha/a.jsonl", lastModified: 0 },
        { path: "beta/b.jsonl", relativePath: "beta/b.jsonl", lastModified: 0 },
      ];
    },
    async read() {
      return body;
    },
  };

  const result = await scanClaude(reader, ["root"], SCAN);
  assert.equal(tokensOf(result), 1000, "the resumed session must not be counted twice");
  assert.equal(result.undedupedLines, 0);
});

test("claude: real logs always carry both ids, so nothing is counted", async () => {
  const result = await scanClaude(fs, [diskRoot("claude", "projects")], SCAN);
  assert.ok(result.daily.length > 0);
  assert.equal(result.undedupedLines, 0, "the fallback is not reached by real data");
});

test("claude: cache tokens are kept apart from plain input", async () => {
  const result = await scanClaude(fs, [diskRoot("claude", "projects")], SCAN);
  const cacheRead = result.daily.reduce((sum, row) => sum + row.cacheRead, 0);
  assert.ok(cacheRead > 0, "the fixtures do have cache reads");
  assert.ok(
    cacheRead > result.daily.reduce((sum, row) => sum + row.input, 0),
    "cache reads dominate real Claude traffic; they must not be folded into input",
  );
});

// ---------------------------------------------------------------- codex

test("codex: the model comes from turn_context and cached input is not double counted", async () => {
  const rows = [
    { type: "session_meta", timestamp: "2026-09-04T09:00:00.000Z", payload: { cwd: "/work/app" } },
    { type: "turn_context", timestamp: "2026-09-04T09:00:01.000Z", payload: { model: "gpt-5.4" } },
    {
      type: "event_msg",
      timestamp: "2026-09-04T09:00:02.000Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 200, total_tokens: 1200 },
          total_token_usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 200, total_tokens: 1200 },
        },
      },
    },
  ];

  const reader = {
    async list() {
      return [{ path: "s/one.jsonl", relativePath: "one.jsonl", lastModified: 0 }];
    },
    async read() {
      return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    },
  };

  const result = await scanCodex(reader, ["s"], SCAN);
  assert.equal(result.daily.length, 1);
  const row = result.daily[0]!;
  assert.equal(row.model, "gpt-5.4");
  assert.equal(row.cacheRead, 600);
  assert.equal(row.input, 400, "input_tokens already includes the cached part");
  assert.equal(row.output, 200);
  assert.equal(row.input + row.cacheRead + row.output, 1200, "and the total still reconciles");
  assert.deepEqual([...result.projects], ["app"]);
});

test("codex: the cumulative counter is differenced, not summed", async () => {
  const at = (n: number, total: number) => ({
    type: "event_msg",
    timestamp: `2026-09-04T09:0${n}:00.000Z`,
    payload: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: total, output_tokens: 0, total_tokens: total } },
    },
  });
  const rows = [at(1, 1000), at(2, 2500), at(3, 4000)];

  const reader = {
    async list() {
      return [{ path: "s/one.jsonl", relativePath: "one.jsonl", lastModified: 0 }];
    },
    async read() {
      return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    },
  };

  const result = await scanCodex(reader, ["s"], SCAN);
  assert.equal(tokensOf(result), 4000, "the last cumulative value, not 1000+2500+4000");
});

test("codex: sessions and turns are counted per row", async () => {
  const result = await scanCodex(fs, [diskRoot("codex", "sessions")], SCAN);
  assert.ok(result.daily.length > 0);
  for (const row of result.daily) {
    assert.ok(row.turns > 0, "a row with tokens came from at least one turn");
    assert.ok(row.sessions > 0);
    assert.ok(row.sessions <= row.turns);
  }
});

// ---------------------------------------------------------------- grok

test("grok: only turn_completed counts, and the reported cost wins", async () => {
  const result = await scanGrok(fs, [diskRoot("grok", "sessions")], SCAN);

  assert.equal(result.daily.reduce((sum, row) => sum + row.turns, 0), 4, "the turn_started row is skipped");
  assert.deepEqual([...result.projects], ["grok-app"], "the url-encoded cwd becomes a bare basename");

  // costUsdTicks is 1e-10 USD. The fixture's four turns sum to 534,600,000
  // ticks, i.e. $0.05346 — and it must not be re-derived from the token table.
  assert.equal(Number(costOf(result).toFixed(5)), 0.05346);
  assert.ok(result.daily.every((row) => row.costEstimated === false), "an invoice is not an estimate");
});

test("grok: inputTokens includes cache, so cache is subtracted back out", async () => {
  const rows = [
    {
      timestamp: "2026-09-04T12:00:00.000Z",
      sessionUpdate: "turn_completed",
      model: "grok-4.6",
      usage: {
        inputTokens: 10_000,
        cachedReadTokens: 7_000,
        cacheCreationTokens: 1_000,
        outputTokens: 500,
        reasoningTokens: 200,
      },
      costUsdTicks: 1_000_000_000,
    },
  ];

  const reader = {
    async list() {
      return [{ path: "g/%2Fwork%2Fapp/uuid/updates.jsonl", relativePath: "%2Fwork%2Fapp/uuid/updates.jsonl", lastModified: 0 }];
    },
    async read() {
      return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    },
  };

  const result = await scanGrok(reader, ["g"], SCAN);
  const row = result.daily[0]!;
  assert.equal(row.cacheRead, 7_000);
  assert.equal(row.cacheWrite, 1_000);
  assert.equal(row.input, 2_000, "10000 - 7000 - 1000");
  assert.equal(row.output, 500, "reasoningTokens is a subset of output, not an addition");
  assert.equal(row.costUsd, 0.1, "1e9 ticks at 1e-10 USD each");
});

// ---------------------------------------------------------------- cursor

test("cursor: detect() is false and says why in NOTES.md", () => {
  assert.equal(detectCursor(), false);
  assert.equal(detectClaude(["anything"]), true, "the others are not disabled");
});

test("cursor: the reader still works, and its cost is flagged estimated", async () => {
  const result = await scanCursor(fs, diskRoot("cursor", "usage.jsonl"), SCAN);
  assert.equal(result.daily.length, 3);
  for (const row of result.daily) {
    assert.equal(row.costEstimated, true, "SPEC §5.3: a derived cost always carries the asterisk");
    assert.equal(row.cacheRead, 0, "NOTES.md: Cursor reports no cache breakdown at all");
    assert.equal(row.cacheWrite, 0);
    assert.ok((row.costUsd ?? 0) > 0);
  }
});

// ---------------------------------------------------------------- robustness

test("the window is honoured: nothing before `since` survives", async () => {
  const future = { since: Date.parse("2099-01-01T00:00:00.000Z"), now: Date.parse("2099-06-01T00:00:00.000Z") };
  const reader = fileListReaderFor(".");
  assert.deepEqual((await scanClaude(reader, ["claude/projects"], future)).daily, []);
  assert.deepEqual((await scanCodex(reader, ["codex/sessions"], future)).daily, []);
  assert.deepEqual((await scanGrok(reader, ["grok/sessions"], future)).daily, []);
});

test("missing inputs are empty, not a crash", async () => {
  assert.deepEqual((await scanCursor(fs, diskRoot("cursor", "nope.jsonl"), SCAN)).daily, []);
  assert.deepEqual((await scanClaude(fs, [diskRoot("claude", "nope")], SCAN)).daily, []);
  assert.deepEqual((await scanGrok(fs, [diskRoot("grok", "nope")], SCAN)).daily, []);
});

test("malformed and partial lines are skipped, not fatal", async () => {
  const good = {
    type: "assistant",
    timestamp: "2026-09-04T10:00:00.000Z",
    requestId: "req-1",
    message: { id: "msg-1", model: "claude-opus-5", usage: { input_tokens: 100, output_tokens: 50 } },
  };
  const damaged = [
    "{ this is not json",
    JSON.stringify(good),
    '{"type":"assistant","timestamp":"2026-09-04T10:00:00.000Z","message":{"usage":{}}}',
    "",
  ].join("\n");

  const reader = {
    async list() {
      return [{ path: "p/one.jsonl", relativePath: "one.jsonl", lastModified: 0 }];
    },
    async read() {
      return damaged;
    },
  };

  const result = await scanClaude(reader, ["p"], SCAN);
  assert.equal(tokensOf(result), 150, "only the one good line counts");
});

test("scanning the same root twice does not double anything", async () => {
  const once = await scanClaude(fs, [diskRoot("claude", "projects")], SCAN);
  const twice = await scanClaude(
    fs,
    [diskRoot("claude", "projects"), diskRoot("claude", "projects")],
    SCAN,
  );
  assert.equal(tokensOf(twice), tokensOf(once));
});
