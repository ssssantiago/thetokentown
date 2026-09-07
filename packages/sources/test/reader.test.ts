import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { firstSegment, normalizePath, readLines } from "../src/reader.ts";
import { createFsReader } from "../src/readers/fs.ts";
import { createFileListReader } from "../src/readers/browser.ts";
import { FIXTURES, directoryHandleFor, fileListReaderFor } from "./helpers.ts";

test("normalizePath collapses separators and drops noise segments", () => {
  assert.equal(normalizePath("a/b/c.jsonl"), "a/b/c.jsonl");
  assert.equal(normalizePath("a\\b\\c.jsonl"), "a/b/c.jsonl", "Windows separators");
  assert.equal(normalizePath("/a//b/./c"), "a/b/c");
  assert.equal(normalizePath("a/b/"), "a/b");
  assert.equal(normalizePath(""), "");
});

test("firstSegment names the project the way every scanner does", () => {
  assert.equal(firstSegment("project-alpha/session-1.jsonl"), "project-alpha");
  assert.equal(firstSegment("session-1.jsonl"), "session-1.jsonl");
  assert.equal(firstSegment(""), "");
});

test("readLines drops the trailing newline and survives CRLF", async () => {
  const reader = createFileListReader([
    { name: "a.txt", webkitRelativePath: "a.txt", async text() { return "one\ntwo\n"; } },
    { name: "b.txt", webkitRelativePath: "b.txt", async text() { return "one\r\ntwo"; } },
    { name: "c.txt", webkitRelativePath: "c.txt", async text() { return ""; } },
  ]);

  const collect = async (path: string) => {
    const out: string[] = [];
    for await (const line of readLines(reader, path)) out.push(line);
    return out;
  };

  assert.deepEqual(await collect("a.txt"), ["one", "two"], "no empty final line");
  assert.deepEqual(await collect("b.txt"), ["one", "two"]);
  assert.deepEqual(await collect("c.txt"), [], "an empty file has no lines");
});

test("a missing directory lists as empty instead of throwing", async () => {
  const fs = createFsReader();
  assert.deepEqual(await fs.list(join(FIXTURES, "does-not-exist")), []);

  const browser = fileListReaderFor("claude");
  assert.deepEqual(await browser.list("claude/nope"), []);
});

test("reading a file the selection does not contain is an error, not silence", async () => {
  const browser = fileListReaderFor("claude");
  await assert.rejects(() => browser.read("claude/nope.jsonl"), /no such file in this selection/);
});

test("all three adapters agree on what is under claude/projects", async () => {
  const fs = createFsReader();
  const [onDisk, dropped, picked] = await Promise.all([
    fs.list(join(FIXTURES, "claude", "projects")),
    fileListReaderFor("claude").list("claude/projects"),
    directoryHandleFor("claude").then((reader) => reader.list("claude/projects")),
  ]);

  const relative = (entries: { relativePath: string }[]) =>
    entries.map((entry) => entry.relativePath).sort();

  assert.ok(onDisk.length > 0, "the fixtures must not be empty");
  assert.deepEqual(relative(dropped), relative(onDisk), "File[] adapter");
  assert.deepEqual(relative(picked), relative(onDisk), "FileSystemDirectoryHandle adapter");
});

test("all three adapters return byte-identical file contents", async () => {
  const fs = createFsReader();
  const dropped = fileListReaderFor("claude");
  const picked = await directoryHandleFor("claude");

  const entries = await dropped.list("claude/projects");
  assert.ok(entries.length > 0);

  for (const entry of entries) {
    const [a, b, c] = await Promise.all([
      fs.read(join(FIXTURES, "claude", "projects", entry.relativePath)),
      dropped.read(entry.path),
      picked.read(entry.path),
    ]);
    assert.equal(b, a, `${entry.relativePath} via File[]`);
    assert.equal(c, a, `${entry.relativePath} via directory handle`);
  }
});

test("the fs adapter streams lines and reports real mtimes", async () => {
  const fs = createFsReader();
  const [entry] = await fs.list(join(FIXTURES, "claude", "projects"));
  assert.ok(entry);
  assert.ok(entry.lastModified > 0, "a real file on disk has a modification time");
  assert.equal(typeof fs.lines, "function", "the fs adapter must stream, not slurp");

  let streamed = 0;
  for await (const _line of readLines(fs, entry.path)) streamed += 1;
  const slurped = (await fs.read(entry.path)).trimEnd().split("\n").length;
  assert.equal(streamed, slurped, "streaming and reading must agree on line count");
});

test("a reader that cannot date a file reports 0 rather than guessing", async () => {
  const picked = await directoryHandleFor("claude");
  const entries = await picked.list("claude/projects");
  assert.ok(entries.length > 0);
  assert.ok(
    entries.every((entry) => entry.lastModified === 0),
    "the stand-in handle reports no mtime, and that must be allowed",
  );
});
