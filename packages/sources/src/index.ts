export type { FileEntry, Reader } from "./reader.ts";
export { firstSegment, normalizePath, readLines } from "./reader.ts";

export { createFsReader } from "./readers/fs.ts";
export { createDirectoryHandleReader, createFileListReader } from "./readers/browser.ts";

export type { ScanOptions, ScanResult, ScannerSource, UsageEvent } from "./types.ts";
export { emptyResult } from "./types.ts";

export { scanClaude } from "./scanners/claude.ts";
export { scanCodex } from "./scanners/codex.ts";
export { scanCursor } from "./scanners/cursor.ts";
