/**
 * Cursor. Emits DailyUsage per day x model, with an estimated cost. SPEC §5.3.
 *
 * `detect()` returns FALSE and will keep returning false until one of two
 * things happens. The investigation is written up in NOTES.md; the summary:
 *
 *  - Cursor 3.19.13's own database allocates `tokenCount` on every message and
 *    leaves it at zero on 7,691 of 7,697 of them, so there is nothing to read.
 *  - `~/.cursor/token-usage/usage.jsonl` is written by a stop hook that nothing
 *    installs yet (task 10), and even then it cannot backfill.
 *
 * The reader below is kept working so that the day the hook ships, or the day
 * Cursor starts writing its own counters, this is a one-line change.
 *
 * NOTES.md also settles the cache question: Cursor's `tokenCount` has exactly
 * two members, `inputTokens` and `outputTokens`. There is no cache breakdown to
 * include, so cacheRead and cacheWrite are 0 and the cost is estimated from the
 * plain total.
 */

import type { Reader } from "../reader.ts";
import { readLines } from "../reader.ts";
import { estimateCursorCostUsd } from "@thetokentown/core/pricing";
import { createDailyAccumulator } from "../daily.ts";
import type { ScanOptions, ScanResult } from "../types.ts";
import { emptyResult } from "../types.ts";
import { numeric, parseLine, pick, validTimestamp } from "./shared.ts";

const UNKNOWN_MODEL = "unknown";
const MAX_WORKSPACE_LENGTH = 160;

/** False until Cursor writes usable numbers. See NOTES.md. */
export function detect(): boolean {
  return false;
}

export async function scanCursor(
  reader: Reader,
  logPath: string,
  options: ScanOptions,
): Promise<ScanResult> {
  const result = emptyResult();
  const daily = createDailyAccumulator({ timeZone: options.timeZone });

  let lines: AsyncIterable<string>;
  try {
    lines = readLines(reader, logPath);
  } catch {
    return result;
  }

  try {
    for await (const line of lines) {
      if (!line.includes("total_tokens") && !line.includes("totalTokens")) continue;

      const entry = parseLine(line);
      if (entry === null) continue;

      const timestamp = validTimestamp(pick(entry, "ts") ?? pick(entry, "timestamp"), options);
      const tokens = numeric(pick(entry, "total_tokens") ?? pick(entry, "totalTokens"));
      if (!timestamp || !tokens) continue;

      const project = String(pick(entry, "workspace") ?? "cursor-workspace").slice(
        0,
        MAX_WORKSPACE_LENGTH,
      );
      const model = pick(entry, "model");

      result.projects.add(project);
      daily.add({
        timestamp,
        provider: "cursor",
        model: typeof model === "string" && model ? model : UNKNOWN_MODEL,
        // The log reports one number. NOTES.md: there is no cache split to make.
        input: tokens,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        turns: 1,
        sessionKey: logPath,
        reportedCostUsd: estimateCursorCostUsd({ tokens }) ?? undefined,
        estimated: true,
      });
    }
  } catch {
    // A missing log is the normal case, not an error.
    return result;
  }

  result.daily = daily.rows();
  for (const unknown of daily.unknownModels) result.unknownModels.add(unknown);
  return result;
}
