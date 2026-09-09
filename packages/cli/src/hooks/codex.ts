/**
 * Codex CLI: `~/.codex/config.toml` → top-level `notify`. SPEC §7.
 *
 *   notify = ["<abs>/thetokentown", "sync", "--hook"] # thetokentown sync
 *
 * Codex allows a single notify command, so when one is already configured a
 * wrapper script in ~/.thetokentown/bin runs ours and then hands over to the
 * original with the same arguments. The previous `notify` line is kept
 * verbatim in config.json and put back on uninstall.
 *
 * There is no TOML dependency on purpose (the CLI ships with none). The
 * edit is a single top-level assignment, found by a line scanner that knows
 * enough TOML to tell where the top-level table ends and whether a value
 * spans lines. Anything it cannot read with confidence, it refuses to touch.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { BIN_DIR, CODEX_CONFIG_FILE } from "../paths.ts";
import type { HookRecord } from "../store.ts";
import type { HookPlan, PlanOutcome } from "./common.ts";
import { binaryParts, fileText, hookCommand, isOurs, quoteArg, scriptExtension, sha256, verbatimRestore } from "./common.ts";

const LABEL = "Codex CLI";
const MARKER = "# thetokentown sync";

// ---------------------------------------------------------------- toml

/** A TOML basic string: backslashes and quotes escaped, everything else raw. */
export function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function unescapeBasic(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, code: string) => {
    switch (code[0]) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "u":
      case "U":
        return String.fromCodePoint(Number.parseInt(code.slice(1), 16));
      default:
        return code;
    }
  });
}

/** The string members of a one-level TOML array literal, or null. */
export function parseStringArray(literal: string): string[] | null {
  const trimmed = literal.trim().replace(/#[^\n]*$/gm, "").trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1);
  const items: string[] = [];
  const token = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(,|$)/y;
  let index = 0;
  while (index < inner.length) {
    if (/^\s*$/.test(inner.slice(index))) break;
    token.lastIndex = index;
    const match = token.exec(inner);
    if (!match) return null;
    items.push(match[1] !== undefined ? unescapeBasic(match[1]) : match[2]!);
    index = token.lastIndex;
  }
  return items;
}

interface TopLevel {
  /** Line index where the first `[table]` header starts, or lines.length. */
  end: number;
  /** The `notify` assignment, if one exists at the top level. */
  notify: { start: number; end: number; text: string; values: string[] | null } | null;
  /** A line the scanner could not classify, if any. */
  unreadable: string | null;
}

/**
 * Walks the top-level table. It understands comments, `key = value`,
 * multi-line arrays, and multi-line strings — enough to find `notify` and
 * to notice when the file is not TOML at all.
 */
export function scanTopLevel(text: string): TopLevel {
  const lines = text.split("\n");
  const out: TopLevel = { end: lines.length, notify: null, unreadable: null };
  let depth = 0;
  let multi: '"""' | "'''" | null = null;
  let open: { key: string; start: number } | null = null;

  const bracketDelta = (line: string): number => {
    let delta = 0;
    let quote: '"' | "'" | null = null;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i]!;
      if (quote) {
        if (char === "\\" && quote === '"') i += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "#") break;
      if (char === '"' || char === "'") quote = char;
      else if (char === "[") delta += 1;
      else if (char === "]") delta -= 1;
    }
    return delta;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (multi) {
      if (line.includes(multi)) multi = null;
      continue;
    }
    if (open) {
      depth += bracketDelta(line);
      if (depth <= 0) {
        if (open.key === "notify") {
          const text = lines.slice(open.start, index + 1).join("\n");
          out.notify = { start: open.start, end: index, text, values: parseStringArray(text.replace(/^[^=]*=/, "")) };
        }
        open = null;
        depth = 0;
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      out.end = index;
      break;
    }
    const assignment = /^\s*([A-Za-z0-9_\-."']+)\s*=\s*(.*)$/.exec(line);
    if (!assignment) {
      out.unreadable = line;
      break;
    }
    const key = assignment[1]!.replace(/^["']|["']$/g, "");
    const value = assignment[2]!;
    if (value.startsWith('"""') || value.startsWith("'''")) {
      const fence = value.slice(0, 3) as '"""' | "'''";
      if (!value.slice(3).includes(fence)) multi = fence;
      continue;
    }
    depth = bracketDelta(value);
    if (depth > 0) {
      open = { key, start: index };
      continue;
    }
    if (key === "notify") {
      out.notify = { start: index, end: index, text: line, values: parseStringArray(value) };
    }
  }
  return out;
}

// ---------------------------------------------------------------- wrapper

function wrapperScript(original: string[]): string {
  const ours = hookCommand(false);
  if (process.platform === "win32") {
    return [
      "@echo off",
      "rem thetokentown sync -- Codex notify wrapper.",
      "rem Runs thetokentown, then the notify command that was configured before it.",
      `call ${ours} %*`,
      `${original.map(quoteArg).join(" ")} %*`,
      "",
    ].join("\r\n");
  }
  return [
    "#!/bin/sh",
    "# thetokentown sync — Codex notify wrapper.",
    "# Runs thetokentown, then hands over to the notify command that was configured before it.",
    `${ours} "$@"`,
    `exec ${original.map(quoteArg).join(" ")} "$@"`,
    "",
  ].join("\n");
}

const wrapperPath = (): string => join(BIN_DIR, `codex-notify${scriptExtension()}`);

// ---------------------------------------------------------------- plans

/** Puts `line` after the last non-blank line of the top-level table. */
function insertTopLevel(text: string, end: number, line: string): string {
  const lines = text.split("\n");
  let at = end;
  while (at > 0 && lines[at - 1]!.trim() === "") at -= 1;
  if (text === "") return `${line}\n`;
  lines.splice(at, 0, line);
  return lines.join("\n");
}

function replaceLines(text: string, start: number, end: number, replacement: string | null): string {
  const lines = text.split("\n");
  if (replacement === null) {
    lines.splice(start, end - start + 1);
  } else {
    lines.splice(start, end - start + 1, ...replacement.split("\n"));
  }
  return lines.join("\n");
}

export function codexInstallPlan(): PlanOutcome {
  const file = CODEX_CONFIG_FILE;
  const before = fileText(file);
  const top = scanTopLevel(before);
  if (top.unreadable !== null) {
    return { kind: "refuse", label: LABEL, reason: `${file} does not look like TOML near "${top.unreadable.trim()}"; not touching it` };
  }

  const direct = `notify = [${[...binaryParts(), "sync", "--hook"].map(tomlString).join(", ")}] ${MARKER}`;
  const record: HookRecord = { file, installedAt: new Date().toISOString() };
  let after: string;
  let extras: HookPlan["extras"];

  if (!top.notify) {
    after = insertTopLevel(before, top.end, direct);
  } else if (isOurs(top.notify.text)) {
    return { kind: "noop", label: LABEL, reason: `already installed in ${file}` };
  } else {
    if (!top.notify.values || top.notify.values.length === 0) {
      return { kind: "refuse", label: LABEL, reason: `${file}: could not read the existing notify value; not touching it` };
    }
    const wrapper = wrapperPath();
    const line = `notify = [${tomlString(wrapper)}] ${MARKER} (wrapper; also runs the previous notify)`;
    after = replaceLines(before, top.notify.start, top.notify.end, line);
    extras = [{ path: wrapper, content: wrapperScript(top.notify.values) }];
    record.originalNotifyLine = top.notify.text;
    record.wrapper = wrapper;
  }

  record.writtenHash = sha256(after);
  record.createdFile = !existsSync(file);
  const plan: HookPlan = { tool: "codex", label: LABEL, file, before, after, record };
  if (extras) plan.extras = extras;
  return { kind: "plan", plan };
}

export function codexUninstallPlan(record: HookRecord | undefined): PlanOutcome {
  const file = record?.file ?? CODEX_CONFIG_FILE;
  if (!existsSync(file)) return { kind: "noop", label: LABEL, reason: `${file} does not exist` };

  const before = fileText(file);
  const wrapper = record?.wrapper;

  // Untouched since install: the pre-install bytes come back verbatim.
  const verbatim = verbatimRestore(file, before, record);
  if (verbatim) {
    const plan: HookPlan = { tool: "codex", label: LABEL, file, before, after: verbatim.after };
    plan.remove = [...(wrapper ? [wrapper] : []), ...(verbatim.removeFile ? [file] : [])];
    return { kind: "plan", plan };
  }

  const top = scanTopLevel(before);
  if (top.unreadable !== null) {
    return { kind: "refuse", label: LABEL, reason: `${file} does not look like TOML near "${top.unreadable.trim()}"; not touching it` };
  }
  if (!top.notify || !isOurs(top.notify.text)) {
    return { kind: "noop", label: LABEL, reason: `nothing of ours in ${file}` };
  }

  const after = replaceLines(before, top.notify.start, top.notify.end, record?.originalNotifyLine ?? null);
  const plan: HookPlan = { tool: "codex", label: LABEL, file, before, after };
  if (wrapper) plan.remove = [wrapper];
  return { kind: "plan", plan };
}

export function codexInstalled(): boolean {
  const top = scanTopLevel(fileText(CODEX_CONFIG_FILE));
  return Boolean(top.notify && isOurs(top.notify.text));
}
