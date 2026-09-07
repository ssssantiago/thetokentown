/** Helpers shared by the scanners, ported from bin/thetokentown.mjs. */

import type { FileEntry, Reader } from "../reader.ts";
import type { ScanOptions } from "../types.ts";

const DAY_MS = 86_400_000;

export function numeric(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Accepts an instant inside the window and not more than a day ahead.
 * Returns null otherwise, which is how a scanner skips a row.
 */
export function validTimestamp(value: unknown, options: ScanOptions): number | null {
  const now = options.now ?? Date.now();
  const timestamp = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(timestamp) || timestamp < options.since || timestamp > now + DAY_MS) {
    return null;
  }
  return timestamp;
}

/**
 * `.jsonl` files touched inside the window, in stable order.
 * A reader that cannot report mtime (the browser can, but a fake may not)
 * reports 0, and 0 must not exclude the file.
 */
export async function jsonlFiles(
  reader: Reader,
  root: string,
  options: ScanOptions,
): Promise<FileEntry[]> {
  const entries = await reader.list(root);
  return entries
    .filter((entry) => entry.relativePath.endsWith(".jsonl"))
    .filter((entry) => entry.lastModified === 0 || entry.lastModified >= options.since)
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The cheap pre-filter from the original CLI: skip any line that cannot
 * possibly carry usage before paying for JSON.parse.
 */
export function mightCarryUsage(line: string): boolean {
  return line.includes("usage") || line.includes("token_count") || line.includes("session_meta");
}

export function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    // Partial or malformed JSONL line — the file is appended to live.
    return null;
  }
}

/** Narrow an unknown parsed line to something indexable. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function pick(value: unknown, key: string): unknown {
  return asRecord(value)?.[key];
}
