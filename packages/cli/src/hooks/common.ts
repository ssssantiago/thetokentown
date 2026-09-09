/**
 * What every hook installer shares. SPEC §7.
 *
 * A `HookPlan` is a proposed edit: the file, its text before and after, and
 * what to remember in config.json. Nothing is written until the user has seen
 * the diff and said yes; then the original is copied to `*.bak.thetokentown`
 * and the new text replaces it.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";

import type { HookRecord, HookTool } from "../store.ts";

/**
 * How our entries are recognised in someone else's config, whatever the
 * platform wrapped the binary in. On POSIX the command is literally
 * `<abs>/thetokentown sync --hook`; on Windows the binary is
 * `node.exe "<abs>\thetokentown.mjs" sync --hook`, so the extension and a
 * closing quote are allowed between the name and `sync`.
 */
export const OURS = /thetokentown(?:\.(?:mjs|cjs|js|cmd|exe))?["']?\s+sync\b/;

export const isOurs = (command: string): boolean => OURS.test(command);

export const BACKUP_SUFFIX = ".bak.thetokentown";

export const backupPath = (file: string): string => `${file}${BACKUP_SUFFIX}`;

// ---------------------------------------------------------------- binary

/**
 * The absolute command that runs this very CLI, as argv parts. Never `npx`:
 * a hook must not download anything. When the entry point is the bin shim
 * (a global install), that is the command; when it is the bundled script,
 * the running node plus the script is.
 */
export function binaryParts(): string[] {
  const entry = process.argv[1] ?? "";
  const name = basename(entry);
  if (name === "thetokentown" && process.platform !== "win32") return [entry];
  return [process.execPath, entry];
}

/**
 * Quotes a part for a command line when it needs it. Backslashes are escaped
 * on POSIX, where a shell would eat them; on Windows they are path
 * separators and both cmd.exe and bash leave them alone inside quotes.
 */
export function quoteArg(part: string): string {
  if (!/[\s"'$`\\]/.test(part) || /^"[^"]*"$/.test(part)) return part;
  const escaped = process.platform === "win32" ? part.replace(/"/g, '\\"') : part.replace(/(["\\])/g, "\\$1");
  return `"${escaped}"`;
}

/** `"<node>" "<script>" sync --hook [--flush]` as one string. */
export function hookCommand(flush: boolean): string {
  const parts = [...binaryParts(), "sync", "--hook"];
  if (flush) parts.push("--flush");
  return parts.map(quoteArg).join(" ");
}

// ---------------------------------------------------------------- plan

export interface HookPlan {
  tool: HookTool;
  label: string;
  file: string;
  /** The file's current text; "" when it does not exist yet. */
  before: string;
  after: string;
  /** Extra files to write alongside (wrapper scripts). */
  extras?: { path: string; content: string; mode?: number }[];
  /** What to remember for uninstall. */
  record?: HookRecord;
  /** Files to delete after the edit (wrapper scripts, a file we created). */
  remove?: string[];
  /**
   * Replaces the file write entirely — for things that are not files, like
   * a crontab or a scheduled task. Receives `after`; returns a note.
   */
  write?: (after: string) => string | undefined;
}

export type PlanOutcome =
  | { kind: "plan"; plan: HookPlan }
  | { kind: "noop"; label: string; reason: string }
  | { kind: "refuse"; label: string; reason: string };

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * The pre-install bytes, when they can be put back verbatim: the file still
 * reads exactly as install left it, and the backup (or the fact that the
 * file did not exist) is known. Returns null when the user edited the file
 * since — then the caller edits surgically instead.
 */
export function verbatimRestore(
  file: string,
  current: string,
  record: HookRecord | undefined,
): { after: string; removeFile: boolean } | null {
  if (!record?.writtenHash || sha256(current) !== record.writtenHash) return null;
  if (record.createdFile) return { after: "", removeFile: true };
  const backup = backupPath(file);
  if (!existsSync(backup)) return null;
  return { after: readFileSync(backup, "utf8"), removeFile: false };
}

export function fileText(file: string): string {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

/**
 * Applies a plan: backup, extras, the file itself, removals. Returns the
 * backup path and any note the custom writer produced.
 */
export function applyPlan(plan: HookPlan): { backup: string | null; note?: string } {
  let backup: string | null = null;
  for (const extra of plan.extras ?? []) {
    mkdirSync(dirname(extra.path), { recursive: true });
    writeFileSync(extra.path, extra.content, { mode: extra.mode ?? 0o755 });
  }
  let note: string | undefined;
  if (plan.write) {
    note = plan.write(plan.after);
  } else {
    if (existsSync(plan.file)) {
      backup = backupPath(plan.file);
      copyFileSync(plan.file, backup);
    } else {
      mkdirSync(dirname(plan.file), { recursive: true });
    }
    writeFileSync(plan.file, plan.after, "utf8");
  }
  for (const path of plan.remove ?? []) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* best effort */
    }
  }
  return note === undefined ? { backup } : { backup, note };
}

// ---------------------------------------------------------------- diff

/**
 * A small line diff for the terminal: changed hunks with up to `context`
 * lines around them. It is LCS-based, so an insertion in the middle of a
 * file shows as an insertion and not as a rewrite of everything after it.
 */
export function unifiedDiff(before: string, after: string, context = 5): string {
  const a = before.split("\n");
  const b = after.split("\n");
  if (before === "") a.length = 0;
  if (after === "") b.length = 0;

  // LCS table
  const n = a.length;
  const m = b.length;
  const table: Uint32Array[] = [];
  for (let i = 0; i <= n; i += 1) table.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  type Op = { kind: " " | "-" | "+"; text: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: "-", text: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: "+", text: b[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ kind: "-", text: a[i++]! });
  while (j < m) ops.push({ kind: "+", text: b[j++]! });

  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.kind === " ") return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k += 1) keep[k] = true;
  });

  const lines: string[] = [];
  let gap = false;
  ops.forEach((op, index) => {
    if (!keep[index]) {
      gap = true;
      return;
    }
    if (gap && lines.length > 0) lines.push("  ...");
    gap = false;
    lines.push(`${op.kind} ${op.text}`);
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------- json

/** The indent unit a JSON file uses, so a rewrite keeps its shape. */
export function detectIndent(text: string): string {
  const match = /^([ \t]+)"/m.exec(text);
  return match ? match[1]! : "  ";
}

export function serializeJson(value: unknown, like: string): string {
  const body = JSON.stringify(value, null, detectIndent(like));
  return like === "" || like.endsWith("\n") ? `${body}\n` : body;
}

export const scriptExtension = (): string => (process.platform === "win32" ? ".cmd" : ".sh");

export const isScript = (path: string): boolean => [".sh", ".cmd"].includes(extname(path));
