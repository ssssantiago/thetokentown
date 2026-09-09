/** `status`: sources, hooks, last sync, link. SPEC §6. */

import { existsSync } from "node:fs";

import { resolveSite } from "../api.ts";
import type { Flags } from "../flags.ts";
import { CONFIG_FILE, LOG_FILE, QUEUE_FILE } from "../paths.ts";
import { SOURCES } from "../sources.ts";
import { lastSyncAt, readConfig, readQueue, readState, tailLog } from "../store.ts";
import { banner, bold, dim, green, relativeTime, underline, yellow } from "../ui.ts";

export async function statusCommand(flags: Flags): Promise<number> {
  const config = readConfig();
  const site = resolveSite(flags.site ?? config.site);
  const hooks = { claude: false, codex: false, grok: false }; // hook installers land in a later commit
  const state = readState();
  const last = lastSyncAt();
  const queue = readQueue();

  const sources = SOURCES.map((source) => {
    const cached = state.sources[source.id];
    const rows = cached?.daily?.length ?? 0;
    const tokens = (cached?.daily ?? []).reduce((sum, row) => sum + row.input + row.output + row.cacheRead + row.cacheWrite, 0);
    return { id: source.id, label: source.label, detected: source.detect(), rows, tokens, scannedAt: cached?.scannedAt ?? null };
  });

  const link = config.handle
    ? `${site}/b/${config.handle}${config.building && config.building !== "main" ? `/${config.building}` : ""}`
    : null;

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          site,
          loggedIn: Boolean(config.token),
          handle: config.handle ?? null,
          building: config.building ?? "main",
          machineId: config.machineId,
          sources,
          hooks,
          lastSyncAt: last ? new Date(last).toISOString() : null,
          queued: queue ? { queuedAt: queue.queuedAt, attempts: queue.attempts, lastError: queue.lastError } : null,
          link,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(banner());
  console.log(`\n  ${bold("Sources")}`);
  for (const source of sources) {
    if (source.id === "cursor") {
      console.log(`    ${dim("·")} ${source.label.padEnd(12)} ${dim("V2 — Cursor does not write token counts locally yet")}`);
      continue;
    }
    const mark = source.detected ? green("✓") : dim("·");
    const detail = source.detected
      ? source.scannedAt
        ? dim(`${source.rows} rows cached ${relativeTime(Date.parse(source.scannedAt))}`)
        : dim("detected, not synced yet")
      : dim("not found");
    console.log(`    ${mark} ${source.label.padEnd(12)} ${detail}`);
  }

  console.log(`\n  ${bold("Hooks")}`);
  console.log(`    ${hooks.claude ? green("✓") : dim("·")} Claude Code  ${dim(hooks.claude ? "Stop + SessionEnd" : "not installed")}`);
  console.log(`    ${hooks.codex ? green("✓") : dim("·")} Codex CLI    ${dim(hooks.codex ? "notify" : "not installed")}`);
  console.log(`    ${hooks.grok ? green("✓") : dim("·")} Grok CLI     ${dim(hooks.grok ? "15-minute schedule" : "rides along with the other hooks")}`);

  console.log(`\n  ${bold("Sync")}`);
  console.log(`    login      ${config.token ? green(`yes${config.handle ? ` (@${config.handle})` : ""}`) : yellow("no — run `thetokentown login`")}`);
  console.log(`    building   ${config.building ?? "main"}`);
  console.log(`    last sync  ${last ? relativeTime(last) : dim("never")}`);
  if (queue) console.log(`    queued     ${yellow(`snapshot from ${relativeTime(Date.parse(queue.queuedAt))}, ${queue.attempts} attempt(s)`)} ${dim(queue.lastError)}`);
  const tail = tailLog(3);
  if (tail.length) {
    console.log(`    log        ${dim(LOG_FILE)}`);
    for (const line of tail) console.log(`      ${dim(line)}`);
  }

  console.log(`\n  ${link ? underline(link) : dim(`No building linked yet — run \`thetokentown install\`.`)}`);
  console.log(`  ${dim(`config ${CONFIG_FILE}${existsSync(QUEUE_FILE) ? ` · queue ${QUEUE_FILE}` : ""}`)}\n`);
  return 0;
}
