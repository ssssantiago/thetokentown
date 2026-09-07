/**
 * The v2 scanners against the behaviour that shipped.
 *
 * Task 3 promised the reader refactor changed nothing, and proved it by
 * spawning the v1 CLI. Task 4 replaced that CLI, so the comparison now runs
 * against `fixtures/v1-baseline.json` — the frozen `--json` output of the v1
 * entry point over these same fixtures, captured before it was retired.
 *
 * Total tokens still match exactly, per source. That is worth stating plainly:
 * **the dedup fix has a zero delta on this data**, because the fallback path it
 * repairs is never reached — every Claude Code line carries both `message.id`
 * and `requestId`. The bug was real but latent; scanners.test.ts reproduces it
 * with a synthetic pair of files that share a base name.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { DailyUsage } from "@thetokentown/core/types";
import { createFsReader } from "../src/readers/fs.ts";
import { scanClaude } from "../src/scanners/claude.ts";
import { scanCodex } from "../src/scanners/codex.ts";
import { scanCursor } from "../src/scanners/cursor.ts";
import { FIXTURES } from "./helpers.ts";

interface Baseline {
  totalTokens: number;
  activeDays: number;
  projectCount: number;
  sources: Array<{ name: string; tokens: number }>;
}

const BASELINE = JSON.parse(
  readFileSync(join(FIXTURES, "v1-baseline.json"), "utf8"),
) as Baseline;

const WINDOW_DAYS = 365;
const DAY_MS = 86_400_000;

const total = (rows: DailyUsage[]) =>
  rows.reduce((sum, row) => sum + row.input + row.output + row.cacheRead + row.cacheWrite, 0);

async function scanEverything() {
  const now = Date.now();
  // The baseline was captured with TZ=UTC, so the window must match.
  const options = { since: now - WINDOW_DAYS * DAY_MS, now, timeZone: "UTC" };
  const fs = createFsReader();

  const [claude, codex, cursor] = await Promise.all([
    scanClaude(fs, [join(FIXTURES, "claude", "projects")], options),
    scanCodex(
      fs,
      [join(FIXTURES, "codex", "sessions"), join(FIXTURES, "codex", "archived_sessions")],
      options,
    ),
    // Called directly: the CLI skips Cursor because detect() is false, but the
    // reader itself must keep matching what v1 produced.
    scanCursor(fs, join(FIXTURES, "cursor", "usage.jsonl"), options),
  ]);

  return { claude, codex, cursor };
}

test("v2 counts the same tokens v1 counted, per source", async () => {
  const { claude, codex, cursor } = await scanEverything();
  const expected = new Map(BASELINE.sources.map((source) => [source.name, source.tokens]));

  assert.ok(total(claude.daily) > 0, "the fixtures must produce a non-trivial total");
  assert.equal(total(claude.daily), expected.get("claude"), "claude tokens");
  assert.equal(total(codex.daily), expected.get("codex"), "codex tokens");
  assert.equal(total(cursor.daily), expected.get("cursor"), "cursor tokens");
});

test("v2 counts the same grand total, active days and projects", async () => {
  const { claude, codex, cursor } = await scanEverything();

  const combined = total(claude.daily) + total(codex.daily) + total(cursor.daily);
  assert.equal(combined, BASELINE.totalTokens, "grand total");

  const days = new Set([...claude.daily, ...codex.daily, ...cursor.daily].map((row) => row.day));
  assert.equal(days.size, BASELINE.activeDays, "active days");

  const projects = new Set([...claude.projects, ...codex.projects, ...cursor.projects]);
  assert.equal(projects.size, BASELINE.projectCount, "project count");
});

test("the dedup fix is a no-op on real data, and says so", async () => {
  const { claude } = await scanEverything();
  assert.equal(
    claude.undedupedLines,
    0,
    "if this ever goes above zero the parity totals above may legitimately move",
  );
});

test("what v2 adds that the v1 summary could not express", async () => {
  const { claude } = await scanEverything();

  // v1 had one number per source. v2 has a row per model per day, with the
  // cache split and a price attached — which is what floors need.
  assert.ok(new Set(claude.daily.map((row) => row.model)).size > 1, "more than one model");
  assert.ok(claude.daily.every((row) => row.costUsd !== null), "every row is priced");
  assert.ok(claude.daily.some((row) => row.cacheRead > 0), "the cache split survives");
  assert.ok(claude.daily.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) > 0, "and costs money");
});
