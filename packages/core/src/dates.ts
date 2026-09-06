/** Calendar-day helpers. Days are `YYYY-MM-DD` strings compared in UTC. */

const DAY_MS = 86_400_000;
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight UTC for a day string, or NaN when the string is not a real date. */
export function dayToUtcMs(day: string): number {
  if (!DAY_PATTERN.test(day)) return Number.NaN;
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return Number.NaN;
  // Date.parse accepts 2026-02-31 and rolls it over; reject that.
  return toDay(ms) === day ? ms : Number.NaN;
}

export function isValidDay(day: string): boolean {
  return Number.isFinite(dayToUtcMs(day));
}

/** The UTC calendar day of an instant. */
export function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  return toDay(dayToUtcMs(day) + delta * DAY_MS);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayToUtcMs(to) - dayToUtcMs(from)) / DAY_MS);
}
