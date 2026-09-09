/** Terminal helpers: colours, prompts, number formatting. English only. */

import { createInterface } from "node:readline";

const tty = Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"];
const paint = (code: string) => (text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);

export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const yellow = paint("33");
export const red = paint("31");
export const underline = paint("4");
export const acid = paint("38;2;216;255;69");

export function short(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function banner(): string {
  return acid(`
  ╔══════════════════════════════╗
  ║        THE TOKEN TOWN        ║
  ╚══════════════════════════════╝`);
}

/** One line of a question; resolves to the trimmed answer ("" on EOF). */
export function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    rl.question(question, (answer) => {
      done = true;
      rl.close();
      resolve(answer.trim());
    });
    rl.on("close", () => {
      if (!done) resolve("");
    });
  });
}

/**
 * `[y/N]` — defaults to no. With `assumeYes` (from --yes) the question is
 * printed with its answer and returns true; without a terminal it is a no.
 */
export async function confirm(question: string, assumeYes: boolean): Promise<boolean> {
  if (assumeYes) {
    console.log(`${question} [y/N] y`);
    return true;
  }
  if (!process.stdin.isTTY) {
    console.log(`${question} [y/N] N ${dim("(no terminal; pass --yes to accept)")}`);
    return false;
  }
  const answer = await ask(`${question} [y/N] `);
  return /^y(es)?$/i.test(answer);
}

export function relativeTime(fromMs: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - fromMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

/** Opens a URL in the default browser, detached; failure is silent. */
export function openBrowser(url: string): void {
  // Imported lazily so the hook path never pays for child_process.
  import("node:child_process")
    .then(({ spawn }) => {
      const command =
        process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", url.replace(/&/g, "^&")] : [url];
      spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    })
    .catch(() => {
      /* no browser here; the URL was printed */
    });
}
