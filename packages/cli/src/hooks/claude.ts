/**
 * Claude Code: `~/.claude/settings.json` → `hooks.Stop` and `hooks.SessionEnd`.
 * SPEC §7.
 *
 *   { "type": "command", "command": "<abs> sync --hook", "async": true, "timeout": 10 }
 *
 * SessionEnd gets `--flush` so the last session of the day is not throttled
 * away. The merge is surgical: our entries are found by the `thetokentown
 * sync` substring, everything else in the file is carried through untouched,
 * and the JSON is re-emitted with the file's own indentation so that a
 * later uninstall leaves third-party hooks byte-identical.
 */

import { existsSync } from "node:fs";

import { CLAUDE_SETTINGS_FILE } from "../paths.ts";
import type { HookRecord } from "../store.ts";
import type { HookPlan, PlanOutcome } from "./common.ts";
import { fileText, hookCommand, isOurs, serializeJson, sha256, verbatimRestore } from "./common.ts";

const LABEL = "Claude Code";
const EVENTS = [
  { event: "Stop", flush: false },
  { event: "SessionEnd", flush: true },
] as const;

type Json = Record<string, unknown>;

interface HookEntry {
  type: string;
  command?: string;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [key: string]: unknown;
}

const asObject = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;

function parse(text: string): { ok: true; value: Json } | { ok: false; reason: string } {
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    const value = JSON.parse(text) as unknown;
    const object = asObject(value);
    return object ? { ok: true, value: object } : { ok: false, reason: "top level is not an object" };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

function groupHasOurs(group: HookGroup): boolean {
  return (group.hooks ?? []).some((hook) => typeof hook.command === "string" && isOurs(hook.command));
}

/** Removes our entries from a list of groups, dropping groups left empty. */
function withoutOurs(groups: unknown): { groups: HookGroup[]; removed: number } {
  if (!Array.isArray(groups)) return { groups: [], removed: 0 };
  let removed = 0;
  const kept: HookGroup[] = [];
  for (const raw of groups as HookGroup[]) {
    const group = asObject(raw) as HookGroup | null;
    if (!group || !Array.isArray(group.hooks)) {
      if (group) kept.push(group);
      continue;
    }
    const hooks = group.hooks.filter((hook) => {
      const ours = typeof hook?.command === "string" && isOurs(hook.command);
      if (ours) removed += 1;
      return !ours;
    });
    if (hooks.length > 0 || group.hooks.length === 0) kept.push({ ...group, hooks });
  }
  return { groups: kept, removed };
}

export function claudeInstallPlan(): PlanOutcome {
  const file = CLAUDE_SETTINGS_FILE;
  const before = fileText(file);
  const parsed = parse(before);
  if (!parsed.ok) {
    return { kind: "refuse", label: LABEL, reason: `${file} does not parse (${parsed.reason}); not touching it` };
  }

  const settings = structuredClone(parsed.value);
  const createdKeys: string[] = [];
  let hooks = asObject(settings["hooks"]);
  if (!hooks) {
    if (settings["hooks"] !== undefined) {
      return { kind: "refuse", label: LABEL, reason: `${file}: "hooks" is not an object; not touching it` };
    }
    hooks = {};
    settings["hooks"] = hooks;
    createdKeys.push("hooks");
  }

  for (const { event, flush } of EVENTS) {
    const command = hookCommand(flush);
    const existing = hooks[event];
    if (existing !== undefined && !Array.isArray(existing)) {
      return { kind: "refuse", label: LABEL, reason: `${file}: hooks.${event} is not an array; not touching it` };
    }
    if (existing === undefined) createdKeys.push(`hooks.${event}`);

    const { groups } = withoutOurs(existing);
    groups.push({ hooks: [{ type: "command", command, async: true, timeout: 10 }] });
    hooks[event] = groups;
  }

  const after = serializeJson(settings, before);
  if (after === before) {
    return { kind: "noop", label: LABEL, reason: `already installed in ${file}` };
  }

  const record: HookRecord = {
    file,
    createdKeys,
    writtenHash: sha256(after),
    createdFile: !existsSync(file),
    installedAt: new Date().toISOString(),
  };
  const plan: HookPlan = { tool: "claude", label: LABEL, file, before, after, record };
  return { kind: "plan", plan };
}

export function claudeUninstallPlan(record: HookRecord | undefined): PlanOutcome {
  const file = record?.file ?? CLAUDE_SETTINGS_FILE;
  if (!existsSync(file)) return { kind: "noop", label: LABEL, reason: `${file} does not exist` };

  const before = fileText(file);

  // Untouched since install: put the pre-install bytes back, whatever
  // formatting they had. Edited since: take only our entries out.
  const verbatim = verbatimRestore(file, before, record);
  if (verbatim) {
    const plan: HookPlan = { tool: "claude", label: LABEL, file, before, after: verbatim.after };
    if (verbatim.removeFile) plan.remove = [file];
    return { kind: "plan", plan };
  }

  const parsed = parse(before);
  if (!parsed.ok) {
    return { kind: "refuse", label: LABEL, reason: `${file} does not parse (${parsed.reason}); not touching it` };
  }

  const settings = structuredClone(parsed.value);
  const hooks = asObject(settings["hooks"]);
  if (!hooks) return { kind: "noop", label: LABEL, reason: `no hooks in ${file}` };

  const created = new Set(record?.createdKeys ?? []);
  let removed = 0;
  for (const { event } of EVENTS) {
    if (!Array.isArray(hooks[event])) continue;
    const result = withoutOurs(hooks[event]);
    removed += result.removed;
    // Delete the key only when it is empty AND (we created it, or nobody
    // recorded who did — an empty array is then ours by elimination).
    if (result.groups.length === 0 && (created.size === 0 || created.has(`hooks.${event}`))) {
      delete hooks[event];
    } else {
      hooks[event] = result.groups;
    }
  }
  if (Object.keys(hooks).length === 0 && (created.size === 0 || created.has("hooks"))) {
    delete settings["hooks"];
  }

  if (removed === 0) return { kind: "noop", label: LABEL, reason: `nothing of ours in ${file}` };

  const after = serializeJson(settings, before);
  const plan: HookPlan = { tool: "claude", label: LABEL, file, before, after };
  return { kind: "plan", plan };
}

/** True when settings.json currently carries one of our entries. */
export function claudeInstalled(): boolean {
  const parsed = parse(fileText(CLAUDE_SETTINGS_FILE));
  if (!parsed.ok) return false;
  const hooks = asObject(parsed.value["hooks"]);
  if (!hooks) return false;
  return EVENTS.some(({ event }) => Array.isArray(hooks[event]) && (hooks[event] as HookGroup[]).some(groupHasOurs));
}
