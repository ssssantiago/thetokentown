/**
 * Files under ~/.thetokentown: config, scan state, offline queue, throttle
 * stamp and the hook log. Every reader here tolerates a missing or corrupt
 * file — a hook must never fail because of its own bookkeeping. SPEC §6, §7.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

import type { DailyUsage, Snapshot } from "@thetokentown/core/types";

import { CONFIG_FILE, LAST_SYNC_FILE, LOG_FILE, QUEUE_FILE, STATE_FILE, TTT_HOME } from "./paths.ts";

// ---------------------------------------------------------------- config

export type HookTool = "claude" | "codex" | "grok";

export interface HookRecord {
  /** The file that was edited. */
  file: string;
  /** Keys this install created and may therefore delete again on uninstall. */
  createdKeys?: string[];
  /** Codex: the exact `notify = [...]` line(s) that were there before, verbatim. */
  originalNotifyLine?: string;
  /** Path of the wrapper script, when one was written. */
  wrapper?: string;
  /** Grok: the scheduler that was used (launchd, cron, schtasks). */
  scheduler?: string;
  /** sha256 of the text install wrote — lets uninstall restore the backup verbatim. */
  writtenHash?: string;
  /** The file did not exist before install; uninstall removes it again. */
  createdFile?: boolean;
  installedAt: string;
}

export interface Config {
  machineId: string;
  /** Hook token from the device flow. Never printed. */
  token?: string;
  /** GitHub handle the token belongs to, when the server told us. */
  handle?: string;
  /** Site the token was issued by; a different --site does not reuse it. */
  site?: string;
  /** Building slug this machine feeds. "main" by default. SPEC §4.2 */
  building?: string;
  hooks?: Partial<Record<HookTool, HookRecord>>;
}

export function ensureHome(): void {
  mkdirSync(TTT_HOME, { recursive: true, mode: 0o700 });
}

function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown, mode: number): void {
  ensureHome();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(tmp, file);
}

/** Reads config.json; a missing or corrupt file yields a fresh machine id. */
export function readConfig(): Config {
  const stored = readJson<Partial<Config>>(CONFIG_FILE);
  if (stored && typeof stored.machineId === "string" && stored.machineId) {
    return stored as Config;
  }
  return { ...(stored ?? {}), machineId: randomUUID() } as Config;
}

/** Persists config.json 0600. A read-only home is not an error. */
export function writeConfig(config: Config): void {
  try {
    writeJson(CONFIG_FILE, config, 0o600);
  } catch {
    /* the id just will not persist */
  }
}

export function updateConfig(patch: (config: Config) => void): Config {
  const config = readConfig();
  patch(config);
  writeConfig(config);
  return config;
}

/** The uuid for this install, minted and persisted on first use. */
export function machineId(): string {
  const config = readConfig();
  if (!existsSync(CONFIG_FILE)) writeConfig(config);
  return config.machineId;
}

// ---------------------------------------------------------------- state

export interface SourceState {
  /** The window the cached rows were scanned with, epoch ms. */
  since: number;
  /** Per-file cursor: "<size>:<mtimeMs>" for every file under the roots. */
  files: Record<string, string>;
  daily: DailyUsage[];
  undedupedLines: number;
  projects: string[];
  unknownModels: string[];
  scannedAt: string;
}

export interface State {
  version: 1;
  sources: Partial<Record<string, SourceState>>;
}

/** Corrupt or missing state means "scan everything", never an error. */
export function readState(): State {
  const stored = readJson<State>(STATE_FILE);
  if (stored && stored.version === 1 && stored.sources && typeof stored.sources === "object") {
    return stored;
  }
  return { version: 1, sources: {} };
}

export function writeState(state: State): void {
  try {
    writeJson(STATE_FILE, state, 0o600);
  } catch {
    /* next run scans from scratch */
  }
}

// ---------------------------------------------------------------- queue

export interface QueueEntry {
  snapshot: Snapshot;
  site: string;
  queuedAt: string;
  attempts: number;
  lastError: string;
}

export function readQueue(): QueueEntry | null {
  const entry = readJson<QueueEntry>(QUEUE_FILE);
  return entry && entry.snapshot && typeof entry.snapshot === "object" ? entry : null;
}

export function writeQueue(entry: QueueEntry): void {
  writeJson(QUEUE_FILE, entry, 0o600);
}

export function clearQueue(): void {
  try {
    if (existsSync(QUEUE_FILE)) unlinkSync(QUEUE_FILE);
  } catch {
    /* nothing to clear */
  }
}

// ---------------------------------------------------------------- throttle

/** Epoch ms of the last sync that was handed off, or 0. */
export function lastSyncAt(): number {
  try {
    const value = Number(readFileSync(LAST_SYNC_FILE, "utf8").trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function markSync(now = Date.now()): void {
  try {
    ensureHome();
    writeFileSync(LAST_SYNC_FILE, `${now}\n`, { mode: 0o600 });
  } catch {
    /* a missing stamp only means the next hook syncs again */
  }
}

// ---------------------------------------------------------------- log

const LOG_LIMIT = 1024 * 1024;

/** Appends one line to hook.log, rotating to hook.log.1 past 1 MB. */
export function log(message: string): void {
  try {
    ensureHome();
    try {
      if (statSync(LOG_FILE).size > LOG_LIMIT) renameSync(LOG_FILE, `${LOG_FILE}.1`);
    } catch {
      /* no log yet */
    }
    writeFileSync(LOG_FILE, `${new Date().toISOString()} [${process.pid}] ${message}\n`, {
      flag: "a",
      mode: 0o600,
    });
  } catch {
    /* logging must never be the thing that fails */
  }
}

export function tailLog(lines: number): string[] {
  try {
    return readFileSync(LOG_FILE, "utf8").trimEnd().split("\n").slice(-lines);
  } catch {
    return [];
  }
}
