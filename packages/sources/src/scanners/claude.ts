/**
 * Claude Code. Emits DailyUsage per day x model. SPEC §6.
 *
 * Roots are ~/.claude/projects, ~/.config/claude/projects and CLAUDE_CONFIG_DIR
 * in the CLI, or the picked directory in the browser. The scanner does not care.
 */

import type { Reader } from "../reader.ts";
import { firstSegment, readLines } from "../reader.ts";
import { createDailyAccumulator } from "../daily.ts";
import type { ScanOptions, ScanResult } from "../types.ts";
import { emptyResult } from "../types.ts";
import { asRecord, jsonlFiles, mightCarryUsage, numeric, parseLine, pick, validTimestamp } from "./shared.ts";

const UNKNOWN_MODEL = "unknown";

interface ClaudeTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function claudeTokens(usage: unknown): ClaudeTokens | null {
  const row = asRecord(usage);
  if (!row) return null;
  const tokens = {
    input: numeric(row["input_tokens"]),
    output: numeric(row["output_tokens"]),
    cacheWrite: numeric(row["cache_creation_input_tokens"]),
    cacheRead: numeric(row["cache_read_input_tokens"]),
  };
  const total = tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead;
  return total > 0 ? tokens : null;
}

export function detect(roots: string[]): boolean {
  return roots.length > 0;
}

export async function scanClaude(
  reader: Reader,
  roots: string[],
  options: ScanOptions,
): Promise<ScanResult> {
  const result = emptyResult();
  const daily = createDailyAccumulator({ timeZone: options.timeZone });

  // Shared across every root and file: the same message can be written to two
  // files when a session is resumed.
  const seen = new Set<string>();

  for (const root of roots) {
    for (const file of await jsonlFiles(reader, root, options)) {
      const project = firstSegment(file.relativePath) || "unknown";

      for await (const line of readLines(reader, file.path)) {
        if (!mightCarryUsage(line)) continue;

        const raw = parseLine(line);
        if (raw === null) continue;

        // Claude Code wraps some rows in an agent_progress envelope.
        const entry = pick(raw, "type") === "agent_progress" ? pick(pick(raw, "data"), "message") : raw;

        const message = pick(entry, "message");
        const tokens = claudeTokens(pick(message, "usage"));
        const timestamp = validTimestamp(pick(entry, "timestamp"), options);
        if (!timestamp || !tokens) continue;

        const messageId = pick(message, "id");
        const requestId = pick(entry, "requestId") ?? pick(entry, "request_id");

        // SPEC §6: dedup on message.id + requestId. When either is missing the
        // pair cannot be built, so the line is counted once with no key and
        // reported. Never synthesize a key from the file name or the line
        // number — such a key is unique by construction, which silently turns
        // dedup into a no-op across files that share a base name.
        if (typeof messageId === "string" && messageId && typeof requestId === "string" && requestId) {
          const key = `${messageId}:${requestId}`;
          if (seen.has(key)) continue;
          seen.add(key);
        } else {
          result.undedupedLines += 1;
        }

        const model = pick(message, "model");

        result.projects.add(project);
        daily.add({
          timestamp,
          provider: "claude",
          model: typeof model === "string" && model ? model : UNKNOWN_MODEL,
          ...tokens,
          turns: 1,
          sessionKey: file.path,
        });
      }
    }
  }

  result.daily = daily.rows();
  for (const model of daily.unknownModels) result.unknownModels.add(model);
  return result;
}
