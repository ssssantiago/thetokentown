#!/usr/bin/env node

import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

const VERSION = "0.1.0";
const WINDOW_DAYS = 90;
const LIVE_MINUTES = 10;
const argv = new Set(process.argv.slice(2));
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

if (argv.has("--help") || argv.has("-h")) {
  console.log(`thetokentown ${VERSION}\n\nUsage:\n  npx thetokentown              scan and open your claim\n  npx thetokentown --json       print the aggregate only\n  npx thetokentown --no-open    do not open a browser\n  npx thetokentown --demo       use safe demo data\n\nOptions:\n  --since <days>                activity window (default: 90)\n  --site <url>                  The Token Town site URL\n  --help                        show this help\n  --version                     print the version\n\nPrivacy: only aggregate token counts, dates, tool names and project count\nare included in a claim. Prompts, responses, file names and code are never sent.`);
  process.exit(0);
}
if (argv.has("--version") || argv.has("-v")) {
  console.log(VERSION);
  process.exit(0);
}

const days = Math.max(1, Math.min(365, Number(valueAfter("--since")) || WINDOW_DAYS));
const since = Date.now() - days * 86_400_000;

function walkJsonl(root) {
  if (!root || !existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try { if (statSync(full).mtimeMs >= since) files.push(full); } catch { /* unreadable file */ }
      }
    }
  }
  return files.sort();
}

function numeric(value) {
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function claudeTotal(usage = {}) {
  return numeric(usage.input_tokens) + numeric(usage.output_tokens) + numeric(usage.cache_creation_input_tokens) + numeric(usage.cache_read_input_tokens);
}

function codexTotal(usage = {}) {
  if (numeric(usage.total_tokens)) return numeric(usage.total_tokens);
  return numeric(usage.input_tokens ?? usage.prompt_tokens ?? usage.input) + numeric(usage.output_tokens ?? usage.completion_tokens ?? usage.output) + numeric(usage.reasoning_output_tokens);
}

function subtractUsage(current = {}, previous = {}) {
  const fields = ["input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];
  return Object.fromEntries(fields.map((field) => [field, Math.max(0, numeric(current[field]) - numeric(previous[field]))]));
}

function validTimestamp(value) {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < since || timestamp > Date.now() + 86_400_000) return null;
  return timestamp;
}

async function lines(file, visit) {
  const input = createReadStream(file, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  let index = 0;
  for await (const line of reader) {
    index += 1;
    if (!line.includes("usage") && !line.includes("token_count") && !line.includes("session_meta")) continue;
    try { await visit(JSON.parse(line), index); } catch { /* malformed or partial JSONL line */ }
  }
}

async function scanClaude(roots) {
  const events = [];
  const seen = new Set();
  const projects = new Set();
  for (const root of roots) {
    for (const file of walkJsonl(root)) {
      const project = relative(root, file).split(sep)[0] || "unknown";
      await lines(file, (raw, index) => {
        const entry = raw?.type === "agent_progress" ? raw?.data?.message : raw;
        const usage = entry?.message?.usage;
        const timestamp = validTimestamp(entry?.timestamp);
        const tokens = claudeTotal(usage);
        if (!timestamp || !tokens) return;
        const key = `${entry?.message?.id || basename(file)}:${entry?.requestId || entry?.request_id || index}`;
        if (seen.has(key)) return;
        seen.add(key); projects.add(project);
        events.push({ timestamp, tokens, source: "claude", project });
      });
    }
  }
  return { events, projects };
}

async function scanCodex(roots) {
  const events = [];
  const projects = new Set();
  for (const root of roots) {
    for (const file of walkJsonl(root)) {
      let previousTotal = null;
      let project = "unknown";
      await lines(file, (entry) => {
        if (entry?.type === "session_meta" && entry?.payload?.cwd) {
          project = basename(entry.payload.cwd); projects.add(project);
          return;
        }
        const timestamp = validTimestamp(entry?.timestamp ?? entry?.created_at ?? entry?.createdAt);
        if (!timestamp) return;
        const info = entry?.type === "event_msg" && entry?.payload?.type === "token_count" ? entry.payload.info : null;
        if (info) {
          const cumulative = info.total_token_usage;
          const advanced = !cumulative || JSON.stringify(cumulative) !== JSON.stringify(previousTotal);
          const usage = advanced && info.last_token_usage ? info.last_token_usage : cumulative ? subtractUsage(cumulative, previousTotal || {}) : null;
          if (cumulative) previousTotal = cumulative;
          const tokens = codexTotal(usage);
          if (tokens) { projects.add(project); events.push({ timestamp, tokens, source: "codex", project }); }
          return;
        }
        const usage = entry?.usage ?? entry?.data?.usage ?? entry?.result?.usage ?? entry?.response?.usage;
        const tokens = codexTotal(usage);
        if (tokens) { projects.add(project); events.push({ timestamp, tokens, source: "codex", project }); }
      });
    }
  }
  return { events, projects };
}

async function scanCursor(file) {
  const events = [];
  const projects = new Set();
  if (!existsSync(file)) return { events, projects };
  const input = createReadStream(file, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.includes("total_tokens") && !line.includes("totalTokens")) continue;
    try {
      const entry = JSON.parse(line);
      const timestamp = validTimestamp(entry.ts ?? entry.timestamp);
      const tokens = numeric(entry.total_tokens ?? entry.totalTokens);
      if (!timestamp || !tokens) continue;
      const project = String(entry.workspace || "cursor-workspace").slice(0, 160);
      projects.add(project); events.push({ timestamp, tokens, source: "cursor", project });
    } catch { /* malformed or partial JSONL line */ }
  }
  return { events, projects };
}

function demoEvents() {
  const now = Date.now();
  const result = [];
  for (let day = 0; day < days; day += 1) {
    if (day % 5 === 0) continue;
    result.push({ timestamp: now - day * 86_400_000, tokens: 170_000 + ((day * 7919) % 640_000), source: day % 3 ? "claude" : "codex", project: `demo-${day % 7}` });
  }
  return result;
}

function summarize(events, projectSets) {
  const daily = new Map();
  const sources = new Map();
  let latest = 0;
  for (const event of events) {
    const date = new Date(event.timestamp).toISOString().slice(0, 10);
    daily.set(date, (daily.get(date) || 0) + event.tokens);
    sources.set(event.source, (sources.get(event.source) || 0) + event.tokens);
    latest = Math.max(latest, event.timestamp);
  }
  const totalTokens = [...daily.values()].reduce((sum, tokens) => sum + tokens, 0);
  const projectCount = new Set([...projectSets].flatMap((set) => [...set])).size;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    windowDays: days,
    totalTokens,
    activeDays: daily.size,
    projectCount,
    live: latest > Date.now() - LIVE_MINUTES * 60_000,
    lastActiveAt: latest ? new Date(latest).toISOString() : null,
    sources: [...sources].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens),
    daily: [...daily].map(([date, tokens]) => ({ date, tokens })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function formatTokens(value) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function encodeClaim(summary) {
  return Buffer.from(JSON.stringify(summary)).toString("base64url");
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(command, args, { detached: true, stdio: "ignore" }).unref(); return true; } catch { return false; }
}

const home = homedir();
const claudeRoots = (process.env.CLAUDE_CONFIG_DIR ? process.env.CLAUDE_CONFIG_DIR.split(",").map((path) => join(path.trim().replace(/^~/, home), "projects")) : [join(home, ".config", "claude", "projects"), join(home, ".claude", "projects")]);
const codexHomes = process.env.CODEX_HOME
  ? [process.env.CODEX_HOME.replace(/^~/, home)]
  : [join(home, ".codex")];
const codexRoots = codexHomes.flatMap((root) => [join(root, "sessions"), join(root, "archived_sessions")]);
const cursorLog = (process.env.THETOKENTOWN_CURSOR_LOG || join(home, ".cursor", "token-usage", "usage.jsonl")).replace(/^~/, home);

let events;
let projectSets;
if (argv.has("--demo")) {
  events = demoEvents(); projectSets = [new Set(events.map((event) => event.project))];
} else {
  const [claude, codex, cursor] = await Promise.all([scanClaude(claudeRoots), scanCodex(codexRoots), scanCursor(cursorLog)]);
  events = [...claude.events, ...codex.events, ...cursor.events]; projectSets = [claude.projects, codex.projects, cursor.projects];
}
const summary = summarize(events, projectSets);

if (argv.has("--json")) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const sourceLines = summary.sources.length ? summary.sources.map((source) => `  \x1b[32m✓\x1b[0m ${source.name.padEnd(14)} \x1b[33m${formatTokens(source.tokens).padStart(8)}\x1b[0m`).join("\n") : "  No Claude Code or Codex usage found in this window.";
console.log(`\n\x1b[38;2;216;255;69m  ╔══════════════════════════════╗\n  ║        THE TOKEN TOWN        ║\n  ╚══════════════════════════════╝\x1b[0m\n\n  LAST ${String(days).padStart(3)} DAYS\n${sourceLines}\n\n  \x1b[1m${formatTokens(summary.totalTokens)}\x1b[0m tokens · ${summary.activeDays} active days · ${summary.projectCount} projects\n  ${summary.live ? "\x1b[38;2;216;255;69m● LIGHTS ON — coding now\x1b[0m" : "○ lights off"}\n`);

if (!summary.totalTokens) {
  console.log("  The Token Town only reads local aggregate usage. Try --demo to preview a building.\n");
  process.exit(0);
}

const site = (valueAfter("--site") || process.env.THETOKENTOWN_SITE_URL || "https://the-token-town.santitiago.chatgpt.site").replace(/\/$/, "");
const claimUrl = `${site}/claim#${encodeClaim(summary)}`;
console.log(`  Your building is ready:\n  \x1b[4m${site}/claim\x1b[0m\n`);
if (!argv.has("--no-open")) openBrowser(claimUrl);
