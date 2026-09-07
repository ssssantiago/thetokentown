/**
 * Codex CLI. Emits DailyUsage per day x model. SPEC §6.
 *
 * Codex reports a cumulative counter, so the scanner takes the difference
 * against the previous row of the same file. `previousTotal` is per file, not
 * per run: two sessions each start from zero. The model comes from the most
 * recent `turn_context` event.
 */

import type { Reader } from "../reader.ts";
import { readLines } from "../reader.ts";
import { createDailyAccumulator } from "../daily.ts";
import type { ScanOptions, ScanResult } from "../types.ts";
import { emptyResult } from "../types.ts";
import { asRecord, jsonlFiles, mightCarryUsage, numeric, parseLine, pick, validTimestamp } from "./shared.ts";

const UNKNOWN_MODEL = "unknown";

const DELTA_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
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

/**
 * Codex's `input_tokens` already includes `cached_input_tokens`, so the cached
 * part is subtracted out rather than added on top. Reasoning tokens are a
 * subset of output and are not counted separately. Codex reports no
 * cache-write counter, so cacheWrite stays 0.
 */
function codexTokens(usage: unknown) {
  const row = asRecord(usage);
  if (!row) return null;
  const cacheRead = numeric(row["cached_input_tokens"]);
  const rawInput = numeric(row["input_tokens"] ?? row["prompt_tokens"] ?? row["input"]);
  const output = numeric(row["output_tokens"] ?? row["completion_tokens"] ?? row["output"]);
  const tokens = {
    input: Math.max(0, rawInput - cacheRead),
    output,
    cacheRead,
    cacheWrite: 0,
  };
  const total = tokens.input + tokens.output + tokens.cacheRead;
  return total > 0 ? tokens : null;
}

/** `/work/codex-app` -> `codex-app`; only the basename ever leaves the machine. */
function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function detect(roots: string[]): boolean {
  return roots.length > 0;
}

export async function scanCodex(
  reader: Reader,
  roots: string[],
  options: ScanOptions,
): Promise<ScanResult> {
  const result = emptyResult();
  const daily = createDailyAccumulator({ timeZone: options.timeZone });

  for (const root of roots) {
    for (const file of await jsonlFiles(reader, root, options)) {
      let previousTotal: unknown = null;
      let project = "unknown";
      let model = UNKNOWN_MODEL;

      for await (const line of readLines(reader, file.path)) {
        if (!mightCarryUsage(line) && !line.includes("turn_context")) continue;

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

        if (pick(entry, "type") === "turn_context") {
          const declared = pick(pick(entry, "payload"), "model");
          if (typeof declared === "string" && declared) model = declared;
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

        const usage = info
          ? (() => {
              const cumulative = pick(info, "total_token_usage");
              const last = pick(info, "last_token_usage");
              const advanced =
                !cumulative || JSON.stringify(cumulative) !== JSON.stringify(previousTotal);
              const delta =
                advanced && last ? last : cumulative ? subtractUsage(cumulative, previousTotal) : null;
              if (cumulative) previousTotal = cumulative;
              return delta;
            })()
          : (pick(entry, "usage") ??
            pick(pick(entry, "data"), "usage") ??
            pick(pick(entry, "result"), "usage") ??
            pick(pick(entry, "response"), "usage"));

        const tokens = codexTokens(usage);
        if (!tokens) continue;

        result.projects.add(project);
        daily.add({
          timestamp,
          provider: "codex",
          model,
          ...tokens,
          turns: 1,
          sessionKey: file.path,
        });
      }
    }
  }

  result.daily = daily.rows();
  for (const unknown of daily.unknownModels) result.unknownModels.add(unknown);
  return result;
}
