#!/usr/bin/env node
/**
 * Builds `fixtures/` from the real Claude Code and Codex logs on this machine.
 *
 * The fixtures are committed to a PUBLIC repository, so this script is an
 * allow-list, never a deny-list: an unknown field is dropped, not kept. Only
 * four kinds of thing survive — token usage, timestamps, ids and model names —
 * and even those are transformed:
 *
 *   - Directory names under ~/.claude/projects encode absolute paths
 *     (`-Users-santiago-thefenomeno`). They are replaced with `project-alpha`,
 *     `project-beta`, ... The scanner reads the first path segment as the
 *     project name, so the shape is preserved and the path is not.
 *   - `cwd` in a Codex session_meta is an absolute path. Replaced with a
 *     synthetic one; only its basename ever reaches the scanner.
 *   - Message and request ids are remapped to `msg-N` / `req-N` in first-seen
 *     order. Dedup depends on ids being *distinct*, never on their values, so
 *     a bijective remap keeps the tests honest while cutting the tie to a real
 *     account.
 *   - Real calendar dates are remapped: the sorted distinct days become
 *     consecutive days ending at FIXTURE_LAST_DAY. Time of day is preserved.
 *     Without this the fixtures would silently fall out of the 90-day window
 *     and the tests would start passing vacuously in a few months.
 *
 * Never emitted: content, text, prompts, cwd, gitBranch, repository_url,
 * commit_hash, session ids, uuids, base_instructions, rate limits, versions.
 *
 * Usage:  node scripts/anonymize-fixtures.mjs [--check]
 *         --check re-derives the fixtures and fails if the tree would change.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "fixtures");
const HOME = homedir();

const FIXTURE_LAST_DAY = "2026-09-05";
const MAX_PROJECTS = 3;
const MAX_FILES_PER_PROJECT = 2;
const MAX_LINES_PER_FILE = 40;
const MAX_CODEX_SESSIONS = 3;

const CHECK = process.argv.includes("--check");

// ---------------------------------------------------------------- helpers

const DAY_MS = 86_400_000;

function walk(dir, predicate) {
  if (!existsSync(dir)) return [];
  const found = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && predicate(entry.name)) found.push(full);
    }
  }
  return found.sort();
}

function readJsonl(file) {
  const rows = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* partial or malformed line, exactly what the scanner also skips */
    }
  }
  return rows;
}

/** Stable `msg-1`, `req-1`, ... in first-seen order. */
function createIdMapper(prefix) {
  const seen = new Map();
  return (value) => {
    if (typeof value !== "string" || value === "") return undefined;
    if (!seen.has(value)) seen.set(value, `${prefix}-${seen.size + 1}`);
    return seen.get(value);
  };
}

/** Sorted distinct real days -> consecutive days ending at FIXTURE_LAST_DAY. */
function createDayMapper(timestamps) {
  const days = [...new Set(timestamps.map((t) => t.slice(0, 10)))].sort();
  const lastMs = Date.parse(`${FIXTURE_LAST_DAY}T00:00:00.000Z`);
  const mapped = new Map();
  days.forEach((day, index) => {
    const offset = days.length - 1 - index;
    mapped.set(day, new Date(lastMs - offset * DAY_MS).toISOString().slice(0, 10));
  });
  return (timestamp) => {
    const day = mapped.get(timestamp.slice(0, 10));
    return day ? `${day}T${timestamp.slice(11)}` : timestamp;
  };
}

function nonNegativeInt(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/** Allow-list for a Claude usage block. */
function claudeUsage(usage) {
  if (typeof usage !== "object" || usage === null) return null;
  const kept = {
    input_tokens: nonNegativeInt(usage.input_tokens),
    output_tokens: nonNegativeInt(usage.output_tokens),
    cache_creation_input_tokens: nonNegativeInt(usage.cache_creation_input_tokens),
    cache_read_input_tokens: nonNegativeInt(usage.cache_read_input_tokens),
  };
  const total = Object.values(kept).reduce((sum, n) => sum + n, 0);
  return total > 0 ? kept : null;
}

/** Allow-list for a Codex usage block. */
function codexUsage(usage) {
  if (typeof usage !== "object" || usage === null) return null;
  return {
    input_tokens: nonNegativeInt(usage.input_tokens),
    cached_input_tokens: nonNegativeInt(usage.cached_input_tokens),
    output_tokens: nonNegativeInt(usage.output_tokens),
    reasoning_output_tokens: nonNegativeInt(usage.reasoning_output_tokens),
    total_tokens: nonNegativeInt(usage.total_tokens),
  };
}

// ---------------------------------------------------------------- claude

function buildClaude() {
  const source = join(HOME, ".claude", "projects");
  const projects = existsSync(source)
    ? readdirSync(source, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

  const picked = [];
  for (const project of projects) {
    const files = walk(join(source, project), (name) => name.endsWith(".jsonl"));
    const usable = files.filter((file) =>
      readJsonl(file).some((row) => claudeUsage(row?.message?.usage)),
    );
    if (usable.length) picked.push({ project, files: usable.slice(0, MAX_FILES_PER_PROJECT) });
    if (picked.length === MAX_PROJECTS) break;
  }

  const names = ["project-alpha", "project-beta", "project-gamma"];
  const mapMessageId = createIdMapper("msg");
  const mapRequestId = createIdMapper("req");

  const staged = [];
  const timestamps = [];

  picked.forEach((entry, projectIndex) => {
    entry.files.forEach((file, fileIndex) => {
      const rows = [];
      for (const row of readJsonl(file)) {
        const usage = claudeUsage(row?.message?.usage);
        const timestamp = row?.timestamp;
        if (!usage || typeof timestamp !== "string") continue;
        timestamps.push(timestamp);
        rows.push({
          type: "assistant",
          timestamp,
          requestId: mapRequestId(row.requestId),
          message: {
            id: mapMessageId(row?.message?.id),
            role: "assistant",
            model: typeof row?.message?.model === "string" ? row.message.model : "unknown",
            usage,
          },
        });
        if (rows.length === MAX_LINES_PER_FILE) break;
      }
      if (rows.length) {
        staged.push({
          path: join("claude", "projects", names[projectIndex], `session-${fileIndex + 1}.jsonl`),
          rows,
        });
      }
    });
  });

  return { staged, timestamps };
}

// ---------------------------------------------------------------- codex

function buildCodex() {
  const source = process.env.CODEX_HOME
    ? join(process.env.CODEX_HOME, "sessions")
    : join(HOME, ".codex", "sessions");

  const files = walk(source, (name) => name.endsWith(".jsonl")).filter((file) =>
    readJsonl(file).some((row) => row?.payload?.type === "token_count" && row?.payload?.info),
  );

  const staged = [];
  const timestamps = [];

  files.slice(0, MAX_CODEX_SESSIONS).forEach((file, index) => {
    const rows = [];
    let wroteMeta = false;

    for (const row of readJsonl(file)) {
      const timestamp = row?.timestamp;
      if (typeof timestamp !== "string") continue;

      if (!wroteMeta && row?.type === "session_meta") {
        timestamps.push(timestamp);
        rows.push({
          type: "session_meta",
          timestamp,
          // Only the basename ever reaches the scanner; the rest is invented.
          payload: { cwd: `/work/codex-app-${index + 1}` },
        });
        wroteMeta = true;
        continue;
      }

      // turn_context carries the model, and also cwd + the user's own
      // instructions. Only the model survives.
      if (row?.type === "turn_context" && typeof row?.payload?.model === "string") {
        timestamps.push(timestamp);
        rows.push({
          type: "turn_context",
          timestamp,
          payload: { model: row.payload.model },
        });
        continue;
      }

      const info = row?.payload?.type === "token_count" ? row.payload.info : null;
      if (!info) continue;

      timestamps.push(timestamp);
      rows.push({
        type: "event_msg",
        timestamp,
        payload: {
          type: "token_count",
          info: {
            total_token_usage: codexUsage(info.total_token_usage),
            last_token_usage: codexUsage(info.last_token_usage),
          },
        },
      });
      if (rows.length >= MAX_LINES_PER_FILE) break;
    }

    if (rows.some((row) => row.type === "event_msg")) {
      staged.push({
        path: join("codex", "sessions", "2026", "09", "01", `rollout-session-${index + 1}.jsonl`),
        rows,
      });
    }
  });

  return { staged, timestamps };
}

// ---------------------------------------------------------------- cursor

/**
 * There is no `~/.cursor/token-usage/usage.jsonl` on this machine — that file
 * only exists once a Cursor stop hook writes it, and nothing installs the hook
 * yet. This fixture is invented, and says so.
 */
function buildCursor() {
  const rows = [0, 1, 2].map((index) => ({
    ts: `2026-09-0${3 + index}T14:${20 + index}:00.000Z`,
    event: "stop",
    workspace: `cursor-workspace-${index + 1}`,
    total_tokens: 1500 + index * 375,
  }));
  return { staged: [{ path: join("cursor", "usage.jsonl"), rows }], timestamps: [] };
}

// ---------------------------------------------------------------- grok

/**
 * There is no ~/.grok on this machine. This fixture is written from the
 * documented ccusage format (path, `sessionUpdate: "turn_completed"`, the
 * token field names and `costUsdTicks` in 1e-10 USD) — it is not a capture of
 * a real session, and fixtures/README.md says so. The adapter is marked
 * "community-tested" until someone runs it against real Grok data.
 */
function buildGrok() {
  const encodedCwd = encodeURIComponent("/work/grok-app").replace(/%2F/g, "%2F");
  const session = "5f2c1a90-0c1e-4b7b-9f3a-2d6e8c4b1a77";
  const rows = [0, 1, 2, 3].map((index) => ({
    timestamp: `2026-09-0${2 + index}T16:${10 + index * 7}:00.000Z`,
    sessionUpdate: "turn_completed",
    model: index % 2 === 0 ? "grok-4.6" : "grok-4.3",
    usage: {
      inputTokens: 42_000 + index * 3_100,
      cachedReadTokens: 30_000 + index * 2_000,
      cacheCreationTokens: 1_500 + index * 120,
      outputTokens: 900 + index * 210,
      reasoningTokens: 300 + index * 60,
    },
    costUsdTicks: (120_000_000 + index * 9_100_000),
  }));
  // A row the scanner must skip: right shape, wrong event.
  rows.splice(2, 0, {
    timestamp: "2026-09-03T16:20:00.000Z",
    sessionUpdate: "turn_started",
    model: "grok-4.6",
    usage: { inputTokens: 999_999, outputTokens: 999_999 },
    costUsdTicks: 999_999_999,
  });
  return {
    staged: [{ path: join("grok", "sessions", encodedCwd, session, "updates.jsonl"), rows }],
    timestamps: [],
  };
}

// ---------------------------------------------------------------- write

const claude = buildClaude();
const codex = buildCodex();
const cursor = buildCursor();
const grok = buildGrok();

const remapDay = createDayMapper([...claude.timestamps, ...codex.timestamps]);

const files = [];
for (const { staged } of [claude, codex]) {
  for (const file of staged) {
    const rows = file.rows.map((row) => ({ ...row, timestamp: remapDay(row.timestamp) }));
    files.push({ path: file.path, body: `${rows.map((r) => JSON.stringify(r)).join("\n")}\n` });
  }
}
for (const file of [...cursor.staged, ...grok.staged]) {
  files.push({
    path: file.path,
    body: `${file.rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  });
}

files.sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  generatedBy: "scripts/anonymize-fixtures.mjs",
  lastDay: FIXTURE_LAST_DAY,
  files: files.map((file) => ({
    path: file.path.split(/[\\/]/).join("/"),
    lines: file.body.trimEnd().split("\n").length,
    sha256: createHash("sha256").update(file.body).digest("hex").slice(0, 16),
  })),
};
const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;

if (CHECK) {
  const current = existsSync(join(OUT, "manifest.json"))
    ? readFileSync(join(OUT, "manifest.json"), "utf8")
    : "";
  if (current !== manifestBody) {
    console.error("fixtures are out of date; run node scripts/anonymize-fixtures.mjs");
    process.exit(1);
  }
  console.log("fixtures match the manifest");
  process.exit(0);
}

for (const directory of ["claude", "codex", "cursor", "grok"]) {
  rmSync(join(OUT, directory), { recursive: true, force: true });
}
for (const file of files) {
  const target = join(OUT, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.body);
}
writeFileSync(join(OUT, "manifest.json"), manifestBody);

console.log(`wrote ${files.length} fixture files`);
for (const file of manifest.files) console.log(`  ${file.path}  ${file.lines} lines`);
