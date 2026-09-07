import type { Provider } from "@thetokentown/core";

/** A scanner source is a Provider; grok is not wired up yet (task 4). */
export type ScannerSource = Extract<Provider, "claude" | "codex" | "cursor">;

/**
 * The raw event shape the current CLI produces. Task 4 replaces this with
 * `DailyUsage` (per provider, per model, with cost); until then the scanners
 * emit exactly what `bin/thetokentown.mjs` emits, and a parity test proves it.
 */
export interface UsageEvent {
  timestamp: number;
  tokens: number;
  source: ScannerSource;
  project: string;
}

export interface ScanResult {
  events: UsageEvent[];
  projects: Set<string>;
  /**
   * Lines counted with a synthetic dedup key because `message.id` or
   * `requestId` was missing. Observational only — it does not change which
   * events are kept. See docs/SPEC.md §6.
   */
  undedupedLines: number;
}

export interface ScanOptions {
  /** Oldest accepted event, epoch ms. */
  since: number;
  /** Clock, for the "not absurdly in the future" check. */
  now?: number;
}

export function emptyResult(): ScanResult {
  return { events: [], projects: new Set<string>(), undedupedLines: 0 };
}
