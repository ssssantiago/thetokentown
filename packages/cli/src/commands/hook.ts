/**
 * The hook entry: what `sync --hook` does before anything slow happens.
 * Kept free of heavy imports so that it loads in a few milliseconds; the
 * scan and the request happen in the detached worker (sync.ts). SPEC §7.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import type { Flags } from "../flags.ts";
import { QUEUE_FILE } from "../paths.ts";
import { lastSyncAt, log, markSync, readConfig } from "../store.ts";

export const THROTTLE_MS = 10 * 60 * 1000;
const STDIN_TIMEOUT_MS = 200;

// ---------------------------------------------------------------- stdin

/** Whatever arrived on stdin within 200 ms; "" on a terminal or on silence. */
function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    process.stdin.resume();
  });
}

function stopHookActive(input: string): boolean {
  if (!input.includes("stop_hook_active")) return false;
  try {
    return Boolean((JSON.parse(input) as { stop_hook_active?: unknown }).stop_hook_active);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- spawn

/**
 * Starts the worker and does not wait for it. On POSIX a detached spawn of
 * node costs a few milliseconds. On Windows CreateProcess of node.exe costs
 * 150–200 ms (measured on the second machine, Defender included), so the
 * hand-off goes through `cmd /c start /b`, which returns in ~10 ms and
 * starts node on its own time.
 */
function spawnDetached(command: string, args: string[]): ReturnType<typeof spawn> {
  if (process.platform !== "win32") {
    return spawn(command, args, { detached: true, stdio: "ignore", env: process.env });
  }
  const quote = (part: string): string => `"${part.replace(/"/g, '""')}"`;
  const line = `/d /s /c "start "" /b ${[command, ...args].map(quote).join(" ")}"`;
  return spawn(process.env["ComSpec"] ?? "cmd.exe", [line], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: true,
    env: process.env,
  });
}

// ---------------------------------------------------------------- entry

async function hookEntry(flags: Flags): Promise<number> {
  const boot = process.uptime() * 1000;
  const stdinStart = performance.now();
  const input = await readStdin(STDIN_TIMEOUT_MS);
  const stdinMs = performance.now() - stdinStart;
  if (stopHookActive(input)) {
    log("hook: stop_hook_active, nothing to do");
    return 0;
  }

  const config = readConfig();
  if (!config.token) {
    log("hook: skipped, not logged in (run `thetokentown login`)");
    return 0;
  }

  const now = Date.now();
  const age = now - lastSyncAt();
  const queued = existsSync(QUEUE_FILE);
  if (!flags.flush && age < THROTTLE_MS && !queued) {
    log(`hook: throttled, last sync ${Math.round(age / 1000)}s ago`);
    return 0;
  }
  const queueOnly = !flags.flush && age < THROTTLE_MS && queued;

  markSync(now);
  const args = [process.argv[1]!, "sync", "--hook", "--worker"];
  if (flags.flush) args.push("--flush");
  if (queueOnly) args.push("--queue-only");
  if (flags.site) args.push("--site", flags.site);

  let pid: number | undefined;
  const spawnStart = performance.now();
  try {
    const child = spawnDetached(process.execPath, args);
    child.unref();
    pid = child.pid;
  } catch (error) {
    log(`hook: could not start the worker: ${(error as Error).message}`);
    return 0;
  }

  const spawnMs = performance.now() - spawnStart;
  const elapsed = process.uptime() * 1000;
  log(
    `hook: handed off to worker pid ${pid ?? "?"} in ${elapsed.toFixed(1)} ms` +
      ` (boot ${boot.toFixed(1)}, stdin ${stdinMs.toFixed(1)}, spawn ${spawnMs.toFixed(1)})` +
      `${flags.flush ? ", flush" : ""}${queueOnly ? ", queue only" : ""}`,
  );
  return 0;
}

export async function hookCommand(flags: Flags): Promise<number> {
  try {
    return await hookEntry(flags);
  } catch (error) {
    log(`hook: ${(error as Error).message}`);
    return 0;
  }
}
