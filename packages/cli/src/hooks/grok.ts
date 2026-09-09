/**
 * Grok CLI has no confirmed hook, so it rides along with the other tools'
 * hooks. Only when Grok is the ONLY source on the machine does `install`
 * register a 15-minute schedule that runs `sync --hook --flush`. SPEC §7.
 *
 *   macOS   ~/Library/LaunchAgents/dev.thetokentown.sync.plist  (launchd)
 *   Linux   crontab line ending in `# thetokentown sync`          (cron)
 *   Windows scheduled task `thetokentown-sync`                    (schtasks)
 *
 * The launchd and cron paths are written from their documented formats and
 * unit-tested as text; this branch was developed on Windows, where only the
 * schtasks path could be exercised for real.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { HOME, TTT_HOME } from "../paths.ts";
import type { HookRecord } from "../store.ts";
import type { HookPlan, PlanOutcome } from "./common.ts";
import { binaryParts, fileText, hookCommand, isOurs, quoteArg } from "./common.ts";

const LABEL = "Grok CLI (15-minute schedule)";
const CRON_MARKER = "# thetokentown sync";
const PLIST_LABEL = "dev.thetokentown.sync";
const TASK_NAME = "thetokentown-sync";
const INTERVAL_SECONDS = 900;

const plistPath = (): string => join(HOME, "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);

function run(command: string, args: string[], input?: string): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...(input === undefined ? {} : { input }) });
}

// ---------------------------------------------------------------- text

const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function launchdPlist(parts: string[]): string {
  const args = [...parts, "sync", "--hook", "--flush"].map((part) => `    <string>${xml(part)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xml(join(TTT_HOME, "launchd.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(TTT_HOME, "launchd.log"))}</string>
</dict>
</plist>
`;
}

export const cronLine = (): string => `*/15 * * * * ${hookCommand(true)} ${CRON_MARKER}`;

/** The crontab with our line added (once) or removed. */
export function mergeCrontab(current: string, line: string | null): string {
  const kept = current.split("\n").filter((entry) => entry !== "" && !isOurs(entry));
  if (line) kept.push(line);
  return kept.length ? `${kept.join("\n")}\n` : "";
}

// ---------------------------------------------------------------- plans

export function grokInstallPlan(soleSource: boolean): PlanOutcome {
  if (!soleSource) {
    return { kind: "noop", label: LABEL, reason: "Grok rides along with the other tools' hooks" };
  }
  const record: HookRecord = { file: "", installedAt: new Date().toISOString() };

  if (process.platform === "darwin") {
    const file = plistPath();
    const before = fileText(file);
    const after = launchdPlist(binaryParts());
    if (before === after) return { kind: "noop", label: LABEL, reason: `already installed in ${file}` };
    record.file = file;
    record.scheduler = "launchd";
    const plan: HookPlan = { tool: "grok", label: LABEL, file, before, after, record };
    return { kind: "plan", plan };
  }

  if (process.platform === "win32") {
    const file = `schtasks:${TASK_NAME}`;
    let before = "";
    try {
      before = run("schtasks", ["/Query", "/TN", TASK_NAME, "/FO", "LIST"]);
    } catch {
      /* no task yet */
    }
    const command = hookCommand(true);
    if (before.includes("thetokentown")) return { kind: "noop", label: LABEL, reason: `task ${TASK_NAME} already exists` };
    record.file = file;
    record.scheduler = "schtasks";
    const plan: HookPlan = {
      tool: "grok",
      label: LABEL,
      file,
      before,
      after: `schtasks /Create /SC MINUTE /MO 15 /TN ${TASK_NAME} /TR ${quoteArg(command)}\n`,
      record,
      write: () => {
        run("schtasks", ["/Create", "/F", "/SC", "MINUTE", "/MO", "15", "/TN", TASK_NAME, "/TR", command]);
        return `registered scheduled task ${TASK_NAME}`;
      },
    };
    return { kind: "plan", plan };
  }

  // Linux and everything else: cron.
  let before = "";
  try {
    before = run("crontab", ["-l"]);
  } catch {
    /* empty crontab, or no crontab binary — the write will say which */
  }
  const after = mergeCrontab(before, cronLine());
  if (after === before) return { kind: "noop", label: LABEL, reason: "already in the crontab" };
  record.file = "crontab";
  record.scheduler = "cron";
  const plan: HookPlan = {
    tool: "grok",
    label: LABEL,
    file: "crontab",
    before,
    after,
    record,
    write: (text) => {
      run("crontab", ["-"], text);
      return "crontab updated";
    },
  };
  return { kind: "plan", plan };
}

export function grokUninstallPlan(record: HookRecord | undefined): PlanOutcome {
  const scheduler = record?.scheduler ?? (process.platform === "darwin" ? "launchd" : process.platform === "win32" ? "schtasks" : "cron");

  if (scheduler === "launchd") {
    const file = record?.file ?? plistPath();
    if (!existsSync(file)) return { kind: "noop", label: LABEL, reason: "no launchd agent installed" };
    const before = fileText(file);
    const plan: HookPlan = {
      tool: "grok",
      label: LABEL,
      file,
      before,
      after: "",
      remove: [file],
      write: () => {
        try {
          run("launchctl", ["unload", file]);
        } catch {
          /* was not loaded */
        }
        return `unloaded ${PLIST_LABEL}`;
      },
    };
    return { kind: "plan", plan };
  }

  if (scheduler === "schtasks") {
    let before = "";
    try {
      before = run("schtasks", ["/Query", "/TN", TASK_NAME, "/FO", "LIST"]);
    } catch {
      return { kind: "noop", label: LABEL, reason: `no scheduled task ${TASK_NAME}` };
    }
    const plan: HookPlan = {
      tool: "grok",
      label: LABEL,
      file: `schtasks:${TASK_NAME}`,
      before,
      after: `schtasks /Delete /TN ${TASK_NAME} /F\n`,
      write: () => {
        run("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"]);
        return `deleted scheduled task ${TASK_NAME}`;
      },
    };
    return { kind: "plan", plan };
  }

  let before = "";
  try {
    before = run("crontab", ["-l"]);
  } catch {
    return { kind: "noop", label: LABEL, reason: "no crontab" };
  }
  const after = mergeCrontab(before, null);
  if (after === before || !before.split("\n").some(isOurs)) return { kind: "noop", label: LABEL, reason: "nothing of ours in the crontab" };
  const plan: HookPlan = {
    tool: "grok",
    label: LABEL,
    file: "crontab",
    before,
    after,
    write: (text) => {
      if (text === "") run("crontab", ["-r"]);
      else run("crontab", ["-"], text);
      return "crontab updated";
    },
  };
  return { kind: "plan", plan };
}

/** Loads the launchd agent after the plist is written. */
export function grokActivate(record: HookRecord): string | undefined {
  if (record.scheduler !== "launchd") return undefined;
  try {
    run("launchctl", ["load", record.file]);
    return `loaded ${PLIST_LABEL}`;
  } catch (error) {
    return `plist written; launchctl load failed: ${(error as Error).message}`;
  }
}

export function grokInstalled(): boolean {
  if (process.platform === "darwin") return existsSync(plistPath());
  if (process.platform === "win32") {
    try {
      return run("schtasks", ["/Query", "/TN", TASK_NAME]).includes(TASK_NAME);
    } catch {
      return false;
    }
  }
  try {
    return run("crontab", ["-l"]).split("\n").some(isOurs);
  } catch {
    return false;
  }
}
