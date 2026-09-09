/**
 * Every path the CLI touches, in one place. SPEC §6, §7.
 *
 * `THETOKENTOWN_HOME` relocates `~/.thetokentown` (the test suite uses it so a
 * run never touches the developer's real state). `CLAUDE_CONFIG_DIR`,
 * `CODEX_HOME` and `GROK_HOME` are the tools' own variables and double as the
 * place their hook files live.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = homedir();

export const expand = (path: string): string => path.replace(/^~(?=$|[\\/])/, HOME);

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
};

const tttHomeEnv = env("THETOKENTOWN_HOME");

/** `~/.thetokentown` unless relocated. Created 0700 on first write. */
export const TTT_HOME = tttHomeEnv ? expand(tttHomeEnv) : join(HOME, ".thetokentown");

export const CONFIG_FILE = join(TTT_HOME, "config.json");
export const STATE_FILE = join(TTT_HOME, "state.json");
export const QUEUE_FILE = join(TTT_HOME, "queue.json");
export const LAST_SYNC_FILE = join(TTT_HOME, "last-sync");
export const LOG_FILE = join(TTT_HOME, "hook.log");
export const BIN_DIR = join(TTT_HOME, "bin");

// ---------------------------------------------------------------- tools

/**
 * Claude Code. `CLAUDE_CONFIG_DIR` may list several directories separated by
 * commas; the first one is where settings.json lives. Without it, both the
 * XDG-style and the classic location are scanned, and hooks go to ~/.claude.
 */
const claudeEnv = env("CLAUDE_CONFIG_DIR");
const claudeConfigDirs = claudeEnv
  ? claudeEnv
      .split(",")
      .map((path) => expand(path.trim()))
      .filter(Boolean)
  : [join(HOME, ".config", "claude"), join(HOME, ".claude")];

export const CLAUDE_CONFIG_DIR = claudeEnv ? claudeConfigDirs[0]! : join(HOME, ".claude");
export const CLAUDE_SETTINGS_FILE = join(CLAUDE_CONFIG_DIR, "settings.json");
export const claudeRoots = claudeConfigDirs.map((dir) => join(dir, "projects"));

/** Codex CLI. */
const codexEnv = env("CODEX_HOME");
export const CODEX_HOME = codexEnv ? expand(codexEnv) : join(HOME, ".codex");
export const CODEX_CONFIG_FILE = join(CODEX_HOME, "config.toml");
export const codexRoots = [join(CODEX_HOME, "sessions"), join(CODEX_HOME, "archived_sessions")];

/** Grok CLI. */
const grokEnv = env("GROK_HOME");
export const GROK_HOME = grokEnv ? expand(grokEnv) : join(HOME, ".grok");
export const grokRoots = [join(GROK_HOME, "sessions")];

/** Cursor. Out of V1; kept so `detect()` can keep saying no. */
export const CURSOR_LOG = expand(
  env("THETOKENTOWN_CURSOR_LOG") ?? join(HOME, ".cursor", "token-usage", "usage.jsonl"),
);
