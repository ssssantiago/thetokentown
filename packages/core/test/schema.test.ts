import assert from "node:assert/strict";
import test from "node:test";

import type { DailyUsage, Snapshot } from "../src/types.ts";
import {
  MAX_COST_PER_DAY_PROVIDER,
  MAX_DAILY_ROWS,
  MAX_TOKENS_PER_DAY_PROVIDER,
  createSnapshotSchema,
} from "../src/schema.ts";

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const schema = createSnapshotSchema({ now: NOW });

function row(overrides: Partial<DailyUsage> = {}): DailyUsage {
  return {
    day: "2026-09-05",
    provider: "claude",
    model: "claude-sonnet-4-5",
    input: 1000,
    output: 500,
    cacheRead: 200,
    cacheWrite: 100,
    costUsd: 0.012,
    costEstimated: false,
    turns: 4,
    sessions: 1,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 2,
    cliVersion: "0.1.0",
    generatedAt: "2026-09-06T11:59:00.000Z",
    machineId: "6b1f6d0e-2a1c-4a3f-9a0e-1f2b3c4d5e6f",
    source: "cli",
    building: "main",
    daily: [row()],
    undedupedLines: 0,
    ...overrides,
  };
}

const reasons = (value: unknown): string => {
  const result = schema.safeParse(value);
  return result.success ? "" : JSON.stringify(result.error.issues);
};

test("a well formed snapshot is accepted", () => {
  const result = schema.safeParse(snapshot());
  assert.equal(result.success, true, reasons(snapshot()));
});

test("an empty day list is fine — a reserved plot has no usage yet", () => {
  assert.equal(schema.safeParse(snapshot({ daily: [] })).success, true);
});

test("only version 2 is accepted", () => {
  assert.equal(schema.safeParse({ ...snapshot(), version: 1 }).success, false);
  assert.equal(schema.safeParse({ ...snapshot(), version: 3 }).success, false);
});

test("the provider must be one of the four known sources", () => {
  assert.equal(schema.safeParse(snapshot({ daily: [row({ provider: "gemini" as never })] })).success, false);
  for (const provider of ["claude", "codex", "grok", "cursor"] as const) {
    assert.equal(schema.safeParse(snapshot({ daily: [row({ provider })] })).success, true, provider);
  }
});

test("negative and fractional metrics are rejected", () => {
  assert.equal(schema.safeParse(snapshot({ daily: [row({ input: -1 })] })).success, false);
  assert.equal(schema.safeParse(snapshot({ daily: [row({ turns: -3 })] })).success, false);
  assert.equal(schema.safeParse(snapshot({ daily: [row({ output: 1.5 })] })).success, false);
  assert.equal(schema.safeParse(snapshot({ daily: [row({ costUsd: -0.01 })] })).success, false);
  assert.equal(schema.safeParse(snapshot({ undedupedLines: -1 })).success, false);
});

test("costUsd may be null when the source cannot price anything", () => {
  assert.equal(schema.safeParse(snapshot({ daily: [row({ costUsd: null })] })).success, true);
});

test("days before 2025-01-01 are rejected", () => {
  assert.equal(schema.safeParse(snapshot({ daily: [row({ day: "2024-12-31" })] })).success, false);
  assert.equal(schema.safeParse(snapshot({ daily: [row({ day: "2025-01-01" })] })).success, true);
});

test("a day may run one ahead of UTC but no further", () => {
  assert.equal(schema.safeParse(snapshot({ daily: [row({ day: "2026-09-06" })] })).success, true, "today");
  assert.equal(
    schema.safeParse(snapshot({ daily: [row({ day: "2026-09-07" })] })).success,
    true,
    "UTC+13 can legitimately be a day ahead",
  );
  assert.equal(schema.safeParse(snapshot({ daily: [row({ day: "2026-09-08" })] })).success, false);
});

test("malformed days are rejected before any window check", () => {
  for (const day of ["2026-02-31", "2026-9-6", "06/09/2026", ""]) {
    assert.equal(schema.safeParse(snapshot({ daily: [row({ day })] })).success, false, day);
  }
});

test("the token ceiling is per day and per provider, summed across models", () => {
  const half = MAX_TOKENS_PER_DAY_PROVIDER / 2;

  const under = snapshot({
    daily: [
      row({ model: "a", input: half, output: 0 }),
      row({ model: "b", input: half, output: 0 }),
    ],
  });
  assert.equal(schema.safeParse(under).success, true, "exactly at the ceiling is allowed");

  const over = snapshot({
    daily: [
      row({ model: "a", input: half, output: 0 }),
      row({ model: "b", input: half, output: 1 }),
    ],
  });
  assert.equal(schema.safeParse(over).success, false);
});

test("the same tokens split across providers or days stay under the ceiling", () => {
  const half = MAX_TOKENS_PER_DAY_PROVIDER / 2;
  const twoProviders = snapshot({
    daily: [
      row({ provider: "claude", input: half, output: 1 }),
      row({ provider: "codex", input: half, output: 1 }),
    ],
  });
  assert.equal(schema.safeParse(twoProviders).success, true);

  const twoDays = snapshot({
    daily: [
      row({ day: "2026-09-04", input: half, output: 1 }),
      row({ day: "2026-09-05", input: half, output: 1 }),
    ],
  });
  assert.equal(schema.safeParse(twoDays).success, true);
});

test("the cost ceiling is per day and per provider", () => {
  const atCeiling = snapshot({ daily: [row({ costUsd: MAX_COST_PER_DAY_PROVIDER })] });
  assert.equal(schema.safeParse(atCeiling).success, true);

  const over = snapshot({
    daily: [
      row({ model: "a", costUsd: MAX_COST_PER_DAY_PROVIDER }),
      row({ model: "b", costUsd: 0.01 }),
    ],
  });
  assert.equal(schema.safeParse(over).success, false);
});

test("the day list is capped", () => {
  const many = Array.from({ length: MAX_DAILY_ROWS + 1 }, (_, index) => row({ model: `m-${index}` }));
  assert.equal(schema.safeParse(snapshot({ daily: many })).success, false);
});

test("the building slug must match ^[a-z0-9-]{1,20}$", () => {
  const twenty = "0123456789-012345678";
  assert.equal(twenty.length, 20, "the boundary fixture must really be 20 characters");

  for (const building of ["main", "work", "a", "a-b-c", twenty]) {
    assert.equal(schema.safeParse(snapshot({ building })).success, true, building);
  }
  for (const building of ["", "Main", "with space", "acento-é", `${twenty}9`, "a/b", "a_b"]) {
    assert.equal(schema.safeParse(snapshot({ building })).success, false, JSON.stringify(building));
  }
});

test("generatedAt must be a real instant and source must be known", () => {
  assert.equal(schema.safeParse(snapshot({ generatedAt: "yesterday" })).success, false);
  assert.equal(schema.safeParse(snapshot({ source: "carrier-pigeon" as never })).success, false);
  for (const source of ["cli", "claim", "browser"] as const) {
    assert.equal(schema.safeParse(snapshot({ source })).success, true, source);
  }
});

test("machineId and cliVersion are required and bounded", () => {
  assert.equal(schema.safeParse(snapshot({ machineId: "" })).success, false);
  assert.equal(schema.safeParse(snapshot({ cliVersion: "" })).success, false);
  assert.equal(schema.safeParse(snapshot({ machineId: "x".repeat(129) })).success, false);
  assert.equal(schema.safeParse(snapshot({ machineId: "browser-9f2c1a" })).success, true);
});

test("the parsed value carries no path-like content", () => {
  const parsed = schema.parse(snapshot());
  const serialized = JSON.stringify(parsed.daily);
  for (const forbidden of ["/", "~", "Users", "home", "@"]) {
    assert.equal(serialized.includes(forbidden), false, `daily leaked ${forbidden}`);
  }
});
