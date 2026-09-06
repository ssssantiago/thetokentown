import assert from "node:assert/strict";
import test from "node:test";

import {
  daysSinceSync,
  decayLevel,
  decayLevelForDays,
  facadeForAge,
  floorsForCost,
  lightsOn,
  underConstruction,
} from "../src/metrics.ts";

const MINUTE = 60_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("floors follow round(10 * log2(1 + cost)) with a floor of 1", () => {
  assert.equal(floorsForCost(0), 1, "no spend still gets a building");
  assert.equal(floorsForCost(1), 10);
  assert.equal(floorsForCost(3), 20, "log2(4) = 2");
  assert.equal(floorsForCost(7), 30, "log2(8) = 3");
  assert.equal(floorsForCost(15), 40);
  assert.equal(floorsForCost(100), 67);
  assert.equal(floorsForCost(0.1), 1, "rounds to 1, never 0");
});

test("floors never return 0 or NaN for degenerate input", () => {
  assert.equal(floorsForCost(-5), 1);
  assert.equal(floorsForCost(Number.NaN), 1);
  assert.equal(floorsForCost(Number.POSITIVE_INFINITY), 1);
});

test("facade tiers change on the documented boundaries", () => {
  assert.equal(facadeForAge(0), "scaffolding");
  assert.equal(facadeForAge(30), "scaffolding");
  assert.equal(facadeForAge(31), "glass");
  assert.equal(facadeForAge(180), "glass");
  assert.equal(facadeForAge(181), "concrete");
  assert.equal(facadeForAge(365), "concrete");
  assert.equal(facadeForAge(366), "stone");
  assert.equal(facadeForAge(4000), "stone");
});

test("decay is flat for 30 days, then one level every 15, capped at 4", () => {
  assert.equal(decayLevelForDays(0), 0);
  assert.equal(decayLevelForDays(29), 0);
  assert.equal(decayLevelForDays(30), 0, "the grace period ends here");
  assert.equal(decayLevelForDays(44), 0);
  assert.equal(decayLevelForDays(45), 1, "SPEC §14: 45 days is level 1");
  assert.equal(decayLevelForDays(59), 1);
  assert.equal(decayLevelForDays(60), 2);
  assert.equal(decayLevelForDays(75), 3);
  assert.equal(decayLevelForDays(89), 3);
  assert.equal(decayLevelForDays(90), 4, "the cap is reached at 90 days");
  assert.equal(decayLevelForDays(900), 4);
});

test("lights follow sync inside a 30 minute window", () => {
  assert.equal(lightsOn(ago(0), NOW), true);
  assert.equal(lightsOn(ago(29 * MINUTE), NOW), true);
  assert.equal(lightsOn(ago(30 * MINUTE), NOW), false, "boundary is exclusive");
  assert.equal(lightsOn(ago(31 * MINUTE), NOW), false);
});

test("lights stay off without a usable sync timestamp", () => {
  assert.equal(lightsOn(null, NOW), false, "a browser upload never lights up");
  assert.equal(lightsOn("not a date", NOW), false);
  assert.equal(lightsOn(new Date(NOW + DAY).toISOString(), NOW), false, "a future sync is not a light");
});

test("the crane shows for 10 minutes after a sync", () => {
  assert.equal(underConstruction(ago(0), NOW), true);
  assert.equal(underConstruction(ago(9 * MINUTE), NOW), true);
  assert.equal(underConstruction(ago(10 * MINUTE), NOW), false);
  assert.equal(underConstruction(null, NOW), false);
});

test("a building 45 days without sync is cracked and dark", () => {
  const lastSync = ago(45 * DAY);
  assert.equal(daysSinceSync(lastSync, NOW), 45);
  assert.equal(decayLevel(lastSync, NOW), 1);
  assert.equal(lightsOn(lastSync, NOW), false);
  assert.equal(underConstruction(lastSync, NOW), false);
});

test("never synced does not decay", () => {
  assert.equal(daysSinceSync(null, NOW), null);
  assert.equal(decayLevel(null, NOW), 0);
});
