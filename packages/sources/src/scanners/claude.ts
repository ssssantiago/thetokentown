/**
 * Claude Code. Ported from bin/thetokentown.mjs with the behavior unchanged;
 * the only addition is the `undedupedLines` counter.
 *
 * Roots are ~/.claude/projects, ~/.config/claude/projects and CLAUDE_CONFIG_DIR
 * in the CLI, or the picked directory in the browser. The scanner does not care.
 */

import type { Reader } from "../reader.ts";
import { firstSegment, readLines } from "../reader.ts";
import type { ScanOptions, ScanResult } from "../types.ts";
import { emptyResult } from "../types.ts";
import { asRecord, jsonlFiles, mightCarryUsage, numeric, parseLine, pick, validTimestamp } from "./shared.ts";

function claudeTotal(usage: unknown): number {
  const row = asRecord(usage);
  if (!row) return 0;
  return (
    numeric(row["input_tokens"]) +
    numeric(row["output_tokens"]) +
    numeric(row["cache_creation_input_tokens"]) +
    numeric(row["cache_read_input_tokens"])
  );
}

/** `a/b/c.jsonl` -> `c.jsonl`; the original used path.basename. */
function basename(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] ?? path;
}

export async function scanClaude(
  reader: Reader,
  roots: string[],
  options: ScanOptions,
): Promise<ScanResult> {
  const result = emptyResult();
  // Shared across every root and file, exactly as in the original.
  const seen = new Set<string>();

  for (const root of roots) {
    for (const file of await jsonlFiles(reader, root, options)) {
      const project = firstSegment(file.relativePath) || "unknown";
      let index = 0;

      for await (const line of readLines(reader, file.path)) {
        index += 1;
        if (!mightCarryUsage(line)) continue;

        const raw = parseLine(line);
        if (raw === null) continue;

        // Claude Code wraps some rows in an agent_progress envelope.
        const entry = pick(raw, "type") === "agent_progress" ? pick(pick(raw, "data"), "message") : raw;

        const message = pick(entry, "message");
        const tokens = claudeTotal(pick(message, "usage"));
        const timestamp = validTimestamp(pick(entry, "timestamp"), options);
        if (!timestamp || !tokens) continue;

        const messageId = pick(message, "id");
        const requestId = pick(entry, "requestId") ?? pick(entry, "request_id");

        // TODO(task 4): SPEC §6 says an unbuildable key means "process once,
        // no dedup". The synthetic key below is the current CLI's behavior and
        // is kept byte-for-byte so this refactor changes nothing; the counter
        // measures how often it is reached.
        if (typeof messageId !== "string" || !messageId || !requestId) {
          result.undedupedLines += 1;
        }

        const key = `${messageId || basename(file.path)}:${requestId || index}`;
        if (seen.has(key)) continue;
        seen.add(key);

        result.projects.add(project);
        result.events.push({ timestamp, tokens, source: "claude", project });
      }
    }
  }

  return result;
}
