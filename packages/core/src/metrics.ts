/** The building formulas. See docs/SPEC.md §5. */

import type { FacadeTier } from "./types.ts";

export const WINDOW_DAYS = 90;
export const LIGHTS_ON_MINUTES = 30;
export const UNDER_CONSTRUCTION_MINUTES = 10;
export const DECAY_GRACE_DAYS = 30;
export const DECAY_STEP_DAYS = 15;
export const DECAY_MAX_LEVEL = 4;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * `round(10 * log2(1 + cost90d))`, minimum 1. Every source uses this — Cursor
 * included, via its estimated cost (§5.3).
 */
export function floorsForCost(cost90d: number): number {
  if (!Number.isFinite(cost90d) || cost90d <= 0) return 1;
  return Math.max(1, Math.round(10 * Math.log2(1 + cost90d)));
}

/** 0–30 scaffolding, 31–180 glass, 181–365 concrete, 366+ stone. */
export function facadeForAge(ageDays: number): FacadeTier {
  if (ageDays <= 30) return "scaffolding";
  if (ageDays <= 180) return "glass";
  if (ageDays <= 365) return "concrete";
  return "stone";
}

/** `clamp(floor((daysSinceSync - 30) / 15), 0, 4)`. */
export function decayLevelForDays(daysSinceSync: number): number {
  if (!Number.isFinite(daysSinceSync)) return 0;
  const level = Math.floor((daysSinceSync - DECAY_GRACE_DAYS) / DECAY_STEP_DAYS);
  return Math.min(DECAY_MAX_LEVEL, Math.max(0, level));
}

function minutesSince(instant: string | null, now: number): number | null {
  if (!instant) return null;
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) return null;
  return (now - ms) / MINUTE_MS;
}

/**
 * Lights follow sync, never local activity. A browser upload never lights up
 * because there is no continuing sync to measure (§5.1).
 */
export function lightsOn(lastSyncAt: string | null, now: number = Date.now()): boolean {
  const minutes = minutesSince(lastSyncAt, now);
  return minutes !== null && minutes >= 0 && minutes < LIGHTS_ON_MINUTES;
}

export function underConstruction(lastSyncAt: string | null, now: number = Date.now()): boolean {
  const minutes = minutesSince(lastSyncAt, now);
  return minutes !== null && minutes >= 0 && minutes < UNDER_CONSTRUCTION_MINUTES;
}

/** Whole days since the last sync; never synced counts as never decaying. */
export function daysSinceSync(lastSyncAt: string | null, now: number = Date.now()): number | null {
  if (!lastSyncAt) return null;
  const ms = Date.parse(lastSyncAt);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((now - ms) / DAY_MS));
}

/** Decay measures data freshness, so it applies to every tier (§5.2). */
export function decayLevel(lastSyncAt: string | null, now: number = Date.now()): number {
  const days = daysSinceSync(lastSyncAt, now);
  return days === null ? 0 : decayLevelForDays(days);
}
