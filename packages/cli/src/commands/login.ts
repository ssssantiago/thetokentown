/**
 * `login`: the device flow, which only exists for the hook token. SPEC §8.
 *
 * start → show the code and open /device → poll every 3 s → store the
 * token 0600 in ~/.thetokentown/config.json. `--token <value>` skips the
 * flow and stores a token pasted from /me (SPEC §13 fallback).
 */

import type { DevicePoll } from "../api.ts";
import { deviceStart, devicePoll, resolveSite } from "../api.ts";
import type { Flags } from "../flags.ts";
import { CONFIG_FILE } from "../paths.ts";
import { machineId, updateConfig } from "../store.ts";
import { ask, bold, dim, green, openBrowser, underline, yellow } from "../ui.ts";

const DEFAULT_INTERVAL_MS = 3_000;
const DEFAULT_EXPIRES_S = 600;
const SLUG = /^[a-z0-9-]{1,20}$/;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Tests shorten the poll interval; nobody else should. */
function pollIntervalMs(serverInterval: number | undefined): number {
  const override = Number(process.env["THETOKENTOWN_POLL_MS"]);
  if (Number.isFinite(override) && override > 0) return override;
  return serverInterval && serverInterval > 0 ? serverInterval * 1000 : DEFAULT_INTERVAL_MS;
}

export interface LoginResult {
  token: string;
  handle: string | undefined;
  buildings: string[];
}

/** Runs the device flow against `site`. Throws with a readable message. */
export async function deviceFlow(site: string, noOpen: boolean): Promise<LoginResult> {
  const start = await deviceStart(site, machineId());
  if (!start.deviceCode || !start.userCode) throw new Error("the server did not return a device code");

  const url = start.verificationUrl ?? `${site}/device`;
  console.log(`\n  Open ${underline(url)} and enter the code:\n\n      ${bold(start.userCode)}\n`);
  if (!noOpen) openBrowser(url);

  const interval = pollIntervalMs(start.interval);
  const deadline = Date.now() + (start.expiresIn ?? DEFAULT_EXPIRES_S) * 1000;
  process.stdout.write(dim("  waiting for the browser"));
  try {
    while (Date.now() < deadline) {
      await sleep(interval);
      let reply: DevicePoll;
      try {
        reply = await devicePoll(site, start.deviceCode);
      } catch {
        process.stdout.write(dim("!"));
        continue;
      }
      if (reply.status === "pending") {
        process.stdout.write(dim("."));
        continue;
      }
      if (reply.status === "complete" && typeof reply.token === "string" && reply.token) {
        return { token: reply.token, handle: reply.handle, buildings: reply.buildings ?? [] };
      }
      throw new Error(reply.status === "denied" ? "the login was denied in the browser" : `the code ${reply.status}`);
    }
  } finally {
    process.stdout.write("\n");
  }
  throw new Error("the code expired before the browser confirmed it");
}

/** SPEC §4.2: which building does this computer feed? */
export async function chooseBuilding(handle: string | undefined, buildings: string[], yes: boolean): Promise<string> {
  if (buildings.length === 0) return "main";
  const label = (slug: string): string => (slug === "main" ? `@${handle ?? "you"}` : `@${handle ?? "you"}/${slug}`);
  if (yes || !process.stdin.isTTY) return buildings.includes("main") ? "main" : buildings[0]!;

  console.log(`\n  This computer feeds:`);
  buildings.forEach((slug, index) => console.log(`    [${index + 1}] your existing building "${label(slug)}"${index === 0 ? " (default)" : ""}`));
  console.log(`    [${buildings.length + 1}] a new building (e.g. "work")  →  @${handle ?? "you"}/work`);
  const answer = await ask("  > ");
  const pick = Number(answer);
  if (!answer) return buildings[0]!;
  if (Number.isInteger(pick) && pick >= 1 && pick <= buildings.length) return buildings[pick - 1]!;
  const slug = Number.isInteger(pick) && pick === buildings.length + 1 ? await ask("  slug: ") : answer;
  if (!SLUG.test(slug)) {
    console.log(`  ${yellow("!")} "${slug}" is not a valid slug (a-z, 0-9, -, up to 20); using "${buildings[0]}"`);
    return buildings[0]!;
  }
  return slug;
}

export async function loginCommand(flags: Flags): Promise<number> {
  const site = resolveSite(flags.site);

  if (flags.token !== undefined) {
    if (!flags.token.trim()) {
      console.error("  --token needs a value");
      return 1;
    }
    updateConfig((config) => {
      config.token = flags.token!.trim();
      config.site = site;
    });
    console.log(`  ${green("✓")} token stored in ${CONFIG_FILE}`);
    return 0;
  }

  try {
    const result = await deviceFlow(site, flags.noOpen);
    const building = await chooseBuilding(result.handle, result.buildings, flags.yes);
    updateConfig((config) => {
      config.token = result.token;
      config.site = site;
      config.building = building;
      if (result.handle) config.handle = result.handle;
      else delete config.handle;
    });
    console.log(`  ${green("✓")} logged in${result.handle ? ` as @${result.handle}` : ""}; token stored in ${CONFIG_FILE}`);
    return 0;
  } catch (error) {
    console.error(`  ${yellow("!")} login failed: ${(error as Error).message}`);
    console.error(`  ${dim(`If ${site}/me shows a token, run: thetokentown login --token <token>`)}`);
    return 1;
  }
}
