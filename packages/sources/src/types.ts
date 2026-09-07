import type { DailyUsage, Provider } from "@thetokentown/core/types";

/** grok is wired up from the documented format; cursor is detect()-false. */
export type ScannerSource = Provider;

export interface ScanResult {
  /** One row per day x provider x model. SPEC §4.1 */
  daily: DailyUsage[];
  /** Project names only — never a path. */
  projects: Set<string>;
  /**
   * Lines counted without a dedup key, because the source did not give one.
   * They are still counted; this is the transparency number. SPEC §6.
   */
  undedupedLines: number;
  /** Models with no price in the table. The CLI warns once per run. */
  unknownModels: Set<string>;
}

export interface ScanOptions {
  /** Oldest accepted event, epoch ms. */
  since: number;
  /** Clock, for the "not absurdly in the future" check. */
  now?: number;
  /**
   * IANA zone used to decide which calendar day an event belongs to.
   * SPEC §4.1 says the day is local. Tests pass "UTC" so a result does not
   * depend on the machine that ran it.
   */
  timeZone?: string;
}

export function emptyResult(): ScanResult {
  return {
    daily: [],
    projects: new Set<string>(),
    undedupedLines: 0,
    unknownModels: new Set<string>(),
  };
}
