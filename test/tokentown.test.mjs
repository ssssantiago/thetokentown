import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = new URL("../bin/tokentown.mjs", import.meta.url);

test("aggregates and de-duplicates Claude Code and Codex events", () => {
  const root = mkdtempSync(join(tmpdir(), "tokentown-cli-"));
  const claude = join(root, "claude", "projects", "project-alpha");
  const codex = join(root, "codex", "sessions", "2026", "09", "06");
  const cursor = join(root, "cursor", "usage.jsonl");
  mkdirSync(claude, { recursive: true });
  mkdirSync(codex, { recursive: true });
  mkdirSync(dirname(cursor), { recursive: true });
  const now = new Date().toISOString();
  const claudeLine = JSON.stringify({ timestamp: now, sessionId: "a", message: { id: "msg-a", usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 25, cache_read_input_tokens: 10 } }, requestId: "req-a" });
  writeFileSync(join(claude, "a.jsonl"), `${claudeLine}\n${claudeLine}\n`);
  writeFileSync(join(codex, "rollout.jsonl"), [
    JSON.stringify({ timestamp: now, type: "session_meta", payload: { cwd: "/work/codex-app" } }),
    JSON.stringify({ timestamp: now, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000, output_tokens: 125, reasoning_output_tokens: 75, total_tokens: 1200 }, total_token_usage: { input_tokens: 1000, output_tokens: 125, reasoning_output_tokens: 75, total_tokens: 1200 } } } }),
    JSON.stringify({ timestamp: now, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 2500, output_tokens: 300, reasoning_output_tokens: 200, total_tokens: 3000 }, total_token_usage: { input_tokens: 3500, output_tokens: 425, reasoning_output_tokens: 275, total_tokens: 4200 } } } }),
  ].join("\n"));
  writeFileSync(cursor, JSON.stringify({ ts: now, event: "stop", workspace: "cursor-app", total_tokens: 615, prompt_preview: "must never appear in output" }));

  const result = spawnSync(process.execPath, [cli.pathname, "--json"], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(root, "claude"), CODEX_HOME: join(root, "codex"), TOKENTOWN_CURSOR_LOG: cursor },
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.totalTokens, 5000);
  assert.equal(summary.activeDays, 1);
  assert.equal(summary.projectCount, 3);
  assert.equal(summary.live, true);
  assert.deepEqual(summary.sources, [
    { name: "codex", tokens: 4200 },
    { name: "cursor", tokens: 615 },
    { name: "claude", tokens: 185 },
  ]);
  assert.doesNotMatch(result.stdout, /must never appear/);
});

test("demo output has a stable public-only schema", () => {
  const result = spawnSync(process.execPath, [cli.pathname, "--demo", "--json", "--since", "30"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.windowDays, 30);
  assert.ok(summary.totalTokens > 0);
  assert.ok(summary.daily.every((day) => Object.keys(day).sort().join(",") === "date,tokens"));
});

test("opens claims on the live TokenTown site by default", () => {
  const result = spawnSync(process.execPath, [cli.pathname, "--demo", "--no-open"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /https:\/\/token-town\.santitiago\.chatgpt\.site\/claim/);
});
