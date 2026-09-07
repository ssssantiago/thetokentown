/**
 * Codex CLI. Ported from bin/thetokentown.mjs with the behavior unchanged.
 *
 * Codex reports a cumulative counter, so the scanner takes the difference
 * against the previous row of the same file. `previousTotal` is per file, not
 * per run: two sessions each start from zero.
 */

import type { Reader } from "../reader.ts";
import { readLines } from "../reader.ts";
import type { ScanOptions, ScanResult } from "../types.ts";
import { emptyResult } from "../types.ts";
import { asRecord, jsonlFiles, mightCarryUsage, numeric, parseLine, pick, validTimestamp } from "./shared.ts";

function codexTotal(usage: unknown): number {
  const row = asRecord(usage);
  if (!row) return 0;
  const total = numeric(row["total_tokens"]);
  if (total) return total;
  return (
    numeric(row["input_tokens"] ?? row["prompt_tokens"] ?? row["input"]) +
    numeric(row["output_tokens"] ?? row["completion_tokens"] ?? row["output"]) +
    numeric(row["reasoning_output_tokens"])
  );
}

const DELTA_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
] as const;

function subtractUsage(current: unknown, previous: unknown): Record<string, number> {
  const a = asRecord(current) ?? {};
  const b = asRecord(previous) ?? {};
  return Object.fromEntries(
    DELTA_FIELDS.map((field) => [field, Math.max(0, numeric(a[field]) - numeric(b[field]))]),
  );
}

/** `/work/codex-app` -> `codex-app`; only the basename ever leaves the machine. */
function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export async function scanCodex(
  reader: Reader,
  roots: string[],
  options: ScanOptions,
): Promise<ScanResult> {
  const result = emptyResult();

  for (const root of roots) {
    for (const file of await jsonlFiles(reader, root, options)) {
      let previousTotal: unknown = null;
      let project = "unknown";

      for await (const line of readLines(reader, file.path)) {
        if (!mightCarryUsage(line)) continue;

        const entry = parseLine(line);
        if (entry === null) continue;

        if (pick(entry, "type") === "session_meta") {
          const cwd = pick(pick(entry, "payload"), "cwd");
          if (typeof cwd === "string" && cwd) {
            project = basename(cwd);
            result.projects.add(project);
          }
          continue;
        }

        const timestamp = validTimestamp(
          pick(entry, "timestamp") ?? pick(entry, "created_at") ?? pick(entry, "createdAt"),
          options,
        );
        if (!timestamp) continue;

        const payload = pick(entry, "payload");
        const info =
          pick(entry, "type") === "event_msg" && pick(payload, "type") === "token_count"
            ? pick(payload, "info")
            : null;

        if (info) {
          const cumulative = pick(info, "total_token_usage");
          const last = pick(info, "last_token_usage");
          const advanced = !cumulative || JSON.stringify(cumulative) !== JSON.stringify(previousTotal);
          const usage = advanced && last ? last : cumulative ? subtractUsage(cumulative, previousTotal) : null;
          if (cumulative) previousTotal = cumulative;

          const tokens = codexTotal(usage);
          if (tokens) {
            result.projects.add(project);
            result.events.push({ timestamp, tokens, source: "codex", project });
          }
          continue;
        }

        const usage =
          pick(entry, "usage") ??
          pick(pick(entry, "data"), "usage") ??
          pick(pick(entry, "result"), "usage") ??
          pick(pick(entry, "response"), "usage");

        const tokens = codexTotal(usage);
        if (tokens) {
          result.projects.add(project);
          result.events.push({ timestamp, tokens, source: "codex", project });
        }
      }
    }
  }

  return result;
}
