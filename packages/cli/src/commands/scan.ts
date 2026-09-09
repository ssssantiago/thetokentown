/**
 * `scan`, `--json` and `claim`: everything that reads the machine and sends
 * nothing (the claim rides in a URL fragment the server never sees in
 * transit). SPEC §5b.1, §6.
 */

import { gzipSync } from "node:zlib";

import type { DailyUsage, Snapshot } from "@thetokentown/core/types";
import { aggregate } from "@thetokentown/core/aggregate";
import { floorsForCost } from "@thetokentown/core/metrics";

import type { Flags } from "../flags.ts";
import { resolveSite } from "../api.ts";
import { machineId, readConfig } from "../store.ts";
import type { ScanSummary } from "../sources.ts";
import { buildSnapshot, demoDaily, scanSources } from "../sources.ts";
import { banner, bold, dim, green, openBrowser, short, underline, yellow } from "../ui.ts";

const MAX_FRAGMENT_BYTES = 512 * 1024;

export interface Scanned {
  summary: ScanSummary;
  snapshot: Snapshot;
}

/** Scans (or fakes, with --demo) and builds the snapshot a claim would carry. */
export async function collect(flags: Flags, source: Snapshot["source"] = "claim"): Promise<Scanned> {
  const summary: ScanSummary = flags.demo
    ? {
        daily: demoDaily(flags.days),
        undedupedLines: 0,
        projects: new Set(["demo-alpha", "demo-beta", "demo-gamma"]),
        unknownModels: new Set(),
        cached: [],
        scanned: [],
      }
    : await scanSources({ days: flags.days, incremental: false });

  const config = readConfig();
  const snapshot = buildSnapshot(summary, {
    machineId: flags.demo ? "demo" : machineId(),
    source,
    building: config.building ?? "main",
  });
  return { summary, snapshot };
}

// ---------------------------------------------------------------- table

export function printSummary(daily: DailyUsage[], summary: ScanSummary, days: number, site: string): void {
  const stats = aggregate(daily, { now: Date.now(), lastSyncAt: null });

  const byProvider = new Map<string, { tokens: number; cost: number }>();
  for (const row of daily) {
    const entry = byProvider.get(row.provider) ?? { tokens: 0, cost: 0 };
    entry.tokens += row.input + row.output + row.cacheRead + row.cacheWrite;
    entry.cost += row.costUsd ?? 0;
    byProvider.set(row.provider, entry);
  }

  const lines = [...byProvider.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const sourceLines = lines.length
    ? lines
        .map(
          ([name, entry]) =>
            `  ${green("✓")} ${name.padEnd(8)} ${yellow(short(entry.tokens).padStart(8))} tokens   ${dim(`$${entry.cost.toFixed(2)} built`)}`,
        )
        .join("\n")
    : "  No Claude Code, Codex or Grok usage found in this window.";

  const totalTokens = [...byProvider.values()].reduce((sum, entry) => sum + entry.tokens, 0);

  console.log(`${banner()}

  LAST ${String(days).padStart(3)} DAYS
${sourceLines}

  ${bold(short(totalTokens))} tokens · ${bold(String(floorsForCost(stats.cost90d)))} floors · ${summary.projects.size} projects
  value built (API pricing): ${bold(`$${stats.cost90d.toFixed(2)}`)}${stats.costEstimated ? " *estimated" : ""}
  streak ${stats.streakDays}d · record ${stats.longestStreak}d · founded ${stats.firstDay ?? "—"}
`);

  if (summary.unknownModels.size > 0) {
    console.log(`  ${yellow("!")} no price for ${[...summary.unknownModels].join(", ")} — counted as $0.\n    Update at ${site}/pricing.json\n`);
  }
}

// ---------------------------------------------------------------- commands

export async function scanCommand(flags: Flags): Promise<number> {
  const { summary, snapshot } = await collect(flags);
  if (flags.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return 0;
  }
  printSummary(snapshot.daily, summary, flags.days, resolveSite(flags.site));
  if (snapshot.daily.length === 0) console.log("  Nothing to build yet. Try --demo to preview a building.\n");
  else console.log(`  ${dim("Nothing was sent. `thetokentown claim` opens your building; `--json` shows the payload.")}\n`);
  return 0;
}

/** The fragment for `/claim#…`, or null when it is too big for a URL. */
export function claimFragment(snapshot: Snapshot): string | null {
  const fragment = gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8")).toString("base64url");
  return fragment.length > MAX_FRAGMENT_BYTES ? null : fragment;
}

export async function claimCommand(flags: Flags, scanned?: Scanned): Promise<number> {
  const { summary, snapshot } = scanned ?? (await collect(flags));
  const site = resolveSite(flags.site);
  if (flags.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return 0;
  }
  printSummary(snapshot.daily, summary, flags.days, site);

  if (snapshot.daily.length === 0) {
    console.log("  Nothing to build yet. Try --demo to preview a building.\n");
    return 0;
  }

  const fragment = claimFragment(snapshot);
  if (fragment === null) {
    console.log(
      `  Your history is too large for a one-shot claim.\n  Run ${bold("thetokentown login")} and then ${bold("thetokentown publish")} instead.\n`,
    );
    return 0;
  }

  console.log(`  Your building is ready:\n  ${underline(`${site}/claim`)}\n`);
  if (!flags.noOpen) openBrowser(`${site}/claim#${fragment}`);
  return 0;
}
