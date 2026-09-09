/** argv → command + flags. Global flags: --json --no-open --since --site --demo --yes. */

/** SPEC §5: the height window. Duplicated from core so the hook path stays light. */
const WINDOW_DAYS = 90;

export type Command =
  | "default"
  | "scan"
  | "claim"
  | "login"
  | "publish"
  | "install"
  | "sync"
  | "uninstall"
  | "status"
  | "help"
  | "version";

export interface Flags {
  command: Command;
  json: boolean;
  noOpen: boolean;
  days: number;
  site: string | undefined;
  demo: boolean;
  yes: boolean;
  /** login --token <value> */
  token: string | undefined;
  /** sync */
  hook: boolean;
  flush: boolean;
  worker: boolean;
  queueOnly: boolean;
  /** uninstall */
  purge: boolean;
  unknown: string[];
}

const COMMANDS = new Set<Command>(["scan", "claim", "login", "publish", "install", "sync", "uninstall", "status"]);

export function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    command: "default",
    json: false,
    noOpen: false,
    days: WINDOW_DAYS,
    site: undefined,
    demo: false,
    yes: false,
    token: undefined,
    hook: false,
    flush: false,
    worker: false,
    queueOnly: false,
    purge: false,
    unknown: [],
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift()!;
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = (): string | undefined => inline ?? rest.shift();

    switch (flag) {
      case "--help":
      case "-h":
        flags.command = "help";
        return flags;
      case "--version":
      case "-v":
        flags.command = "version";
        return flags;
      case "--json":
        flags.json = true;
        break;
      case "--no-open":
        flags.noOpen = true;
        break;
      case "--since": {
        const days = Number(value());
        flags.days = Number.isFinite(days) ? Math.max(1, Math.min(365, days)) : WINDOW_DAYS;
        break;
      }
      case "--site":
        flags.site = value();
        break;
      case "--demo":
        flags.demo = true;
        break;
      case "--yes":
      case "-y":
        flags.yes = true;
        break;
      case "--token":
        flags.token = value();
        break;
      case "--hook":
        flags.hook = true;
        break;
      case "--flush":
        flags.flush = true;
        break;
      case "--worker":
        flags.worker = true;
        break;
      case "--queue-only":
        flags.queueOnly = true;
        break;
      case "--purge":
        flags.purge = true;
        break;
      default:
        if (flags.command === "default" && COMMANDS.has(flag as Command)) flags.command = flag as Command;
        else flags.unknown.push(arg);
    }
  }
  return flags;
}
