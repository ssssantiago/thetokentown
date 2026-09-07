/**
 * Grok CLI. Emits DailyUsage per day x model. SPEC §6.
 *
 * **community-tested**: written from the format ccusage documents, not from a
 * capture of a real session. Nobody on this project has run it against real
 * Grok data. See fixtures/README.md.
 *
 * Layout:  $GROK_HOME/sessions/<url-encoded-cwd>/<session-uuid>/updates.jsonl
 * Filter:  sessionUpdate === "turn_completed"
 * Tokens:  inputTokens (INCLUDES cache), cachedReadTokens, cacheCreationTokens,
 *          outputTokens, reasoningTokens (a subset of output — not added)
 * Cost:    costUsdTicks, in units of 1e-10 USD
 */

import type { Reader } from "../reader.ts";
import { firstSegment, readLines } from "../reader.ts";
import { createDailyAccumulator } from "../daily.ts";
import type { ScanOptions, ScanResult } from "../types.ts";
import { emptyResult } from "../types.ts";
import { asRecord, jsonlFiles, numeric, parseLine, pick, validTimestamp } from "./shared.ts";

const UNKNOWN_MODEL = "unknown";
/** costUsdTicks is in units of 1e-10 USD. */
const TICKS_PER_USD = 1e10;

/**
 * `inputTokens` already contains the cached and cache-creation counts, so they
 * are subtracted back out instead of being added on top — otherwise a cached
 * prompt is billed twice.
 */
function grokTokens(usage: unknown) {
  const row = asRecord(usage);
  if (!row) return null;
  const cacheRead = numeric(row["cachedReadTokens"]);
  const cacheWrite = numeric(row["cacheCreationTokens"]);
  const rawInput = numeric(row["inputTokens"]);
  const tokens = {
    input: Math.max(0, rawInput - cacheRead - cacheWrite),
    output: numeric(row["outputTokens"]),
    cacheRead,
    cacheWrite,
  };
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return total > 0 ? tokens : null;
}

/** `%2Fwork%2Fgrok-app` -> `grok-app`; the path never leaves the machine. */
function projectFromEncodedCwd(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    /* a malformed escape stays as-is */
  }
  const parts = decoded.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "unknown";
}

export function detect(roots: string[]): boolean {
  return roots.length > 0;
}

export async function scanGrok(
  reader: Reader,
  roots: string[],
  options: ScanOptions,
): Promise<ScanResult> {
  const result = emptyResult();
  const daily = createDailyAccumulator({ timeZone: options.timeZone });

  for (const root of roots) {
    for (const file of await jsonlFiles(reader, root, options)) {
      const project = projectFromEncodedCwd(firstSegment(file.relativePath));

      for await (const line of readLines(reader, file.path)) {
        if (!line.includes("turn_completed")) continue;

        const entry = parseLine(line);
        if (entry === null) continue;
        if (pick(entry, "sessionUpdate") !== "turn_completed") continue;

        const timestamp = validTimestamp(pick(entry, "timestamp"), options);
        if (!timestamp) continue;

        const tokens = grokTokens(pick(entry, "usage"));
        if (!tokens) continue;

        const model = pick(entry, "model");
        const ticks = numeric(pick(entry, "costUsdTicks"));

        result.projects.add(project);
        daily.add({
          timestamp,
          provider: "grok",
          model: typeof model === "string" && model ? model : UNKNOWN_MODEL,
          ...tokens,
          turns: 1,
          sessionKey: file.path,
          // Grok reports what it actually billed; an invoice beats an estimate.
          reportedCostUsd: ticks > 0 ? ticks / TICKS_PER_USD : undefined,
        });
      }
    }
  }

  result.daily = daily.rows();
  for (const unknown of daily.unknownModels) result.unknownModels.add(unknown);
  return result;
}
