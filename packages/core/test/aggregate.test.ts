import assert from "node:assert/strict";
import test from "node:test";

import type { DailyUsage } from "../src/types.ts";
import { aggregate, windowStart } from "../src/aggregate.ts";

const TODAY = "2026-09-06";
const NOW = Date.parse(`${TODAY}T12:00:00.000Z`);
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function row(overrides: Partial<DailyUsage> = {}): DailyUsage {
  return {
    day: TODAY,
    provider: "claude",
    model: "claude-sonnet-4-5",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: 0,
    costEstimated: false,
    turns: 0,
    sessions: 0,
    ...overrides,
  };
}

const at = (daily: DailyUsage[], lastSyncAt: string | null = ago(0)) =>
  aggregate(daily, { today: TODAY, now: NOW, lastSyncAt });

test("the window is 90 calendar days, inclusive of today", () => {
  assert.equal(windowStart(TODAY), "2026-06-09");
});

test("an empty history is a valid one-floor plot, not a crash", () => {
  const stats = at([], null);
  assert.equal(stats.floors, 1);
  assert.equal(stats.cost90d, 0);
  assert.equal(stats.firstDay, null);
  assert.equal(stats.lastDay, null);
  assert.equal(stats.ageDays, 0);
  assert.equal(stats.streakDays, 0);
  assert.equal(stats.facade, "scaffolding");
  assert.equal(stats.dominantProvider, null);
  assert.equal(stats.dominantModel, null);
  assert.equal(stats.lightsOn, false);
  assert.equal(stats.decayLevel, 0);
  assert.deepEqual(stats.costByProvider90d, { claude: 0, codex: 0, grok: 0, cursor: 0 });
});

test("cost, output and turns only count inside the window", () => {
  const stats = at([
    row({ day: "2026-06-09", costUsd: 1, output: 10, turns: 1 }),
    row({ day: "2026-06-08", costUsd: 100, output: 999, turns: 99 }),
  ]);
  assert.equal(stats.cost90d, 1, "2026-06-08 is one day outside the window");
  assert.equal(stats.output90d, 10);
  assert.equal(stats.turns90d, 1);
});

test("age spans the whole history even when the old days fall outside the window", () => {
  const stats = at([
    row({ day: "2025-09-06", costUsd: 5 }),
    row({ day: TODAY, costUsd: 5 }),
  ]);
  assert.equal(stats.firstDay, "2025-09-06");
  assert.equal(stats.lastDay, TODAY);
  assert.equal(stats.ageDays, 365);
  assert.equal(stats.facade, "concrete");
  assert.equal(stats.cost90d, 5, "only the in-window day is priced");
});

test("floors come from the windowed cost", () => {
  assert.equal(at([row({ costUsd: 7 })]).floors, 30);
  assert.equal(at([row({ costUsd: 3 }), row({ model: "other", costUsd: 4 })]).floors, 30, "3 + 4");
});

test("the streak counts consecutive days back from the most recent one", () => {
  const stats = at([
    row({ day: "2026-09-06" }),
    row({ day: "2026-09-05" }),
    row({ day: "2026-09-04" }),
    row({ day: "2026-09-01" }),
  ]);
  assert.equal(stats.streakDays, 3, "the gap on 09-02/09-03 ends the streak");
});

test("several rows on one day are still a single streak day", () => {
  const stats = at([
    row({ day: "2026-09-06", provider: "claude" }),
    row({ day: "2026-09-06", provider: "codex" }),
  ]);
  assert.equal(stats.streakDays, 1);
});

test("a stale streak is measured from the last active day, not from today", () => {
  const stats = at([row({ day: "2026-08-01" }), row({ day: "2026-07-31" })]);
  assert.equal(stats.lastDay, "2026-08-01");
  assert.equal(stats.streakDays, 2);
});

test("the dominant provider and model are the most expensive ones", () => {
  const stats = at([
    row({ provider: "claude", model: "claude-sonnet-4-5", costUsd: 2 }),
    row({ provider: "codex", model: "gpt-5-codex", costUsd: 9 }),
    row({ provider: "grok", model: "grok-4", costUsd: 1 }),
  ]);
  assert.equal(stats.dominantProvider, "codex");
  assert.equal(stats.dominantModel, "gpt-5-codex");
  assert.deepEqual(stats.costByProvider90d, { claude: 2, codex: 9, grok: 1, cursor: 0 });
});

test("with no cost anywhere the dominant provider falls back to tokens", () => {
  const stats = at([
    row({ provider: "claude", costUsd: null, input: 10 }),
    row({ provider: "cursor", costUsd: null, input: 5000 }),
  ]);
  assert.equal(stats.dominantProvider, "cursor");
});

test("estimated cost flags the building only when it actually contributed", () => {
  assert.equal(at([row({ costUsd: 5, costEstimated: false })]).costEstimated, false);
  assert.equal(at([row({ provider: "cursor", costUsd: 5, costEstimated: true })]).costEstimated, true);
  assert.equal(
    at([row({ provider: "cursor", costUsd: 0, costEstimated: true })]).costEstimated,
    false,
    "an estimate worth nothing should not put an asterisk on the card",
  );
  assert.equal(
    at([row({ costUsd: 5 }), row({ provider: "cursor", costUsd: 1, costEstimated: true })]).costEstimated,
    true,
    "any estimated layer marks the whole building",
  );
});

test("an estimated cursor day outside the window does not flag the building", () => {
  const stats = at([
    row({ day: "2026-06-08", provider: "cursor", costUsd: 50, costEstimated: true }),
    row({ day: TODAY, costUsd: 5 }),
  ]);
  assert.equal(stats.costEstimated, false);
});

test("SPEC §14: 45 days without sync is decay 1 with the lights off", () => {
  const stats = at([row({ day: "2026-07-23", costUsd: 20 })], ago(45));
  assert.equal(stats.decayLevel, 1);
  assert.equal(stats.lightsOn, false);
  assert.equal(stats.underConstruction, false);
  assert.ok(stats.floors > 1, "a cracked building still keeps the floors it earned");
});

test("a fresh sync lights the windows and raises the crane", () => {
  const stats = at([row({ costUsd: 20 })], ago(0));
  assert.equal(stats.lightsOn, true);
  assert.equal(stats.underConstruction, true);
  assert.equal(stats.decayLevel, 0);
});

test("a browser upload has data but no lights", () => {
  // SPEC §5.1: tier 1 never lights up, because there is no continuing sync.
  const stats = at([row({ costUsd: 20 })], null);
  assert.equal(stats.lightsOn, false);
  assert.equal(stats.underConstruction, false);
  assert.ok(stats.floors > 1);
});
