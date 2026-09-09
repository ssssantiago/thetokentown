/**
 * `publish [--yes]`: scan → preview → confirm → POST /api/snapshot with the
 * hook token. The path for histories too large for a claim fragment, and
 * for anyone who prefers a token over a browser hand-off. SPEC §6.
 */

import { ApiError, postSnapshot, resolveSite } from "../api.ts";
import type { Flags } from "../flags.ts";
import { readConfig } from "../store.ts";
import { bold, confirm, dim, green, underline, yellow } from "../ui.ts";
import { collect, printSummary } from "./scan.ts";

export async function publishCommand(flags: Flags): Promise<number> {
  const config = readConfig();
  const site = resolveSite(flags.site ?? config.site);
  if (!config.token) {
    console.error(`  ${yellow("!")} not logged in. Run ${bold("thetokentown login")} first (or ${bold("thetokentown claim")} for a token-free first building).`);
    return 1;
  }

  const { summary, snapshot } = await collect(flags, "cli");
  if (flags.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return 0;
  }
  printSummary(snapshot.daily, summary, flags.days, site);
  if (snapshot.daily.length === 0) {
    console.log("  Nothing to publish yet.\n");
    return 0;
  }

  console.log(`  ${dim(`${snapshot.daily.length} daily rows → ${site}/api/snapshot (building "${snapshot.building}")`)}`);
  const ok = await confirm("  Publish?", flags.yes);
  if (!ok) {
    console.log("  Not published.\n");
    return 0;
  }

  try {
    const reply = await postSnapshot(site, config.token, snapshot, 15_000);
    const where = reply.url ?? `${site}/b/${config.handle ?? ""}`;
    console.log(`  ${green("✓")} published${reply.floors !== undefined ? ` — ${reply.floors} floors` : ""}${reply.citizenNo !== undefined ? ` · Citizen #${reply.citizenNo}` : ""}\n  ${underline(where)}\n`);
    return 0;
  } catch (error) {
    const status = error instanceof ApiError ? error.status : null;
    console.error(`  ${yellow("!")} publish failed: ${(error as Error).message}`);
    if (status === 401 || status === 403) console.error(`  ${dim("The token was rejected; run `thetokentown login` again.")}`);
    return 1;
  }
}
