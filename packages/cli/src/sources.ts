/**
 * The `Source` registry and the scan that feeds every command. SPEC §6.
 *
 * `Source { id, detect(), scan(state) }` — the hook installers live in
 * ./hooks and are attached here so `status` can list both sides of a tool.
 *
 * Incremental scanning works at file granularity: state.json keeps, per
 * source, a cursor for every file under its roots (`size:mtime`) plus the rows
 * that scan produced. When no cursor moved, the cached rows are reused; when
 * any did, the source is scanned again in full using the reader's streaming
 * `lines()`. Finer than that (per-line offsets) needs the scanners to expose
 * their cross-file state — Claude's dedup set and Codex's cumulative
 * counter — which lives in packages/sources and is not touched here.
 * Corrupt state means a full scan, never a failure.
 */

import { existsSync, readdirSync, statSync } from "node:fs";

import type { DailyUsage, Provider, Snapshot, SnapshotSource } from "@thetokentown/core/types";
import { createPricer } from "@thetokentown/core/pricing";
import { WINDOW_DAYS } from "@thetokentown/core/metrics";
import type { Reader, ScanOptions, ScanResult } from "@thetokentown/sources";
import {
  createFsReader,
  detectCursor,
  emptyResult,
  scanClaude,
  scanCodex,
  scanCursor,
  scanGrok,
} from "@thetokentown/sources";

import { CLAUDE_CONFIG_DIR, CODEX_HOME, CURSOR_LOG, GROK_HOME, claudeRoots, codexRoots, grokRoots } from "./paths.ts";
import type { SourceState, State } from "./store.ts";
import { VERSION } from "./version.ts";
import { readState, writeState } from "./store.ts";


export interface Source {
  id: Provider;
  label: string;
  /** Directories whose files are watched for the incremental cursor. */
  roots: string[];
  /** True when the tool appears to be installed on this machine. */
  detect(): boolean;
  scan(reader: Reader, options: ScanOptions): Promise<ScanResult>;
}

const exists = (path: string): boolean => {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
};

export const SOURCES: Source[] = [
  {
    id: "claude",
    label: "Claude Code",
    roots: claudeRoots,
    detect: () => exists(CLAUDE_CONFIG_DIR) || claudeRoots.some(exists),
    scan: (reader, options) => scanClaude(reader, claudeRoots, options),
  },
  {
    id: "codex",
    label: "Codex CLI",
    roots: codexRoots,
    detect: () => exists(CODEX_HOME),
    scan: (reader, options) => scanCodex(reader, codexRoots, options),
  },
  {
    id: "grok",
    label: "Grok CLI",
    roots: grokRoots,
    detect: () => exists(GROK_HOME),
    scan: (reader, options) => scanGrok(reader, grokRoots, options),
  },
  {
    id: "cursor",
    label: "Cursor",
    roots: [],
    // False until Cursor writes token counts locally. SPEC §6, NOTES.md.
    detect: () => detectCursor(),
    scan: (reader, options) => scanCursor(reader, CURSOR_LOG, options),
  },
];

export const detectedSources = (): Source[] => SOURCES.filter((source) => source.detect());

// ---------------------------------------------------------------- scan

export interface ScanSummary {
  daily: DailyUsage[];
  undedupedLines: number;
  projects: Set<string>;
  unknownModels: Set<string>;
  /** Which sources were served from state.json instead of re-read. */
  cached: Provider[];
  scanned: Provider[];
}

export interface ScanRunOptions {
  /** Window in days; default 90. */
  days?: number;
  now?: number;
  /** Reuse state.json cursors. Off for `scan`/`claim`, on for the hook. */
  incremental?: boolean;
}

/** `size:mtime` for every file under the roots — the per-file cursor. */
function cursors(roots: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const stack = [...roots];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = `${dir}/${name}`;
      try {
        const info = statSync(full);
        if (info.isDirectory()) stack.push(full);
        else if (info.isFile()) out[full] = `${info.size}:${Math.round(info.mtimeMs)}`;
      } catch {
        /* vanished between readdir and stat */
      }
    }
  }
  return out;
}

function sameCursors(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

function mergeInto(summary: ScanSummary, result: ScanResult): void {
  summary.daily.push(...result.daily);
  summary.undedupedLines += result.undedupedLines;
  for (const project of result.projects) summary.projects.add(project);
  for (const model of result.unknownModels) summary.unknownModels.add(model);
}

function sortDaily(daily: DailyUsage[]): DailyUsage[] {
  return daily.sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
  );
}

export async function scanSources(options: ScanRunOptions = {}): Promise<ScanSummary> {
  const now = options.now ?? Date.now();
  const days = Math.max(1, Math.min(365, options.days ?? WINDOW_DAYS));
  const since = now - days * 86_400_000;
  const scanOptions: ScanOptions = { since, now };
  const reader = createFsReader();

  const summary: ScanSummary = {
    daily: [],
    undedupedLines: 0,
    projects: new Set(),
    unknownModels: new Set(),
    cached: [],
    scanned: [],
  };

  const state: State = options.incremental ? readState() : { version: 1, sources: {} };
  let stateChanged = false;

  for (const source of detectedSources()) {
    const files = options.incremental ? cursors(source.roots) : {};
    const previous = state.sources[source.id];

    if (
      options.incremental &&
      previous &&
      previous.since <= since &&
      Array.isArray(previous.daily) &&
      sameCursors(previous.files ?? {}, files)
    ) {
      const sinceDay = new Date(since).toISOString().slice(0, 10);
      mergeInto(summary, {
        daily: previous.daily.filter((row) => row.day >= sinceDay),
        undedupedLines: previous.undedupedLines ?? 0,
        projects: new Set(previous.projects ?? []),
        unknownModels: new Set(previous.unknownModels ?? []),
      });
      summary.cached.push(source.id);
      continue;
    }

    let result: ScanResult;
    try {
      result = await source.scan(reader, scanOptions);
    } catch {
      // A broken file must not take the other sources down with it.
      result = emptyResult();
    }
    mergeInto(summary, result);
    summary.scanned.push(source.id);

    if (options.incremental) {
      const next: SourceState = {
        since,
        files,
        daily: result.daily,
        undedupedLines: result.undedupedLines,
        projects: [...result.projects],
        unknownModels: [...result.unknownModels],
        scannedAt: new Date(now).toISOString(),
      };
      state.sources[source.id] = next;
      stateChanged = true;
    }
  }

  if (stateChanged) writeState(state);
  sortDaily(summary.daily);
  return summary;
}

// ---------------------------------------------------------------- demo

export function demoDaily(days: number): DailyUsage[] {
  const rows: DailyUsage[] = [];
  const today = Date.now();
  for (let day = 0; day < Math.min(days, 45); day += 1) {
    if (day % 5 === 0) continue;
    const date = new Date(today - day * 86_400_000).toISOString().slice(0, 10);
    const provider = day % 3 ? "claude" : "codex";
    rows.push({
      day: date,
      provider,
      model: provider === "claude" ? "claude-opus-5" : "gpt-5.3-codex",
      input: 12_000 + ((day * 7919) % 40_000),
      output: 3_000 + ((day * 104_729) % 9_000),
      cacheRead: 180_000 + ((day * 15_485_863) % 400_000),
      cacheWrite: 9_000 + ((day * 32_452_843) % 20_000),
      costUsd: null,
      costEstimated: false,
      turns: 4 + (day % 9),
      sessions: 1 + (day % 3),
    });
  }
  // Price the demo the same way a real scan is priced, so the preview shows a
  // building instead of a one-floor stub.
  const pricer = createPricer();
  for (const row of rows) row.costUsd = pricer.cost(row.model, row);
  return sortDaily(rows);
}

// ---------------------------------------------------------------- snapshot

export function buildSnapshot(
  summary: Pick<ScanSummary, "daily" | "undedupedLines">,
  meta: { machineId: string; source: SnapshotSource; building: string; now?: number },
): Snapshot {
  return {
    version: 2,
    cliVersion: VERSION,
    generatedAt: new Date(meta.now ?? Date.now()).toISOString(),
    machineId: meta.machineId,
    source: meta.source,
    building: meta.building,
    daily: summary.daily,
    undedupedLines: summary.undedupedLines,
  };
}
