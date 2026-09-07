export type { FileEntry, Reader } from "./reader.ts";
export { firstSegment, normalizePath, readLines } from "./reader.ts";

export { createFsReader } from "./readers/fs.ts";
export { createDirectoryHandleReader, createFileListReader } from "./readers/browser.ts";

export type { Contribution, DailyAccumulator, TokenBreakdown } from "./daily.ts";
export { createDailyAccumulator, dayInZone } from "./daily.ts";

export type { ScanOptions, ScannerSource, ScanResult } from "./types.ts";
export { emptyResult } from "./types.ts";

export { scanClaude, detect as detectClaude } from "./scanners/claude.ts";
export { scanCodex, detect as detectCodex } from "./scanners/codex.ts";
export { scanGrok, detect as detectGrok } from "./scanners/grok.ts";
export { scanCursor, detect as detectCursor } from "./scanners/cursor.ts";
