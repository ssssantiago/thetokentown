/**
 * Browser adapters for `/build`. Nothing here touches the network: the files
 * are parsed in a Web Worker and only the aggregate leaves the page.
 *
 * Two entry points, because the pickers differ:
 *   - Chrome: `showDirectoryPicker()` -> FileSystemDirectoryHandle
 *   - everyone else: `<input webkitdirectory>` / drop zone -> File[]
 */

import type { FileEntry, Reader } from "../reader.ts";
import { normalizePath } from "../reader.ts";

/** The slice of `File` this adapter needs; keeps the package DOM-lib free. */
interface PickedFile {
  name: string;
  lastModified?: number;
  webkitRelativePath?: string;
  text(): Promise<string>;
}

/** The slice of FileSystemDirectoryHandle this adapter needs. */
interface DirectoryHandleLike {
  kind: "directory";
  name: string;
  entries(): AsyncIterable<[string, DirectoryHandleLike | FileHandleLike]>;
}

interface FileHandleLike {
  kind: "file";
  name: string;
  getFile(): Promise<PickedFile>;
}

function buildReader(entries: Map<string, { file: () => Promise<PickedFile>; lastModified: number }>): Reader {
  const paths = [...entries.keys()].sort();

  return {
    async list(dir) {
      const prefix = normalizePath(dir);
      const found: FileEntry[] = [];
      for (const path of paths) {
        // "" lists everything; otherwise only true children of `dir`.
        if (prefix !== "" && !path.startsWith(`${prefix}/`)) continue;
        const entry = entries.get(path)!;
        found.push({
          path,
          relativePath: prefix === "" ? path : path.slice(prefix.length + 1),
          lastModified: entry.lastModified,
        });
      }
      return found;
    },

    async read(path) {
      const entry = entries.get(normalizePath(path));
      if (!entry) throw new Error(`no such file in this selection: ${path}`);
      return (await entry.file()).text();
    },
  };
}

/**
 * Reader over a `<input webkitdirectory>` or drop-zone selection.
 * `webkitRelativePath` already includes the picked folder as its first segment,
 * which is exactly the root the scanners are given.
 */
export function createFileListReader(files: Iterable<PickedFile>): Reader {
  const entries = new Map<string, { file: () => Promise<PickedFile>; lastModified: number }>();
  for (const file of files) {
    const path = normalizePath(file.webkitRelativePath || file.name);
    if (path === "") continue;
    entries.set(path, { file: async () => file, lastModified: file.lastModified ?? 0 });
  }
  return buildReader(entries);
}

/**
 * Reader over `showDirectoryPicker()`. The handle tree is walked once up
 * front; the file bodies stay lazy so a big selection is not read into memory
 * before the scanners ask for it.
 */
export async function createDirectoryHandleReader(handle: DirectoryHandleLike): Promise<Reader> {
  const entries = new Map<string, { file: () => Promise<PickedFile>; lastModified: number }>();

  async function walk(directory: DirectoryHandleLike, prefix: string): Promise<void> {
    for await (const [name, child] of directory.entries()) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (child.kind === "directory") {
        await walk(child, path);
        continue;
      }
      let lastModified = 0;
      try {
        lastModified = (await child.getFile()).lastModified ?? 0;
      } catch {
        /* keep 0 */
      }
      entries.set(normalizePath(path), {
        file: () => child.getFile(),
        lastModified,
      });
    }
  }

  await walk(handle, handle.name);
  return buildReader(entries);
}
