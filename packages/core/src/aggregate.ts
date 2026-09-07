/** 90-day aggregation: DailyUsage[] -> BuildingStats. See docs/SPEC.md §4.3, §5. */

import type { BuildingStats, DailyUsage, Provider } from "./types.ts";
import { PROVIDERS } from "./types.ts";
import { addDays, daysBetween, toDay } from "./dates.ts";
import {
  WINDOW_DAYS,
  decayLevel,
  facadeForAge,
  floorsForCost,
  lightsOn,
  underConstruction,
} from "./metrics.ts";

export interface AggregateOptions {
  /** UTC day the window ends on. Defaults to today. */
  today?: string;
  /** ISO instant of the last successful sync. Drives lights and decay. */
  lastSyncAt?: string | null;
  /** Clock for lights, decay and construction. Defaults to Date.now(). */
  now?: number;
}

/** First day of the 90-day window, inclusive of `today`. */
export function windowStart(today: string): string {
  return addDays(today, -(WINDOW_DAYS - 1));
}

function emptyByProvider(): Record<Provider, number> {
  const totals = {} as Record<Provider, number>;
  for (const provider of PROVIDERS) totals[provider] = 0;
  return totals;
}

/**
 * Two numbers, because one alone lies eventually (§5.0):
 * the current run, which must reach today or yesterday to count at all, and
 * the best run in the whole history, which never goes down.
 */
export function streaks(
  activeDays: ReadonlySet<string>,
  today: string,
): { streakDays: number; longestStreak: number } {
  if (activeDays.size === 0) return { streakDays: 0, longestStreak: 0 };

  const sorted = [...activeDays].sort();

  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    run = daysBetween(previous, current) === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }

  // Yesterday still counts: someone who coded past midnight should not lose
  // the streak to the server's timezone.
  const yesterday = addDays(today, -1);
  let cursor = activeDays.has(today) ? today : activeDays.has(yesterday) ? yesterday : null;

  let streakDays = 0;
  while (cursor !== null && activeDays.has(cursor)) {
    streakDays += 1;
    cursor = addDays(cursor, -1);
  }

  return { streakDays, longestStreak };
}

/** Largest value wins; cost first, tokens as tie-break, insertion order last. */
function topKey<K>(cost: Map<K, number>, tokens: Map<K, number>): K | null {
  let best: K | null = null;
  let bestCost = -1;
  let bestTokens = -1;
  for (const [key, keyCost] of cost) {
    const keyTokens = tokens.get(key) ?? 0;
    if (keyCost > bestCost || (keyCost === bestCost && keyTokens > bestTokens)) {
      best = key;
      bestCost = keyCost;
      bestTokens = keyTokens;
    }
  }
  return best;
}

export function aggregate(daily: DailyUsage[], options: AggregateOptions = {}): BuildingStats {
  const now = options.now ?? Date.now();
  const today = options.today ?? toDay(now);
  const lastSyncAt = options.lastSyncAt ?? null;
  const start = windowStart(today);

  let cost90d = 0;
  let output90d = 0;
  let turns90d = 0;
  let costEstimated = false;

  let firstDay: string | null = null;
  let lastDay: string | null = null;

  const activeDays = new Set<string>();
  const costByProvider90d = emptyByProvider();
  const providersInWindow = new Set<Provider>();
  const tokensByProvider = new Map<Provider, number>();
  const costByModel = new Map<string, number>();
  const tokensByModel = new Map<string, number>();

  for (const row of daily) {
    // Age spans the whole history, not just the window.
    if (firstDay === null || row.day < firstDay) firstDay = row.day;
    if (lastDay === null || row.day > lastDay) lastDay = row.day;
    activeDays.add(row.day);

    if (row.day < start) continue;

    const cost = row.costUsd ?? 0;
    const tokens = row.input + row.output;

    cost90d += cost;
    output90d += row.output;
    turns90d += row.turns;
    if (row.costEstimated && cost > 0) costEstimated = true;

    costByProvider90d[row.provider] += cost;
    providersInWindow.add(row.provider);
    tokensByProvider.set(row.provider, (tokensByProvider.get(row.provider) ?? 0) + tokens);
    costByModel.set(row.model, (costByModel.get(row.model) ?? 0) + cost);
    tokensByModel.set(row.model, (tokensByModel.get(row.model) ?? 0) + tokens);
  }

  const ageDays = firstDay === null ? 0 : Math.max(0, daysBetween(firstDay, today));

  const { streakDays, longestStreak } = streaks(activeDays, today);

  // Only providers that actually appear in the window can be dominant, so a
  // building with no usage reports null instead of the first enum member.
  const costByProviderMap = new Map<Provider, number>(
    PROVIDERS.filter((provider) => providersInWindow.has(provider)).map((provider) => [
      provider,
      costByProvider90d[provider],
    ]),
  );

  return {
    cost90d,
    output90d,
    turns90d,
    floors: floorsForCost(cost90d),
    costEstimated,
    firstDay,
    lastDay,
    streakDays,
    longestStreak,
    ageDays,
    facade: facadeForAge(ageDays),
    costByProvider90d,
    dominantProvider: topKey(costByProviderMap, tokensByProvider),
    dominantModel: topKey(costByModel, tokensByModel),
    lastSyncAt,
    lightsOn: lightsOn(lastSyncAt, now),
    decayLevel: decayLevel(lastSyncAt, now),
    underConstruction: underConstruction(lastSyncAt, now),
  };
}
