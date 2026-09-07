import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

const CLI = fileURLToPath(new URL("../dist/thetokentown.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const BASELINE = JSON.parse(readFileSync(new URL("../../../fixtures/v1-baseline.json", import.meta.url), "utf8"));

/** Points every source at the committed fixtures, and pins the clock's zone. */
const fixtureEnv = {
  CLAUDE_CONFIG_DIR: `${FIXTURES}claude`,
  CODEX_HOME: `${FIXTURES}codex`,
  GROK_HOME: `${FIXTURES}grok`,
  THETOKENTOWN_CURSOR_LOG: `${FIXTURES}cursor/usage.jsonl`,
  TZ: "UTC",
};

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("--json prints a v2 Snapshot", () => {
  const snapshot = JSON.parse(run(["--json", "--since", "365"], fixtureEnv));

  assert.equal(snapshot.version, 2);
  assert.match(snapshot.cliVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(Number.isFinite(Date.parse(snapshot.generatedAt)));
  assert.equal(snapshot.source, "claim");
  assert.equal(snapshot.building, "main");
  assert.equal(typeof snapshot.machineId, "string");
  assert.ok(Number.isInteger(snapshot.undedupedLines));
  assert.ok(Array.isArray(snapshot.daily) && snapshot.daily.length > 0);

  for (const row of snapshot.daily) {
    assert.deepEqual(
      Object.keys(row).sort(),
      [
        "cacheRead",
        "cacheWrite",
        "costEstimated",
        "costUsd",
        "day",
        "input",
        "model",
        "output",
        "provider",
        "sessions",
        "turns",
      ],
      "the row shape is the SPEC §4.1 DailyUsage and nothing else",
    );
    assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(["claude", "codex", "grok", "cursor"].includes(row.provider));
  }
});

test("the snapshot reproduces the v1 CLI's per-source token totals", () => {
  const snapshot = JSON.parse(run(["--json", "--since", "365"], fixtureEnv));

  const bySource = new Map();
  for (const row of snapshot.daily) {
    const tokens = row.input + row.output + row.cacheRead + row.cacheWrite;
    bySource.set(row.provider, (bySource.get(row.provider) ?? 0) + tokens);
  }

  for (const source of BASELINE.sources) {
    if (source.name === "cursor") continue; // detect() is false; see NOTES.md
    assert.equal(bySource.get(source.name), source.tokens, `${source.name} tokens`);
  }
});

test("cursor is not scanned while detect() is false", () => {
  const snapshot = JSON.parse(run(["--json", "--since", "365"], fixtureEnv));
  assert.ok(
    snapshot.daily.every((row) => row.provider !== "cursor"),
    "the fixture log exists, and must still be skipped",
  );
});

test("grok rows carry the cost the log reported, not a derived one", () => {
  const snapshot = JSON.parse(run(["--json", "--since", "365"], fixtureEnv));
  const grok = snapshot.daily.filter((row) => row.provider === "grok");
  assert.ok(grok.length > 0);
  assert.ok(grok.every((row) => row.costEstimated === false));
  const cost = grok.reduce((sum, row) => sum + row.costUsd, 0);
  assert.equal(Number(cost.toFixed(5)), 0.05346, "534,600,000 ticks at 1e-10 USD");
});

test("the snapshot carries no path, no name and no handle", () => {
  const raw = run(["--json", "--since", "365"], fixtureEnv);
  const snapshot = JSON.parse(raw);
  // SPEC §14. machineId is a uuid and generatedAt is an instant; everything
  // else that could carry a path lives in `daily`, so check that directly.
  const serialized = JSON.stringify(snapshot.daily);
  for (const forbidden of ["/", "~", "Users", "home", "@"]) {
    assert.equal(serialized.includes(forbidden), false, `daily leaked ${forbidden}`);
  }
});

test("--demo produces a stable payload without touching the machine", () => {
  const snapshot = JSON.parse(run(["--demo", "--json", "--since", "30"]));
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.machineId, "demo", "demo must not mint or read a real machine id");
  assert.ok(snapshot.daily.length > 0);
  assert.ok(snapshot.daily.every((row) => row.costUsd === null || row.costUsd >= 0));
});

test("the human summary reports floors and value built, not spend", () => {
  const out = run(["--demo", "--no-open", "--since", "30"]);
  assert.match(out, /THE TOKEN TOWN/);
  assert.match(out, /floors/);
  assert.match(out, /value built \(API pricing\)/);
  assert.doesNotMatch(out, /spent|spend/i, "SPEC rule 1: never 'spent'");
});

test("the claim URL is printed without its fragment", () => {
  const out = run(["--no-open", "--since", "365"], fixtureEnv);
  assert.match(out, /https:\/\/thetokentown\.dev\/claim/);
  assert.doesNotMatch(out, /\/claim#/, "the payload must not be pasted into the terminal");
});

test("--site overrides the destination", () => {
  const out = run(["--no-open", "--site", "http://localhost:3000/", "--since", "365"], fixtureEnv);
  assert.match(out, /http:\/\/localhost:3000\/claim/);
});

test("the payload fits in a URL fragment, compressed, with room to spare", () => {
  // SPEC §5b.1: the claim rides in the fragment, gzipped and base64url'd, and
  // the CLI refuses to open a browser above 512 KB. This asserts the encoding
  // the browser has to undo, and how much headroom a real history leaves.
  const snapshot = JSON.parse(run(["--json", "--since", "365"], fixtureEnv));
  const raw = Buffer.from(JSON.stringify(snapshot), "utf8");
  const fragment = gzipSync(raw).toString("base64url");

  const decoded = JSON.parse(gunzipSync(Buffer.from(fragment, "base64url")).toString("utf8"));
  assert.deepEqual(decoded, snapshot, "the browser must get back exactly what was scanned");

  assert.ok(fragment.length < 512 * 1024, `fragment is ${fragment.length} bytes`);
  assert.ok(fragment.length < raw.length, "gzip must actually help");
});

test("an empty window says so instead of opening a claim", () => {
  const out = run(["--no-open", "--since", "1"], {
    CLAUDE_CONFIG_DIR: `${FIXTURES}nowhere`,
    CODEX_HOME: `${FIXTURES}nowhere`,
    GROK_HOME: `${FIXTURES}nowhere`,
    THETOKENTOWN_CURSOR_LOG: `${FIXTURES}nowhere/usage.jsonl`,
    TZ: "UTC",
  });
  assert.match(out, /Nothing to build yet/);
  assert.doesNotMatch(out, /Your building is ready/);
});

test("--help and --version answer without scanning", () => {
  assert.match(run(["--help"]), /npx thetokentown/);
  assert.match(run(["--version"]), /^\d+\.\d+\.\d+/);
});
