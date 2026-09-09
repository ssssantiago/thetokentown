/**
 * `install`: claim → login → building → hooks → link. SPEC §6, §7.
 * `uninstall [--purge]`: our hook entries out, backups left; --purge also
 * removes ~/.thetokentown.
 */

import { existsSync, rmSync } from "node:fs";

import { resolveSite } from "../api.ts";
import type { Flags } from "../flags.ts";
import { installHooks, uninstallHooks } from "../hooks/index.ts";
import { TTT_HOME } from "../paths.ts";
import { readConfig, updateConfig } from "../store.ts";
import { bold, dim, green, underline, yellow } from "../ui.ts";
import { chooseBuilding, deviceFlow } from "./login.ts";
import { claimCommand, collect } from "./scan.ts";

export async function installCommand(flags: Flags): Promise<number> {
  const site = resolveSite(flags.site);

  // 1. claim — the first building needs no token. Also the preview.
  const scanned = await collect(flags);
  await claimCommand(flags, scanned);

  // 2. login — only for the hook token.
  let config = readConfig();
  if (!config.token || (config.site && config.site !== site)) {
    console.log(`  Hooks need a token so they can post on your behalf.`);
    try {
      const result = await deviceFlow(site, flags.noOpen);
      const building = await chooseBuilding(result.handle, result.buildings, flags.yes);
      config = updateConfig((current) => {
        current.token = result.token;
        current.site = site;
        current.building = building;
        if (result.handle) current.handle = result.handle;
      });
      console.log(`  ${green("✓")} logged in${result.handle ? ` as @${result.handle}` : ""}`);
    } catch (error) {
      console.log(`  ${yellow("!")} login failed: ${(error as Error).message}`);
      console.log(`  ${dim(`Hooks were not installed. Try again later with \`thetokentown install\`, or paste a token from ${site}/me with \`thetokentown login --token <token>\`.`)}\n`);
      return 1;
    }
  } else {
    console.log(`  ${green("✓")} already logged in${config.handle ? ` as @${config.handle}` : ""} ${dim("(building: " + (config.building ?? "main") + ")")}`);
  }

  // 3. hooks — diff and y/N per tool.
  console.log(`\n  ${bold("Hooks")} keep the building alive. Each change is shown before it is made:`);
  const outcomes = await installHooks({ yes: flags.yes });
  const applied = outcomes.filter((outcome) => outcome.result === "applied");
  const noops = outcomes.filter((outcome) => outcome.result === "noop" && /already installed/.test(outcome.detail));

  console.log("");
  if (applied.length > 0 || noops.length > 0) {
    if (applied.some((outcome) => outcome.tool === "claude") || noops.some((outcome) => outcome.tool === "claude")) {
      console.log(`  Restart Claude Code (or run ${bold("/hooks")} inside it) so it picks up the new hook.`);
    }
    if (applied.some((outcome) => outcome.tool === "codex") || noops.some((outcome) => outcome.tool === "codex")) {
      console.log(`  Restart Codex so it reads the new notify setting.`);
    }
  }
  const handle = config.handle;
  console.log(`\n  Your building: ${underline(handle ? `${site}/b/${handle}${config.building && config.building !== "main" ? `/${config.building}` : ""}` : site)}\n`);
  return 0;
}

export async function uninstallCommand(flags: Flags): Promise<number> {
  console.log(`\n  Removing thetokentown hook entries. Third-party hooks are left as they are.`);
  const outcomes = await uninstallHooks({ yes: flags.yes });
  const failed = outcomes.filter((outcome) => outcome.result === "failed" || outcome.result === "refused");

  if (flags.purge) {
    if (existsSync(TTT_HOME)) {
      rmSync(TTT_HOME, { recursive: true, force: true });
      console.log(`  ${green("✓")} removed ${TTT_HOME}`);
    }
  } else {
    console.log(`  ${dim(`${TTT_HOME} kept (token, machine id, log). Add --purge to remove it.`)}`);
  }
  console.log("");
  return failed.length > 0 ? 1 : 0;
}
