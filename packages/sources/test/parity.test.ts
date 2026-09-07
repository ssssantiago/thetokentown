/**
 * The refactor promise: moving the scanners behind the reader interface must
 * not change a single number. This runs the shipped CLI and the new package
 * over the same fixtures and compares the totals.
 *
 * When task 4 lands the SPEC §6 dedup fix, this test is expected to fail —
 * that failure is the signal that the behavior changed on purpose.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createFsReader } from "../src/readers/fs.ts";
import { scanClaude } from "../src/scanners/claude.ts";
import { scanCodex } from "../src/scanners/codex.ts";
import { scanCursor } from "../src/scanners/cursor.ts";
import { FIXTURES } from "./helpers.ts";

const CLI = fileURLToPath(new URL("../../cli/bin/thetokentown.mjs", import.meta.url));
const WINDOW_DAYS = 365;
const DAY_MS = 86_400_000;

interface CliSummary {
  totalTokens: number;
  activeDays: number;
  projectCount: number;
  sources: Array<{ name: string; tokens: number }>;
}

function runCli(): CliSummary {
  const result = spawnSync(process.execPath, [CLI, "--json", "--since", String(WINDOW_DAYS)], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(FIXTURES, "claude"),
      CODEX_HOME: join(FIXTURES, "codex"),
      THETOKENTOWN_CURSOR_LOG: join(FIXTURES, "cursor", "usage.jsonl"),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as CliSummary;
}

test("the new scanners reproduce the shipped CLI's totals exactly", async () => {
  const now = Date.now();
  const options = { since: now - WINDOW_DAYS * DAY_MS, now };
  const fs = createFsReader();

  const [claude, codex, cursor] = await Promise.all([
    scanClaude(fs, [join(FIXTURES, "claude", "projects")], options),
    scanCodex(
      fs,
      [join(FIXTURES, "codex", "sessions"), join(FIXTURES, "codex", "archived_sessions")],
      options,
    ),
    scanCursor(fs, join(FIXTURES, "cursor", "usage.jsonl"), options),
  ]);

  const events = [...claude.events, ...codex.events, ...cursor.events];
  const cli = runCli();

  const tokens = events.reduce((sum, event) => sum + event.tokens, 0);
  assert.ok(tokens > 0, "the fixtures must produce a non-trivial total");
  assert.equal(tokens, cli.totalTokens, "total tokens");

  const days = new Set(events.map((e) => new Date(e.timestamp).toISOString().slice(0, 10)));
  assert.equal(days.size, cli.activeDays, "active days");

  const projects = new Set([...claude.projects, ...codex.projects, ...cursor.projects]);
  assert.equal(projects.size, cli.projectCount, "project count");

  const bySource = new Map<string, number>();
  for (const event of events) {
    bySource.set(event.source, (bySource.get(event.source) ?? 0) + event.tokens);
  }
  for (const source of cli.sources) {
    assert.equal(bySource.get(source.name), source.tokens, `${source.name} tokens`);
  }
  assert.equal(bySource.size, cli.sources.length, "same set of sources");
});
