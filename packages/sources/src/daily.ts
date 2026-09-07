/** Accumulates raw events into DailyUsage rows. SPEC §4.1, §5.3. */

import type { DailyUsage, Provider } from "@thetokentown/core/types";
import type { Pricer } from "@thetokentown/core/pricing";
import { createPricer } from "@thetokentown/core/pricing";

export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Contribution extends TokenBreakdown {
  /** Epoch ms of the event. */
  timestamp: number;
  provider: Provider;
  model: string;
  turns: number;
  /** Identifies the session, usually the file path. Counted, never emitted. */
  sessionKey: string;
  /**
   * Cost the source reported for this event, if it reports one at all (Grok).
   * When present it wins over the pricing table — an invoice beats an estimate.
   */
  reportedCostUsd?: number | undefined;
  /** Marks the row's cost as derived rather than observed (Cursor). */
  estimated?: boolean | undefined;
}

interface Bucket extends TokenBreakdown {
  day: string;
  provider: Provider;
  model: string;
  turns: number;
  sessions: Set<string>;
  reportedCostUsd: number | null;
  estimated: boolean;
}

/**
 * The calendar day an instant belongs to, in the given zone.
 * `en-CA` formats as YYYY-MM-DD, which is the format the schema wants.
 */
export function dayInZone(ms: number, timeZone?: string | undefined): string {
  return new Date(ms).toLocaleDateString("en-CA", timeZone ? { timeZone } : undefined);
}

export interface DailyAccumulator {
  add(contribution: Contribution): void;
  /** Sorted by day, then provider, then model, so output is deterministic. */
  rows(): DailyUsage[];
  unknownModels: ReadonlySet<string>;
}

export function createDailyAccumulator(options: {
  timeZone?: string | undefined;
  pricer?: Pricer | undefined;
}): DailyAccumulator {
  const pricer = options.pricer ?? createPricer();
  const buckets = new Map<string, Bucket>();

  return {
    add(contribution) {
      const day = dayInZone(contribution.timestamp, options.timeZone);
      // JSON key: a model name could contain any separator we might pick.
      const key = JSON.stringify([day, contribution.provider, contribution.model]);

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          day,
          provider: contribution.provider,
          model: contribution.model,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          turns: 0,
          sessions: new Set<string>(),
          reportedCostUsd: null,
          estimated: false,
        };
        buckets.set(key, bucket);
      }

      bucket.input += contribution.input;
      bucket.output += contribution.output;
      bucket.cacheRead += contribution.cacheRead;
      bucket.cacheWrite += contribution.cacheWrite;
      bucket.turns += contribution.turns;
      bucket.sessions.add(contribution.sessionKey);
      if (contribution.estimated) bucket.estimated = true;
      if (contribution.reportedCostUsd != null) {
        bucket.reportedCostUsd = (bucket.reportedCostUsd ?? 0) + contribution.reportedCostUsd;
      }
    },

    rows() {
      const rows = [...buckets.values()].map((bucket): DailyUsage => {
        const tokens = {
          input: bucket.input,
          output: bucket.output,
          cacheRead: bucket.cacheRead,
          cacheWrite: bucket.cacheWrite,
        };
        const costUsd =
          bucket.reportedCostUsd !== null
            ? bucket.reportedCostUsd
            : pricer.cost(bucket.model, tokens);

        return {
          day: bucket.day,
          provider: bucket.provider,
          model: bucket.model,
          ...tokens,
          costUsd,
          costEstimated: bucket.estimated,
          turns: bucket.turns,
          sessions: bucket.sessions.size,
        };
      });

      rows.sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          a.provider.localeCompare(b.provider) ||
          a.model.localeCompare(b.model),
      );
      return rows;
    },

    unknownModels: pricer.unknownModels,
  };
}
