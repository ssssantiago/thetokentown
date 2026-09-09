/**
 * The commands that talk to a server, and the hook. SPEC §6, §7, §8.
 *
 * The server does not exist yet, so every test here runs against a small
 * in-process mock of the three routes the CLI uses. Every run gets its own
 * THETOKENTOWN_HOME, CLAUDE_CONFIG_DIR and CODEX_HOME under a temp dir, so
 * nothing touches the developer's real state.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI = fileURLToPath(new URL("../dist/thetokentown.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const LOCAL = fileURLToPath(new URL("./fixtures/", import.meta.url));

// ---------------------------------------------------------------- helpers

/** A fresh home plus tool dirs pointed at the committed fixtures. */
function sandbox({ copyTools = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "thetokentown-test-"));
  const home = join(root, "home");
  const claude = join(root, "claude");
  const codex = join(root, "codex");
  const grok = join(root, "grok");
  if (copyTools) {
    cpSync(`${FIXTURES}claude`, claude, { recursive: true });
    cpSync(`${FIXTURES}codex`, codex, { recursive: true });
    cpSync(`${FIXTURES}grok`, grok, { recursive: true });
  }
  const env = {
    THETOKENTOWN_HOME: home,
    CLAUDE_CONFIG_DIR: copyTools ? claude : `${FIXTURES}claude`,
    CODEX_HOME: copyTools ? codex : `${FIXTURES}codex`,
    GROK_HOME: copyTools ? grok : `${FIXTURES}grok`,
    THETOKENTOWN_CURSOR_LOG: join(root, "nowhere", "usage.jsonl"),
    THETOKENTOWN_POLL_MS: "20",
    TZ: "UTC",
    NO_COLOR: "1",
  };
  return {
    root,
    home,
    claude,
    codex,
    grok,
    env,
    file: (name) => join(home, name),
    read: (name) => readFileSync(join(home, name), "utf8"),
    json: (name) => JSON.parse(readFileSync(join(home, name), "utf8")),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Runs the CLI without blocking the event loop — the mock server lives in
 * this same process and has to be able to answer while the CLI waits.
 */
function run(args, env, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check()` is truthy, for up to `ms`. The detached worker needs this. */
async function eventually(check, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}

/** The mock of SPEC §8 as the CLI reads it (see src/api.ts). */
function mockServer({ poll = "complete", snapshot = 200 } = {}) {
  const calls = [];
  let polls = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
      const parsed = body ? JSON.parse(body) : null;
      calls.push({ path: request.url, headers: request.headers, body: parsed });
      const reply = (status, value) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/api/device/start") {
        return reply(200, {
          deviceCode: "dc-test-1",
          userCode: "ABCD-EFGH",
          verificationUrl: `${base()}/device`,
          expiresIn: 600,
          interval: 1,
        });
      }
      if (request.url === "/api/device/poll") {
        polls += 1;
        if (polls < 3) return reply(200, { status: "pending" });
        if (poll === "complete") {
          return reply(200, { status: "complete", token: "tok_test_123", handle: "builder-01", buildings: ["main", "work"] });
        }
        return reply(200, { status: poll });
      }
      if (request.url === "/api/snapshot") {
        if (request.headers.authorization !== "Bearer tok_test_123") return reply(401, { error: "bad token" });
        if (snapshot !== 200) return reply(snapshot, { error: "boom" });
        return reply(200, { url: `${base()}/b/builder-01`, floors: 12, lightsOn: true, citizenNo: 42 });
      }
      reply(404, { error: "not found" });
    });
  });
  const base = () => `http://127.0.0.1:${server.address().port}`;
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", async () => {
      resolve({
        url: base(),
        calls,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/** A URL nothing listens on. */
async function deadUrl() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  await new Promise((resolve) => server.close(resolve));
  return url;
}

async function login(box, url) {
  const result = await run(["login", "--no-open", "--site", url], box.env);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

// ---------------------------------------------------------------- login

test("login runs the device flow and stores the token", async () => {
  const box = sandbox();
  const server = await mockServer();
  try {
    const result = await login(box, server.url);
    assert.match(result.stdout, /ABCD-EFGH/, "the user code is shown");
    assert.match(result.stdout, new RegExp(`${server.url}/device`), "the verification URL is shown");
    assert.match(result.stdout, /logged in as @builder-01/);

    const config = box.json("config.json");
    assert.equal(config.token, "tok_test_123");
    assert.equal(config.handle, "builder-01");
    assert.equal(config.site, server.url);
    assert.equal(config.building, "main", "without a terminal the existing main building is the default");
    assert.match(config.machineId, /^[0-9a-f-]{36}$/);

    const start = server.calls.find((call) => call.path === "/api/device/start");
    assert.equal(start.body.machineId, config.machineId);
    assert.equal(start.body.cliVersion, "0.2.0");
    const polls = server.calls.filter((call) => call.path === "/api/device/poll");
    assert.equal(polls.length, 3, "pending, pending, complete");
    assert.ok(polls.every((call) => call.body.deviceCode === "dc-test-1"));

    if (process.platform !== "win32") {
      assert.equal(statSync(box.file("config.json")).mode & 0o777, 0o600, "the token file is 0600");
    }
    assert.doesNotMatch(result.stdout, /tok_test_123/, "the token is never printed");
  } finally {
    await server.close();
    box.cleanup();
  }
});

test("login --token stores a pasted token without a server", async () => {
  const box = sandbox();
  try {
    const result = await run(["login", "--token", "tok_pasted", "--site", "http://127.0.0.1:1"], box.env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(box.json("config.json").token, "tok_pasted");
  } finally {
    box.cleanup();
  }
});

test("login fails cleanly when the code expires or is denied", async () => {
  for (const poll of ["expired", "denied"]) {
    const box = sandbox();
    const server = await mockServer({ poll });
    try {
      const result = await run(["login", "--no-open", "--site", server.url], box.env);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /login failed/);
      assert.equal(existsSync(box.file("config.json")) && box.json("config.json").token, undefined);
    } finally {
      await server.close();
      box.cleanup();
    }
  }
});

// ---------------------------------------------------------------- publish

test("publish --yes posts the snapshot with the token and source cli", async () => {
  const box = sandbox();
  const server = await mockServer();
  try {
    await login(box, server.url);
    const result = await run(["publish", "--yes", "--no-open", "--since", "365"], box.env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /value built \(API pricing\)/);
    assert.match(result.stdout, /published — 12 floors · Citizen #42/);

    const call = server.calls.find((entry) => entry.path === "/api/snapshot");
    assert.ok(call, "one POST /api/snapshot");
    assert.equal(call.headers.authorization, "Bearer tok_test_123");
    assert.equal(call.body.version, 2);
    assert.equal(call.body.source, "cli");
    assert.equal(call.body.building, "main");
    assert.ok(call.body.daily.length > 0);
    assert.equal(call.body.machineId, box.json("config.json").machineId);
  } finally {
    await server.close();
    box.cleanup();
  }
});

test("publish without a token points at login and sends nothing", async () => {
  const box = sandbox();
  try {
    const result = await run(["publish", "--yes", "--no-open"], box.env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not logged in/);
  } finally {
    box.cleanup();
  }
});

test("publish without --yes and without a terminal does not send", async () => {
  const box = sandbox();
  const server = await mockServer();
  try {
    await login(box, server.url);
    const result = await run(["publish", "--no-open", "--since", "365"], box.env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Not published/);
    assert.equal(server.calls.filter((call) => call.path === "/api/snapshot").length, 0);
  } finally {
    await server.close();
    box.cleanup();
  }
});

// ---------------------------------------------------------------- sync

test("sync posts the full snapshot, keeps per-file cursors, and reuses them until a file changes", async () => {
  const box = sandbox({ copyTools: true });
  const server = await mockServer();
  try {
    await login(box, server.url);

    const first = await run(["sync", "--since", "365"], box.env);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /scanned \[claude,codex,grok\] cached \[\]/);
    assert.match(first.stdout, /12 floors · lights on · Citizen #42/);

    const state = box.json("state.json");
    assert.equal(state.version, 1);
    for (const id of ["claude", "codex", "grok"]) {
      assert.ok(Object.keys(state.sources[id].files).length > 0, `${id} has file cursors`);
      assert.ok(Object.values(state.sources[id].files).every((cursor) => /^\d+:\d+$/.test(cursor)), "size:mtime");
      assert.ok(state.sources[id].daily.length > 0, `${id} cached rows`);
    }

    const second = await run(["sync", "--since", "365"], box.env);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /scanned \[\] cached \[claude,codex,grok\]/);

    const posts = server.calls.filter((call) => call.path === "/api/snapshot");
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[1].body.daily, posts[0].body.daily, "the cached rows are the scanned rows");
    assert.equal(posts[0].body.source, "cli");
    assert.equal(posts[0].body.undedupedLines, 0);

    // Append one Claude event; only Claude is rescanned.
    const claudeFile = join(box.claude, "projects", "project-alpha", "session-1.jsonl");
    const sample = readFileSync(claudeFile, "utf8").split("\n").find((line) => line.includes('"usage"'));
    await sleep(20);
    writeFileSync(claudeFile, `${readFileSync(claudeFile, "utf8")}${sample.replace(/"id":"([^"]+)"/, '"id":"msg_new_1"')}\n`);

    const third = await run(["sync", "--since", "365"], box.env);
    assert.equal(third.status, 0, third.stderr);
    assert.match(third.stdout, /scanned \[claude\] cached \[codex,grok\]/);
  } finally {
    await server.close();
    box.cleanup();
  }
});

test("a corrupt state.json means a full rescan, never a failure", async () => {
  const box = sandbox();
  const server = await mockServer();
  try {
    await login(box, server.url);
    mkdirSync(box.home, { recursive: true });
    writeFileSync(box.file("state.json"), "{ this is not json");
    const result = await run(["sync", "--since", "365"], box.env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scanned \[claude,codex,grok\]/);
    assert.equal(box.json("state.json").version, 1, "rewritten");
  } finally {
    await server.close();
    box.cleanup();
  }
});

test("sync --hook exits 0 at once, hands off, and queues when the server is down", async () => {
  const box = sandbox();
  const dead = await deadUrl();
  try {
    await run(["login", "--token", "tok_test_123", "--site", dead], box.env);

    const started = Date.now();
    const result = await run(["sync", "--hook", "--flush", "--since", "365"], box.env, {
      input: JSON.stringify({ session_id: "abc", hook_event_name: "Stop", stop_hook_active: false }),
    });
    const wall = Date.now() - started;
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "", "a hook is silent");
    assert.equal(result.stderr, "", "a hook is silent");

    assert.ok(await eventually(() => existsSync(box.file("queue.json"))), "the worker queued the snapshot");
    const queue = box.json("queue.json");
    assert.equal(queue.snapshot.version, 2);
    assert.equal(queue.snapshot.source, "cli");
    assert.ok(queue.snapshot.daily.length > 0);
    assert.equal(queue.attempts, 1);
    assert.match(queue.lastError, /ECONNREFUSED/);

    const log = box.read("hook.log");
    const handoff = /hook: handed off to worker pid \d+ in ([\d.]+) ms \(boot ([\d.]+), stdin ([\d.]+), spawn ([\d.]+)\), flush/.exec(log);
    assert.ok(handoff, `hook.log has the hand-off line:\n${log}`);
    assert.match(log, /worker: POST failed, snapshot queued/);
    assert.ok(Number(handoff[1]) < wall, "the in-process figure is smaller than the wall clock");
    // SPEC §14 wants < 50 ms synchronous. The number is printed so a run on
    // any machine reports what it measured; the hard bound here only catches
    // a regression into seconds.
    console.log(`    hook hand-off: ${handoff[1]} ms in-process (boot ${handoff[2]}, stdin ${handoff[3]}, spawn ${handoff[4]}); ${wall} ms wall clock on ${process.platform}`);
    assert.ok(Number(handoff[1]) < 1000);
    assert.ok(Number(handoff[3]) < 200, "stdin was read, not waited for");

    assert.ok(existsSync(box.file("last-sync")), "the throttle stamp was written");
  } finally {
    box.cleanup();
  }
});

test("sync --hook honours the 10-minute throttle, --flush, stop_hook_active, and a missing token", async () => {
  const box = sandbox();
  try {
    // No token: log and leave.
    let result = await run(["sync", "--hook"], box.env, { input: "{}" });
    assert.equal(result.status, 0);
    assert.match(box.read("hook.log"), /skipped, not logged in/);
    assert.equal(existsSync(box.file("last-sync")), false);

    await run(["login", "--token", "tok_test_123", "--site", "http://127.0.0.1:1"], box.env);
    writeFileSync(box.file("last-sync"), `${Date.now() - 60_000}\n`);

    result = await run(["sync", "--hook"], box.env, { input: '{"session_id":"x"}' });
    assert.equal(result.status, 0);
    assert.match(box.read("hook.log"), /throttled, last sync 6\ds ago/);

    result = await run(["sync", "--hook", "--flush"], box.env, { input: '{"stop_hook_active": true}' });
    assert.equal(result.status, 0);
    assert.match(box.read("hook.log"), /stop_hook_active, nothing to do/);

    // Garbage on stdin is ignored, and a bad site is still exit 0.
    result = await run(["sync", "--hook", "--flush"], box.env, { input: "not json at all" });
    assert.equal(result.status, 0);
    assert.match(box.read("hook.log"), /handed off to worker/);
  } finally {
    await sleep(500); // let the detached worker finish before the dir goes away
    box.cleanup();
  }
});

test("a queued snapshot is retried by the next hook run and cleared on success", async () => {
  const box = sandbox();
  const dead = await deadUrl();
  try {
    await run(["login", "--token", "tok_test_123", "--site", dead], box.env);
    const failed = await run(["sync", "--since", "365"], box.env);
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /snapshot queued/);
    assert.ok(existsSync(box.file("queue.json")));

    const server = await mockServer();
    try {
      // Throttled (last-sync is fresh) but a queue exists → queue-only worker.
      writeFileSync(box.file("last-sync"), `${Date.now()}\n`);
      const hook = await run(["sync", "--hook", "--site", server.url], box.env, { input: "{}" });
      assert.equal(hook.status, 0);
      assert.ok(await eventually(() => !existsSync(box.file("queue.json"))), "queue cleared");
      assert.match(box.read("hook.log"), /queue only/);
      assert.match(box.read("hook.log"), /queued snapshot sent after 1 failed attempt/);
      const post = server.calls.find((call) => call.path === "/api/snapshot");
      assert.ok(post);
      assert.equal(post.body.source, "cli");
    } finally {
      await server.close();
    }
  } finally {
    box.cleanup();
  }
});

test("hook.log rotates past 1 MB", async () => {
  const box = sandbox();
  try {
    mkdirSync(box.home, { recursive: true });
    writeFileSync(box.file("hook.log"), "x".repeat(1024 * 1024 + 10));
    const result = await run(["sync", "--hook"], box.env, { input: "{}" });
    assert.equal(result.status, 0);
    assert.ok(existsSync(box.file("hook.log.1")), "rotated");
    assert.ok(statSync(box.file("hook.log")).size < 1024, "fresh log");
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------- install

/** A sandbox whose tool dirs carry the local hook fixtures. */
function hookSandbox({ codexFixture = "codex-config.toml" } = {}) {
  const box = sandbox({ copyTools: true });
  writeFileSync(join(box.claude, "settings.json"), readFileSync(join(LOCAL, "claude-settings.json")));
  writeFileSync(join(box.codex, "config.toml"), readFileSync(join(LOCAL, codexFixture)));
  rmSync(box.grok, { recursive: true, force: true }); // Grok is not installed here
  return box;
}

test("install wires Claude and Codex with a diff per tool, backs up, and uninstall restores byte-identical files", async () => {
  const box = hookSandbox();
  const server = await mockServer();
  const settingsFile = join(box.claude, "settings.json");
  const codexFile = join(box.codex, "config.toml");
  const settingsBefore = readFileSync(settingsFile, "utf8");
  const codexBefore = readFileSync(codexFile, "utf8");
  try {
    const result = await run(["install", "--yes", "--no-open", "--site", server.url, "--since", "365"], box.env);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /logged in as @builder-01/);
    assert.match(result.stdout, /Claude Code → .*settings\.json/);
    assert.match(result.stdout, /Codex CLI → .*config\.toml/);
    assert.match(result.stdout, /\+ .*sync --hook/, "the diff shows the added command");
    assert.match(result.stdout, /Apply for Claude Code\? \[y\/N\] y/);
    assert.match(result.stdout, /Apply for Codex CLI\? \[y\/N\] y/);
    assert.match(result.stdout, /Restart Claude Code/);

    // Claude: ours added, theirs untouched.
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    assert.deepEqual(settings.permissions, { allow: ["Bash(git status)"] });
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, "/usr/local/bin/some-linter --check");
    assert.equal(settings.hooks.Stop[0].hooks[0].command, "/home/builder/bin/notify-me 'done'", "third-party Stop hook first, unchanged");
    const ourStop = settings.hooks.Stop[1].hooks[0];
    assert.equal(ourStop.type, "command");
    assert.equal(ourStop.async, true);
    assert.equal(ourStop.timeout, 10);
    assert.match(ourStop.command, /thetokentown(\.mjs")? sync --hook$/);
    assert.ok(ourStop.command.replace(/\\\\/g, "\\").includes(CLI), `absolute path to this very binary: ${ourStop.command}`);
    assert.doesNotMatch(ourStop.command, /npx/);
    const ourEnd = settings.hooks.SessionEnd[0].hooks[0];
    assert.match(ourEnd.command, /sync --hook --flush$/);
    assert.equal(readFileSync(`${settingsFile}.bak.thetokentown`, "utf8"), settingsBefore, "backup is the original");

    // Codex: notify replaced by a wrapper that still calls the old command.
    const codex = readFileSync(codexFile, "utf8");
    assert.match(codex, /^notify = \[".*codex-notify\.(sh|cmd)"\] # thetokentown sync/m);
    assert.doesNotMatch(codex, /^notify = \["\/opt\/notifiers/m);
    assert.match(codex, /\[marketplaces\.example\]/, "the rest of the file is intact");
    const wrapperPath = /^notify = \["(.*)"\]/m.exec(codex)[1].replace(/\\\\/g, "\\");
    assert.ok(existsSync(wrapperPath), `wrapper exists at ${wrapperPath}`);
    const wrapper = readFileSync(wrapperPath, "utf8");
    assert.match(wrapper, /\/opt\/notifiers\/bin\/desktop-notify turn-ended/, "the previous notify is still called");
    assert.match(wrapper, /sync --hook/);
    assert.equal(readFileSync(`${codexFile}.bak.thetokentown`, "utf8"), codexBefore);

    // config.json remembers enough to undo.
    const config = box.json("config.json");
    assert.equal(config.hooks.claude.file, settingsFile);
    assert.match(config.hooks.codex.originalNotifyLine, /^notify = \["\/opt\/notifiers/);
    assert.equal(config.hooks.codex.wrapper, wrapperPath);
    assert.equal(config.hooks.grok, undefined);

    // status sees them; the bare command now means status.
    const status = await run(["status", "--json"], box.env);
    assert.equal(status.status, 0);
    assert.deepEqual(JSON.parse(status.stdout).hooks, { claude: true, codex: true, grok: false });
    const bare = await run(["--no-open"], box.env);
    assert.equal(bare.status, 0, bare.stderr);
    assert.match(bare.stdout, /Hooks/);
    assert.doesNotMatch(bare.stdout, /Apply for/);

    // A second install is a no-op.
    const again = await run(["install", "--yes", "--no-open", "--site", server.url, "--since", "365"], box.env);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /Claude Code: already installed/);
    assert.match(again.stdout, /Codex CLI: already installed/);

    // Uninstall with the files untouched since install: byte-identical.
    const removed = await run(["uninstall", "--yes"], box.env);
    assert.equal(removed.status, 0, removed.stderr + removed.stdout);
    assert.match(removed.stdout, /- .*sync --hook/);
    assert.equal(readFileSync(settingsFile, "utf8"), settingsBefore, "settings.json restored byte for byte");
    assert.equal(readFileSync(codexFile, "utf8"), codexBefore, "config.toml restored byte for byte");
    assert.equal(existsSync(wrapperPath), false, "wrapper removed");
    assert.equal(box.json("config.json").hooks, undefined);
    assert.equal(box.json("config.json").token, "tok_test_123", "the token survives an uninstall without --purge");

    const after = await run(["status", "--json"], box.env);
    assert.deepEqual(JSON.parse(after.stdout).hooks, { claude: false, codex: false, grok: false });

    // Install again, then edit both files by hand before uninstalling: now
    // only our entries come out and the edits (and third-party hooks) stay.
    const reinstall = await run(["install", "--yes", "--no-open", "--site", server.url, "--since", "365"], box.env);
    assert.equal(reinstall.status, 0, reinstall.stderr + reinstall.stdout);
    const edited = JSON.parse(readFileSync(settingsFile, "utf8"));
    edited.hooks.Stop.push({ matcher: "", hooks: [{ type: "command", command: "/home/builder/bin/after-ours" }] });
    edited.theme = "dark";
    writeFileSync(settingsFile, `${JSON.stringify(edited, null, 2)}\n`);
    writeFileSync(codexFile, `${readFileSync(codexFile, "utf8")}\n[added.by.hand]\nx = 1\n`);

    const surgical = await run(["uninstall", "--yes"], box.env);
    assert.equal(surgical.status, 0, surgical.stderr + surgical.stdout);
    const left = JSON.parse(readFileSync(settingsFile, "utf8"));
    assert.equal(left.theme, "dark");
    assert.deepEqual(
      left.hooks.Stop.map((group) => group.hooks.map((hook) => hook.command)),
      [["/home/builder/bin/notify-me 'done'"], ["/home/builder/bin/after-ours"]],
      "both third-party Stop hooks survive, in order, and ours is gone",
    );
    assert.equal(left.hooks.SessionEnd, undefined, "the key we created is removed when it is empty");
    assert.equal(left.hooks.PreToolUse[0].hooks[0].command, "/usr/local/bin/some-linter --check");
    const codexLeft = readFileSync(codexFile, "utf8");
    assert.equal(codexLeft, `${codexBefore}\n[added.by.hand]\nx = 1\n`, "the original notify line is back and the edit stays");
  } finally {
    await server.close();
    box.cleanup();
  }
});

test("install on a Codex config without notify adds one line; on a fresh Claude it creates the file", async () => {
  const box = hookSandbox({ codexFixture: "codex-config-plain.toml" });
  rmSync(join(box.claude, "settings.json"));
  const server = await mockServer();
  const codexFile = join(box.codex, "config.toml");
  const settingsFile = join(box.claude, "settings.json");
  const codexBefore = readFileSync(codexFile, "utf8");
  try {
    const result = await run(["install", "--yes", "--no-open", "--site", server.url, "--since", "365"], box.env);
    assert.equal(result.status, 0, result.stderr + result.stdout);

    const codex = readFileSync(codexFile, "utf8");
    assert.match(codex, /^model_reasoning_effort = "high"\nnotify = \[.*"sync", "--hook"\] # thetokentown sync\n\n\[plugins/m, "inserted after the last top-level key");
    assert.equal(existsSync(join(box.home, "bin")), false, "no wrapper when there was nothing to wrap");

    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.SessionEnd.length, 1);
    assert.equal(existsSync(`${settingsFile}.bak.thetokentown`), false, "nothing to back up");

    const removed = await run(["uninstall", "--yes", "--purge"], box.env);
    assert.equal(removed.status, 0, removed.stderr + removed.stdout);
    assert.equal(readFileSync(codexFile, "utf8"), codexBefore);
    assert.equal(existsSync(settingsFile), false, "a file install created is removed again");
    assert.equal(existsSync(box.home), false, "--purge removed the home");
  } finally {
    await server.close();
    box.cleanup();
  }
});

test("a config file that does not parse is refused and left untouched", async () => {
  const box = hookSandbox();
  const server = await mockServer();
  const settingsFile = join(box.claude, "settings.json");
  const codexFile = join(box.codex, "config.toml");
  writeFileSync(settingsFile, '{ "hooks": { "Stop": [ }');
  writeFileSync(codexFile, "model = \nthis is not toml\n");
  try {
    const result = await run(["install", "--yes", "--no-open", "--site", server.url, "--since", "365"], box.env);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /settings\.json does not parse .*not touching it/);
    assert.match(result.stdout, /config\.toml does not look like TOML .*not touching it/);
    assert.equal(readFileSync(settingsFile, "utf8"), '{ "hooks": { "Stop": [ }');
    assert.equal(readFileSync(codexFile, "utf8"), "model = \nthis is not toml\n");
    assert.equal(existsSync(`${settingsFile}.bak.thetokentown`), false);
    assert.equal(box.json("config.json").hooks, undefined);
  } finally {
    await server.close();
    box.cleanup();
  }
});

test("install stops before hooks when login fails, and says what to do", async () => {
  const box = hookSandbox();
  const server = await mockServer({ poll: "denied" });
  const settingsFile = join(box.claude, "settings.json");
  const before = readFileSync(settingsFile, "utf8");
  try {
    const result = await run(["install", "--yes", "--no-open", "--site", server.url, "--since", "365"], box.env);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /login failed/);
    assert.match(result.stdout, /login --token/);
    assert.equal(readFileSync(settingsFile, "utf8"), before);
  } finally {
    await server.close();
    box.cleanup();
  }
});

test("without a terminal and without --yes, install shows the diff and applies nothing", async () => {
  const box = hookSandbox();
  const server = await mockServer();
  const settingsFile = join(box.claude, "settings.json");
  const before = readFileSync(settingsFile, "utf8");
  try {
    const result = await run(["install", "--no-open", "--site", server.url, "--since", "365"], box.env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\+ .*sync --hook/);
    assert.match(result.stdout, /\[y\/N\] N/);
    assert.match(result.stdout, /Claude Code: skipped/);
    assert.equal(readFileSync(settingsFile, "utf8"), before);
  } finally {
    await server.close();
    box.cleanup();
  }
});
