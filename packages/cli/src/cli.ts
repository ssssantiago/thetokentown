/**
 * thetokentown — turn the last 90 days of AI coding into a building.
 *
 * Nothing here reaches the network. `--json` prints the exact v2 Snapshot that
 * a claim would carry; the default flow encodes that same object into a URL
 * fragment, which the browser reads and the server never sees in transit.
 * SPEC §5b.1, §6.
 */

import { gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import type { DailyUsage, Snapshot } from "@thetokentown/core/types";
import { WINDOW_DAYS, floorsForCost } from "@thetokentown/core/metrics";
import { aggregate } from "@thetokentown/core/aggregate";
import type { ScanResult } from "@thetokentown/sources";
import {
  createFsReader,
  detectCursor,
  scanClaude,
  scanCodex,
  scanCursor,
  scanGrok,
} from "@thetokentown/sources";

const VERSION = "0.2.0";
const DEFAULT_SITE = "https://thetokentown.dev";
const MAX_FRAGMENT_BYTES = 512 * 1024;
const HOME = homedir();
const CONFIG_DIR = join(HOME, ".thetokentown");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const argv = new Set(process.argv.slice(2));
const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const expand = (path: string) => path.replace(/^~/, HOME);

// ---------------------------------------------------------------- flags

if (argv.has("--help") || argv.has("-h")) {
  console.log(`thetokentown ${VERSION}

Usage:
  npx thetokentown              scan and open your claim
  npx thetokentown --json       print the exact snapshot, send nothing
  npx thetokentown --no-open    do not open a browser
  npx thetokentown --demo       use safe demo data

Options:
  --since <days>                activity window (default: ${WINDOW_DAYS})
  --site <url>                  The Token Town site URL
  --help                        show this help
  --version                     print the version

Privacy: only per-day, per-provider, per-model token counts leave this
machine. Prompts, responses, file names, paths and code never do. Run
--json to read the payload before anything is sent.

State: a machine id is stored in ~/.thetokentown/config.json so two runs
from the same computer are not counted as two buildings.`);
  process.exit(0);
}

if (argv.has("--version") || argv.has("-v")) {
  console.log(VERSION);
  process.exit(0);
}

const days = Math.max(1, Math.min(365, Number(valueAfter("--since")) || WINDOW_DAYS));
const since = Date.now() - days * 86_400_000;

// ---------------------------------------------------------------- machine id

/** A uuid, and nothing else. Written 0600 so it is not world-readable. */
function machineId(): string {
  try {
    if (existsSync(CONFIG_FILE)) {
      const stored = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as { machineId?: unknown };
      if (typeof stored.machineId === "string" && stored.machineId) return stored.machineId;
    }
  } catch {
    /* unreadable or corrupt config: mint a new id rather than fail */
  }

  const id = randomUUID();
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CONFIG_FILE, `${JSON.stringify({ machineId: id }, null, 2)}\n`, { mode: 0o600 });
  } catch {
    /* read-only home: the id just will not persist */
  }
  return id;
}

// ---------------------------------------------------------------- roots

const claudeRoots = process.env["CLAUDE_CONFIG_DIR"]
  ? process.env["CLAUDE_CONFIG_DIR"].split(",").map((path) => join(expand(path.trim()), "projects"))
  : [join(HOME, ".config", "claude", "projects"), join(HOME, ".claude", "projects")];

const codexHome = process.env["CODEX_HOME"] ? expand(process.env["CODEX_HOME"]) : join(HOME, ".codex");
const codexRoots = [join(codexHome, "sessions"), join(codexHome, "archived_sessions")];

const grokHome = process.env["GROK_HOME"] ? expand(process.env["GROK_HOME"]) : join(HOME, ".grok");
const grokRoots = [join(grokHome, "sessions")];

const cursorLog = expand(
  process.env["THETOKENTOWN_CURSOR_LOG"] ?? join(HOME, ".cursor", "token-usage", "usage.jsonl"),
);

// ---------------------------------------------------------------- demo

function demoDaily(): DailyUsage[] {
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
  return rows.sort((a, b) => a.day.localeCompare(b.day));
}

// ---------------------------------------------------------------- scan

const options = { since, now: Date.now() };
const reader = createFsReader();

let daily: DailyUsage[];
let projects = new Set<string>();
let undedupedLines = 0;
const unknownModels = new Set<string>();

if (argv.has("--demo")) {
  daily = demoDaily();
  projects = new Set(["demo-alpha", "demo-beta", "demo-gamma"]);
} else {
  const results: ScanResult[] = await Promise.all([
    scanClaude(reader, claudeRoots, options),
    scanCodex(reader, codexRoots, options),
    scanGrok(reader, grokRoots, options),
    detectCursor()
      ? scanCursor(reader, cursorLog, options)
      : Promise.resolve({
          daily: [],
          projects: new Set<string>(),
          undedupedLines: 0,
          unknownModels: new Set<string>(),
        }),
  ]);

  daily = results.flatMap((result) => result.daily);
  for (const result of results) {
    for (const project of result.projects) projects.add(project);
    for (const model of result.unknownModels) unknownModels.add(model);
    undedupedLines += result.undedupedLines;
  }
  daily.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.provider.localeCompare(b.provider) ||
      a.model.localeCompare(b.model),
  );
}

const snapshot: Snapshot = {
  version: 2,
  cliVersion: VERSION,
  generatedAt: new Date().toISOString(),
  machineId: argv.has("--demo") ? "demo" : machineId(),
  source: "claim",
  building: "main",
  daily,
  undedupedLines,
};

if (argv.has("--json")) {
  console.log(JSON.stringify(snapshot, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------- summary

const stats = aggregate(daily, { now: Date.now(), lastSyncAt: null });

const byProvider = new Map<string, { tokens: number; cost: number }>();
for (const row of daily) {
  const entry = byProvider.get(row.provider) ?? { tokens: 0, cost: 0 };
  entry.tokens += row.input + row.output + row.cacheRead + row.cacheWrite;
  entry.cost += row.costUsd ?? 0;
  byProvider.set(row.provider, entry);
}

function short(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

const lines = [...byProvider.entries()].sort((a, b) => b[1].cost - a[1].cost);
const sourceLines = lines.length
  ? lines
      .map(
        ([name, entry]) =>
          `  \x1b[32m✓\x1b[0m ${name.padEnd(8)} \x1b[33m${short(entry.tokens).padStart(8)}\x1b[0m tokens   \x1b[2m$${entry.cost.toFixed(2)} built\x1b[0m`,
      )
      .join("\n")
  : "  No Claude Code, Codex or Grok usage found in this window.";

const totalTokens = [...byProvider.values()].reduce((sum, entry) => sum + entry.tokens, 0);

console.log(`
\x1b[38;2;216;255;69m  ╔══════════════════════════════╗
  ║        THE TOKEN TOWN        ║
  ╚══════════════════════════════╝\x1b[0m

  LAST ${String(days).padStart(3)} DAYS
${sourceLines}

  \x1b[1m${short(totalTokens)}\x1b[0m tokens · \x1b[1m${floorsForCost(stats.cost90d)}\x1b[0m floors · ${projects.size} projects
  value built (API pricing): \x1b[1m$${stats.cost90d.toFixed(2)}\x1b[0m${stats.costEstimated ? " *estimated" : ""}
  streak ${stats.streakDays}d · record ${stats.longestStreak}d · founded ${stats.firstDay ?? "—"}
`);

if (unknownModels.size > 0) {
  console.log(
    `  \x1b[33m!\x1b[0m no price for ${[...unknownModels].join(", ")} — counted as $0.\n    Update at ${DEFAULT_SITE}/pricing.json\n`,
  );
}

if (daily.length === 0) {
  console.log("  Nothing to build yet. Try --demo to preview a building.\n");
  process.exit(0);
}

// ---------------------------------------------------------------- claim

const site = (valueAfter("--site") ?? process.env["THETOKENTOWN_SITE_URL"] ?? DEFAULT_SITE).replace(
  /\/$/,
  "",
);
const fragment = gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8")).toString("base64url");

if (fragment.length > MAX_FRAGMENT_BYTES) {
  console.log(
    `  Your history is too large for a one-shot claim (${short(fragment.length)} compressed).\n  Run \x1b[1mthetokentown login\x1b[0m and then \x1b[1mthetokentown publish\x1b[0m instead.\n`,
  );
  process.exit(0);
}

const claimUrl = `${site}/claim#${fragment}`;
console.log(`  Your building is ready:\n  \x1b[4m${site}/claim\x1b[0m\n`);

if (!argv.has("--no-open")) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", claimUrl] : [claimUrl];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* no browser here; the URL was printed above */
  }
}
