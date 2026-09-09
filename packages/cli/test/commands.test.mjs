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

