import assert from "node:assert/strict";
import test from "node:test";

import { addDays, dayToUtcMs, daysBetween, isValidDay, toDay } from "../src/dates.ts";

test("isValidDay accepts real dates and rejects rollovers", () => {
  assert.equal(isValidDay("2026-09-06"), true);
  assert.equal(isValidDay("2024-02-29"), true, "2024 is a leap year");
  assert.equal(isValidDay("2026-02-29"), false, "2026 is not");
  assert.equal(isValidDay("2026-02-31"), false, "Date.parse would roll this to March");
  assert.equal(isValidDay("2026-13-01"), false);
  assert.equal(isValidDay("2026-9-6"), false, "must be zero padded");
  assert.equal(isValidDay("not-a-day"), false);
  assert.ok(Number.isNaN(dayToUtcMs("2026-02-31")));
});

test("toDay reads the UTC calendar day of an instant", () => {
  assert.equal(toDay(Date.parse("2026-09-06T23:59:59.999Z")), "2026-09-06");
  assert.equal(toDay(Date.parse("2026-09-07T00:00:00.000Z")), "2026-09-07");
});

test("addDays crosses months, years and leap days", () => {
  assert.equal(addDays("2026-09-06", 1), "2026-09-07");
  assert.equal(addDays("2026-09-06", -1), "2026-09-05");
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-09-06", 0), "2026-09-06");
});

test("daysBetween is signed and symmetric", () => {
  assert.equal(daysBetween("2026-09-06", "2026-09-06"), 0);
  assert.equal(daysBetween("2026-09-06", "2026-09-07"), 1);
  assert.equal(daysBetween("2026-09-07", "2026-09-06"), -1);
  assert.equal(daysBetween("2026-06-09", "2026-09-06"), 89, "the 90-day window, inclusive");
  assert.equal(daysBetween("2025-09-06", "2026-09-06"), 365);
});
