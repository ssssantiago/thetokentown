/**
 * `sync --hook [--flush]`: what the tools' hooks call. SPEC §7.
 *
 * Two processes, so the host tool never waits for a scan or a request:
 *
 *   hook entry (this process, synchronous, < 50 ms)
 *     read stdin ≤ 200 ms and ignore it, except `stop_hook_active`
 *     no token → log, exit 0
 *     throttled (last-sync < 10 min, no --flush) → log, exit 0
 *     stamp last-sync, spawn the worker detached, log the elapsed ms, exit 0
 *
 *   worker (`sync --hook --worker`, detached, nobody waits for it)
 *     incremental scan → full Snapshot v2 → POST with AbortSignal.timeout(3000)
 *     any failure → queue.json, retried by the next run
 *
 * Plain `sync` (no --hook) does the worker's job in the foreground and
 * prints the result — for people, and for tests. Every path exits 0 when
 * called by a hook: a hook must never break the tool that called it.
 *
 * The hook entry lives in hook.ts so that the bundle can load it without
 * evaluating the scanners, the pricing table or the API client.
 */

import { ApiError, postSnapshot, resolveSite } from "../api.ts";
import type { Flags } from "../flags.ts";
import { QUEUE_FILE } from "../paths.ts";
import { clearQueue, log, readConfig, readQueue, writeQueue } from "../store.ts";
import { buildSnapshot, scanSources } from "../sources.ts";
import { bold, dim, green, yellow } from "../ui.ts";

const HOOK_POST_TIMEOUT_MS = 3_000;
const FOREGROUND_POST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------- worker

async function send(
  site: string,
  token: string,
  snapshot: Parameters<typeof postSnapshot>[2],
  timeoutMs: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const reply = await postSnapshot(site, token, snapshot, timeoutMs);
    const bits = [
      reply.floors !== undefined ? `${reply.floors} floors` : null,
      reply.lightsOn !== undefined ? (reply.lightsOn ? "lights on" : "lights off") : null,
      reply.citizenNo !== undefined ? `Citizen #${reply.citizenNo}` : null,
      reply.url ?? null,
    ].filter(Boolean);
    return { ok: true, text: bits.join(" · ") };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : `${(error as Error).name}: ${(error as Error).message}`;
    return { ok: false, error: message };
  }
}

async function runSync(flags: Flags, foreground: boolean): Promise<number> {
  const started = Date.now();
  const config = readConfig();
  const site = resolveSite(flags.site ?? config.site);
  const timeoutMs = foreground ? FOREGROUND_POST_TIMEOUT_MS : HOOK_POST_TIMEOUT_MS;
  const say = (line: string): void => {
    if (foreground) console.log(line);
  };

  if (!config.token) {
    log("worker: not logged in");
    say(`  ${yellow("!")} not logged in. Run ${bold("thetokentown login")} first.`);
    return foreground ? 1 : 0;
  }

  const previous = readQueue();

  if (flags.queueOnly) {
    if (!previous) {
      log("worker: queue only, but the queue is empty");
      return 0;
    }
    // The current site wins: --site, the environment, then the one the
    // token was issued by. What the queue recorded is only for the log.
    const result = await send(site, config.token, previous.snapshot, timeoutMs);
    if (result.ok) {
      clearQueue();
      log(`worker: queued snapshot sent after ${previous.attempts} failed attempt(s): ${result.text}`);
      say(`  ${green("✓")} queued snapshot sent: ${result.text}`);
      return 0;
    }
    writeQueue({ ...previous, attempts: previous.attempts + 1, lastError: result.error });
    log(`worker: queued snapshot still failing (attempt ${previous.attempts + 1}): ${result.error}`);
    say(`  ${yellow("!")} still failing: ${result.error}`);
    return foreground ? 1 : 0;
  }

  const summary = await scanSources({ days: flags.days, incremental: true });
  const snapshot = buildSnapshot(summary, {
    machineId: config.machineId,
    source: "cli",
    building: config.building ?? "main",
  });
  const scanNote = `${snapshot.daily.length} rows, scanned [${summary.scanned.join(",")}] cached [${summary.cached.join(",")}] in ${Date.now() - started} ms`;

  const result = await send(site, config.token, snapshot, timeoutMs);
  if (result.ok) {
    clearQueue();
    log(`worker: synced ${scanNote}${previous ? ", queue cleared" : ""}: ${result.text}`);
    say(`  ${green("✓")} synced ${dim(scanNote)}\n  ${result.text}`);
    return 0;
  }

  writeQueue({
    snapshot,
    site,
    queuedAt: new Date().toISOString(),
    attempts: (previous?.attempts ?? 0) + 1,
    lastError: result.error,
  });
  log(`worker: POST failed, snapshot queued (${scanNote}; attempt ${(previous?.attempts ?? 0) + 1}): ${result.error}`);
  say(`  ${yellow("!")} ${result.error}\n  ${dim(`snapshot queued in ${QUEUE_FILE}; the next sync retries`)}`);
  return foreground ? 1 : 0;
}

/** The worker (`--hook --worker`) or a foreground sync; the hook entry is in hook.ts. */
export async function syncCommand(flags: Flags): Promise<number> {
  try {
    return await runSync(flags, !flags.hook);
  } catch (error) {
    log(`worker: ${(error as Error).stack ?? (error as Error).message}`);
    if (!flags.hook) console.error(`  ${yellow("!")} ${(error as Error).message}`);
    return flags.hook ? 0 : 1;
  }
}
