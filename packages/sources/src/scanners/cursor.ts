/**
 * Cursor. Ported from bin/thetokentown.mjs with the behavior unchanged.
 *
 * This reads an append-only log that only exists once a Cursor stop hook
 * writes it. Nothing installs that hook yet (task 10), so on a real machine
 * this scanner finds nothing — which is why `detect()` will report false until
 * the hook ships. See docs/SPEC.md §6 and §13.
 */

import type { Reader } from "../reader.ts";
import { readLines } from "../reader.ts";
import type { ScanOptions, ScanResult } from "../types.ts";
import { emptyResult } from "../types.ts";
import { numeric, parseLine, pick, validTimestamp } from "./shared.ts";

const MAX_WORKSPACE_LENGTH = 160;

export async function scanCursor(
  reader: Reader,
  logPath: string,
  options: ScanOptions,
): Promise<ScanResult> {
  const result = emptyResult();

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
      result.projects.add(project);
      result.events.push({ timestamp, tokens, source: "cursor", project });
    }
  } catch {
    // A missing log is the normal case, not an error.
    return result;
  }

  return result;
}
