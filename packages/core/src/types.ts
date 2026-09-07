/** Shared vocabulary for The Token Town. See docs/SPEC.md §4.1 and §5. */

export const PROVIDERS = ["claude", "codex", "grok", "cursor"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const SNAPSHOT_SOURCES = ["cli", "claim", "browser"] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

/** One day of usage for one model of one provider. */
export interface DailyUsage {
  /** YYYY-MM-DD in the machine's local timezone. */
  day: string;
  provider: Provider;
  /** Normalized model id, e.g. "claude-sonnet-4-5". */
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** null when the source gives neither tokens nor turns to price. */
  costUsd: number | null;
  /** true when costUsd was derived rather than reported (Cursor). §5.3 */
  costEstimated: boolean;
  turns: number;
  sessions: number;
}

/** What the CLI or the browser worker sends to the server. */
export interface Snapshot {
  version: 2;
  cliVersion: string;
  /** ISO 8601. */
  generatedAt: string;
  /** uuid from ~/.thetokentown/config.json, or "browser-<random>". */
  machineId: string;
  source: SnapshotSource;
  /** Destination building slug; "main" by default. */
  building: string;
  /** Full aggregated history, never a delta. */
  daily: DailyUsage[];
  /** Lines counted without a dedup key. §6 */
  undedupedLines: number;
}

export const FACADE_TIERS = ["scaffolding", "glass", "concrete", "stone"] as const;
export type FacadeTier = (typeof FACADE_TIERS)[number];

/** Everything the city needs to draw one building. Mirrors `building_stats`. */
export interface BuildingStats {
  cost90d: number;
  output90d: number;
  turns90d: number;
  floors: number;
  /** true when any priced day inside the window was estimated. */
  costEstimated: boolean;
  /** Oldest day in the whole history, not just the window. null when empty. */
  firstDay: string | null;
  lastDay: string | null;
  /** Consecutive days ending today or yesterday (UTC); 0 once it breaks. §5.0 */
  streakDays: number;
  /** Best run anywhere in the history. Never goes down. §5.0 */
  longestStreak: number;
  ageDays: number;
  facade: FacadeTier;
  costByProvider90d: Record<Provider, number>;
  dominantProvider: Provider | null;
  dominantModel: string | null;
  lastSyncAt: string | null;
  lightsOn: boolean;
  decayLevel: number;
  underConstruction: boolean;
}
