/**
 * thetokentown — turn the last 90 days of AI coding into a building.
 *
 *   thetokentown            install if not installed, otherwise status
 *   thetokentown scan       scan sources, print a table, send nothing
 *   thetokentown --json     print the exact Snapshot v2 a claim carries
 *   thetokentown claim      scan + open /claim#<snapshot> (no token, no request)
 *   thetokentown login      device flow; hook token in ~/.thetokentown/config.json
 *   thetokentown publish    scan + preview + confirm + POST with the token
 *   thetokentown install    claim → login → building → hooks → link
 *   thetokentown sync       what the hooks call (--hook), or a foreground sync
 *   thetokentown uninstall  remove our hook entries; --purge removes ~/.thetokentown
 *   thetokentown status     sources, hooks, last sync, link
 *
 * SPEC §6. English only.
 */

import { parseArgs } from "./flags.ts";
import { log } from "./store.ts";
import { VERSION } from "./version.ts";

// Command modules are imported on demand: the hook path must not pay for
// the scanners, the pricing table or the API client. esbuild keeps these in
// the single bundle but evaluates each one only when it is first imported.

const HELP = `thetokentown ${VERSION}

Usage:
  thetokentown                 install if not installed, otherwise status
  thetokentown scan            scan Claude Code, Codex and Grok; print a table; send nothing
  thetokentown --json          print the exact Snapshot v2 a claim would carry; send nothing
  thetokentown claim           scan and open your claim in the browser (no token, no request)
  thetokentown login           log in with a device code; stores the hook token
  thetokentown publish [--yes] scan, preview, confirm, then post with the token
  thetokentown install         claim → login → choose building → hooks (diff + y/N per tool)
  thetokentown sync            sync now in the foreground
  thetokentown sync --hook     what the hooks call: incremental, throttled, always exit 0
  thetokentown uninstall       remove only our hook entries; --purge also removes ~/.thetokentown
  thetokentown status          sources, hooks, last sync, link

Options:
  --json                       machine-readable output where it applies
  --no-open                    never open a browser
  --since <days>               activity window (default: 90)
  --site <url>                 The Token Town site (or THETOKENTOWN_SITE_URL)
  --demo                       safe demo data instead of this machine
  --yes                        answer yes to every confirmation
  --token <token>              (login) store a token from /me instead of the device flow
  --flush                      (sync --hook) ignore the 10-minute throttle
  --help, --version

Privacy: only per-day, per-provider, per-model token counts leave this
machine. Prompts, responses, file names, paths and code never do. Run
--json to read the payload before anything is sent.`;

const notYet = (name: string): number => {
  console.error(`${name} is not implemented yet on this branch`);
  return 2;
};

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.command === "help") {
    console.log(HELP);
    return 0;
  }
  if (flags.command === "version") {
    console.log(VERSION);
    return 0;
  }
  if (flags.unknown.length > 0 && !flags.hook) {
    console.error(`unknown argument: ${flags.unknown.join(" ")}\n`);
    console.error(HELP);
    return 2;
  }

  switch (flags.command) {
    case "scan":
      return (await import("./commands/scan.ts")).scanCommand(flags);
    case "claim":
      return (await import("./commands/scan.ts")).claimCommand(flags);
    case "login":
      return (await import("./commands/login.ts")).loginCommand(flags);
    case "publish":
      return (await import("./commands/publish.ts")).publishCommand(flags);
    case "install":
      return notYet("install");
    case "sync":
      return notYet("sync");
    case "uninstall":
      return notYet("uninstall");
    case "status":
      return (await import("./commands/status.ts")).statusCommand(flags);
    case "default": {
      // `thetokentown --json` keeps meaning "the payload, sent nowhere".
      if (flags.json) return (await import("./commands/scan.ts")).scanCommand(flags);
      // install lands with the hooks; until then the bare command is status.
      return (await import("./commands/status.ts")).statusCommand(flags);
    }
    default:
      return 2;
  }
}

const hookMode = process.argv.includes("--hook");

process.on("uncaughtException", (error) => {
  if (hookMode) {
    log(`uncaught: ${error.stack ?? error.message}`);
    process.exit(0);
  }
  console.error(error.stack ?? error.message);
  process.exit(1);
});

main().then(
  (code) => process.exit(hookMode ? 0 : code),
  (error: Error) => {
    if (hookMode) {
      log(`failed: ${error.stack ?? error.message}`);
      process.exit(0);
    }
    console.error(error.stack ?? error.message);
    process.exit(1);
  },
);
