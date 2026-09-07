/**
 * One reading surface, two worlds. See docs/SPEC.md §5b.
 *
 * The CLI reads from disk; `/build` reads from files the user dropped into the
 * browser. The scanners must not know which. Everything they need is `list` and
 * `read`; `lines` is optional so the fs adapter can stream a 200 MB JSONL
 * instead of holding it in memory.
 */

export interface FileEntry {
  /** Opaque handle for this reader — pass it back to `read`. */
  path: string;
  /** Path relative to the directory that was listed, POSIX separators. */
  relativePath: string;
  /** Epoch milliseconds, or 0 when the reader cannot tell. */
  lastModified: number;
}

export interface Reader {
  /** Every file under `dir`, recursively. A missing directory yields []. */
  list(dir: string): Promise<FileEntry[]>;
  /** The whole file as UTF-8 text. */
  read(path: string): Promise<string>;
  /** Optional streaming form; `readLines` falls back to `read` without it. */
  lines?(path: string): AsyncIterable<string>;
}

/** POSIX separators, no leading or trailing slash, no "." segments. */
export function normalizePath(path: string): string {
  return path
    .split(/[\\/]+/)
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

/** First segment of a relative path — how every scanner names a project. */
export function firstSegment(relativePath: string): string {
  return normalizePath(relativePath).split("/")[0] ?? "";
}

/**
 * Line iterator that prefers the reader's streaming form.
 * A trailing newline does not produce a final empty line.
 */
export async function* readLines(reader: Reader, path: string): AsyncIterable<string> {
  if (reader.lines) {
    yield* reader.lines(path);
    return;
  }
  const text = await reader.read(path);
  if (text === "") return;
  const withoutTrailer = text.endsWith("\n") ? text.slice(0, -1) : text;
  for (const line of withoutTrailer.split("\n")) {
    yield line.endsWith("\r") ? line.slice(0, -1) : line;
  }
}
