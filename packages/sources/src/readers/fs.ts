/** Node adapter: real paths, real mtimes, streamed lines. */

import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, relative } from "node:path";

import type { FileEntry, Reader } from "../reader.ts";
import { normalizePath } from "../reader.ts";

export function createFsReader(): Reader {
  return {
    async list(dir) {
      const found: FileEntry[] = [];
      const stack = [dir];

      while (stack.length > 0) {
        const current = stack.pop()!;
        let entries;
        try {
          entries = await readdir(current, { withFileTypes: true });
        } catch {
          // Unreadable or missing directory: the scanners treat it as empty,
          // never as an error. A permissions problem must not break a hook.
          continue;
        }

        for (const entry of entries) {
          const full = join(current, entry.name);
          if (entry.isDirectory()) {
            stack.push(full);
            continue;
          }
          if (!entry.isFile()) continue;
          let lastModified = 0;
          try {
            lastModified = (await stat(full)).mtimeMs;
          } catch {
            /* keep 0 and let the scanner decide */
          }
          found.push({
            path: full,
            relativePath: normalizePath(relative(dir, full)),
            lastModified,
          });
        }
      }

      return found.sort((a, b) => a.path.localeCompare(b.path));
    },

    async read(path) {
      return readFile(path, "utf8");
    },

    async *lines(path) {
      const input = createReadStream(path, { encoding: "utf8" });
      try {
        yield* createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
      } finally {
        input.destroy();
      }
    },
  };
}
