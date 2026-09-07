import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import type { Reader } from "../src/reader.ts";
import type { ScanResult } from "../src/types.ts";
import { createFsReader } from "../src/readers/fs.ts";
import { scanClaude } from "../src/scanners/claude.ts";
import { scanCodex } from "../src/scanners/codex.ts";
import { scanCursor } from "../src/scanners/cursor.ts";
import { FIXTURES, SCAN, directoryHandleFor, fileListReaderFor } from "./helpers.ts";

const fs = createFsReader();
const diskRoot = (...segments: string[]) => join(FIXTURES, ...segments);

interface Adapter {
  name: string;
  reader: () => Promise<Reader>;
  claudeRoot: string;
  codexRoot: string;
  cursorLog: string;
}

const ADAPTERS: Adapter[] = [
  {
    name: "fs",
    reader: async () => fs,
    claudeRoot: diskRoot("claude", "projects"),
    codexRoot: diskRoot("codex", "sessions"),
    cursorLog: diskRoot("cursor", "usage.jsonl"),
  },
  {
    name: "File[] (drop zone)",
    reader: async () => fileListReaderFor("."),
    claudeRoot: "claude/projects",
    codexRoot: "codex/sessions",
    cursorLog: "cursor/usage.jsonl",
  },
  {
    name: "FileSystemDirectoryHandle (showDirectoryPicker)",
    reader: () => directoryHandleFor("."),
    claudeRoot: "./claude/projects",
    codexRoot: "./codex/sessions",
    cursorLog: "./cursor/usage.jsonl",
  },
];

const totals = (result: ScanResult) => ({
  events: result.events.length,
  tokens: result.events.reduce((sum, event) => sum + event.tokens, 0),
  projects: [...result.projects].sort(),
  undedupedLines: result.undedupedLines,
  days: [...new Set(result.events.map((e) => new Date(e.timestamp).toISOString().slice(0, 10)))].sort(),
});

async function scanAll(adapter: Adapter) {
  const reader = await adapter.reader();
  return {
    claude: await scanClaude(reader, [adapter.claudeRoot], SCAN),
    codex: await scanCodex(reader, [adapter.codexRoot], SCAN),
    cursor: await scanCursor(reader, adapter.cursorLog, SCAN),
  };
}

test("the fixtures produce real work for every scanner", async () => {
  const { claude, codex, cursor } = await scanAll(ADAPTERS[0]!);

  assert.ok(claude.events.length > 0, "claude fixture is empty");
  assert.ok(codex.events.length > 0, "codex fixture is empty");
  assert.equal(cursor.events.length, 3, "the cursor fixture is the invented one");

  assert.deepEqual([...claude.projects].sort(), ["project-alpha", "project-beta", "project-gamma"]);
  assert.deepEqual(
    [...codex.projects].sort(),
    ["codex-app-1", "codex-app-2", "codex-app-3"],
    "the codex project is the basename of cwd, never the path",
  );
  assert.ok(claude.events.every((event) => event.source === "claude"));
  assert.ok(codex.events.every((event) => event.tokens > 0));
});

for (const adapter of ADAPTERS.slice(1)) {
  test(`${adapter.name} produces exactly what fs produces`, async () => {
    const onDisk = await scanAll(ADAPTERS[0]!);
    const other = await scanAll(adapter);

    for (const source of ["claude", "codex", "cursor"] as const) {
      assert.deepEqual(
        totals(other[source]),
        totals(onDisk[source]),
        `${source} differs between fs and ${adapter.name}`,
      );
    }
  });
}

test("a project name never carries a path separator", async () => {
  const { claude, codex, cursor } = await scanAll(ADAPTERS[0]!);
  for (const result of [claude, codex, cursor]) {
    for (const project of result.projects) {
      assert.doesNotMatch(project, /[\\/]/, `${project} looks like a path`);
      assert.doesNotMatch(project, /Users|home|santiago/i, `${project} leaks an identity`);
    }
  }
});

test("dedup is shared across files, so a re-read changes nothing", async () => {
  const once = await scanClaude(fs, [diskRoot("claude", "projects")], SCAN);
  const twice = await scanClaude(
    fs,
    [diskRoot("claude", "projects"), diskRoot("claude", "projects")],
    SCAN,
  );
  assert.equal(twice.events.length, once.events.length, "the same root twice must not double");
});

test("the window is honoured: nothing before `since` survives", async () => {
  const future = { since: Date.parse("2099-01-01T00:00:00.000Z"), now: Date.parse("2099-06-01T00:00:00.000Z") };
  const reader = fileListReaderFor(".");
  const claude = await scanClaude(reader, ["claude/projects"], future);
  const codex = await scanCodex(reader, ["codex/sessions"], future);
  assert.equal(claude.events.length, 0);
  assert.equal(codex.events.length, 0);
});

test("a missing cursor log is empty, not a crash", async () => {
  const result = await scanCursor(fs, diskRoot("cursor", "does-not-exist.jsonl"), SCAN);
  assert.deepEqual(result.events, []);
  assert.equal(result.undedupedLines, 0);
});

test("a missing claude root is empty, not a crash", async () => {
  const result = await scanClaude(fs, [diskRoot("claude", "nope")], SCAN);
  assert.deepEqual(result.events, []);
});

test("malformed and partial lines are skipped, not fatal", async () => {
  const reader = fileListReaderFor(".");
  const files = await reader.list("claude/projects");
  const first = files[0]!;
  const body = await reader.read(first.path);

  const damaged = [
    "{ this is not json",
    body.split("\n")[0] ?? "",
    '{"type":"assistant","timestamp":"2026-09-04T10:00:00.000Z","message":{"usage":{}}}',
    "",
  ].join("\n");

  const patched = {
    async list() {
      return [{ path: "p/one.jsonl", relativePath: "one.jsonl", lastModified: 0 }];
    },
    async read() {
      return damaged;
    },
  };

  const result = await scanClaude(patched, ["p"], SCAN);
  assert.equal(result.events.length, 1, "only the one good line counts");
});

test("real Claude logs always carry both ids, so nothing is counted", async () => {
  const result = await scanClaude(fs, [diskRoot("claude", "projects")], SCAN);
  assert.ok(result.events.length > 0);
  assert.equal(
    result.undedupedLines,
    0,
    "every line in the fixtures has message.id and requestId — the fallback is not reached by real data",
  );
});

test("a line without a dedup key is counted but still kept", async () => {
  const usage = { input_tokens: 100, output_tokens: 50 };
  const lines = [
    // Both ids: deduplicated normally, and the duplicate is dropped.
    { type: "assistant", timestamp: "2026-09-04T10:00:00.000Z", requestId: "req-1", message: { id: "msg-1", usage } },
    { type: "assistant", timestamp: "2026-09-04T10:00:00.000Z", requestId: "req-1", message: { id: "msg-1", usage } },
    // No requestId: the key becomes synthetic, so it is counted.
    { type: "assistant", timestamp: "2026-09-04T11:00:00.000Z", message: { id: "msg-2", usage } },
    // No message.id either.
    { type: "assistant", timestamp: "2026-09-04T12:00:00.000Z", message: { usage } },
  ];

  const reader = {
    async list() {
      return [{ path: "p/one.jsonl", relativePath: "one.jsonl", lastModified: 0 }];
    },
    async read() {
      return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
    },
  };

  const result = await scanClaude(reader, ["p"], SCAN);
  assert.equal(result.events.length, 3, "the exact duplicate is dropped, the keyless lines are kept");
  assert.equal(result.undedupedLines, 2, "both keyless lines are reported");
  assert.equal(
    result.events.reduce((sum, event) => sum + event.tokens, 0),
    450,
    "150 tokens each for the three kept lines",
  );
});
