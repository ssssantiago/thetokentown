import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { Reader } from "../src/reader.ts";
import { createDirectoryHandleReader, createFileListReader } from "../src/readers/browser.ts";

export const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

/** Deterministic clock so the fixtures never age out of the window. */
export const NOW = Date.parse("2026-09-06T12:00:00.000Z");
export const SINCE = Date.parse("2026-01-01T00:00:00.000Z");
export const SCAN = { since: SINCE, now: NOW, timeZone: "UTC" };

interface DiskFile {
  /** POSIX path relative to `fixtures/`, e.g. `claude/projects/a/b.jsonl`. */
  path: string;
  body: string;
}

export function readFixtureTree(subdirectory: string): DiskFile[] {
  const root = join(FIXTURES, subdirectory);
  const found: DiskFile[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        found.push({
          path: `${subdirectory}/${relative(root, full).split(/[\\/]/).join("/")}`,
          body: readFileSync(full, "utf8"),
        });
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * A real `File`, carrying the `webkitRelativePath` a browser sets on a
 * `<input webkitdirectory>` selection. Node's File has no such property, so
 * the test defines it exactly as the platform would.
 */
function pickedFile(path: string, body: string, lastModified: number): File {
  const name = path.split("/").at(-1)!;
  const file = new File([body], name, { lastModified });
  Object.defineProperty(file, "webkitRelativePath", { value: path, enumerable: true });
  return file;
}

/** `<input webkitdirectory>` / drop-zone adapter over a fixture subtree. */
export function fileListReaderFor(subdirectory: string): Reader {
  return createFileListReader(
    readFixtureTree(subdirectory).map((file) => pickedFile(file.path, file.body, NOW)),
  );
}

/**
 * A stand-in for FileSystemDirectoryHandle. Node has no such API, so the shape
 * that `showDirectoryPicker()` returns is reproduced here: `entries()` yields
 * `[name, handle]`, directories recurse, files expose `getFile()`.
 *
 * It reports `lastModified: 0`, which also exercises the rule that a reader
 * unable to date a file must not have that file skipped.
 */
export function directoryHandleFor(subdirectory: string): Promise<Reader> {
  const files = readFixtureTree(subdirectory);

  interface Node {
    directories: Map<string, Node>;
    files: Map<string, string>;
  }
  const emptyNode = (): Node => ({ directories: new Map(), files: new Map() });
  const tree = emptyNode();

  for (const file of files) {
    // Drop the leading subdirectory: the handle itself is that folder.
    const segments = file.path.split("/").slice(1);
    let node = tree;
    for (const segment of segments.slice(0, -1)) {
      if (!node.directories.has(segment)) node.directories.set(segment, emptyNode());
      node = node.directories.get(segment)!;
    }
    node.files.set(segments.at(-1)!, file.body);
  }

  function toHandle(node: Node, name: string): never | object {
    return {
      kind: "directory" as const,
      name,
      async *entries() {
        for (const [childName, child] of node.directories) {
          yield [childName, toHandle(child, childName)] as const;
        }
        for (const [fileName, body] of node.files) {
          yield [
            fileName,
            {
              kind: "file" as const,
              name: fileName,
              async getFile() {
                return new File([body], fileName, { lastModified: 0 });
              },
            },
          ] as const;
        }
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural stand-in for a DOM type
  return createDirectoryHandleReader(toHandle(tree, subdirectory) as any);
}
