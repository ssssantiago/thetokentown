/** The pure parts of the hook installers: text in, text out. SPEC §7. */

import assert from "node:assert/strict";
import test from "node:test";

import { isOurs, quoteArg, serializeJson, unifiedDiff } from "../src/hooks/common.ts";
import { parseStringArray, scanTopLevel, tomlString } from "../src/hooks/codex.ts";
import { launchdPlist, mergeCrontab } from "../src/hooks/grok.ts";

test("our entries are recognised on every platform, and nothing else is", () => {
  assert.ok(isOurs("/usr/local/bin/thetokentown sync --hook"));
  assert.ok(isOurs('"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\b\\dist\\thetokentown.mjs" sync --hook --flush'));
  assert.ok(isOurs("*/15 * * * * /home/b/.npm/bin/thetokentown sync --hook --flush # thetokentown sync"));
  assert.ok(isOurs('notify = ["/home/b/.thetokentown/bin/codex-notify.sh"] # thetokentown sync (wrapper)'));
  assert.equal(isOurs("/usr/local/bin/thetokentown-sync-other --hook"), false);
  assert.equal(isOurs("/usr/local/bin/thetokentown status"), false);
  assert.equal(isOurs("/home/builder/bin/notify-me 'done'"), false);
});

test("quoteArg only quotes what needs it", () => {
  assert.equal(quoteArg("sync"), "sync");
  assert.equal(quoteArg("/usr/local/bin/thetokentown"), "/usr/local/bin/thetokentown");
  assert.equal(
    quoteArg("C:\\Program Files\\nodejs\\node.exe"),
    process.platform === "win32" ? '"C:\\Program Files\\nodejs\\node.exe"' : '"C:\\\\Program Files\\\\nodejs\\\\node.exe"',
  );
  assert.equal(quoteArg('say "hi"'), process.platform === "win32" ? '"say \\"hi\\""' : '"say \\"hi\\""');
});

test("unifiedDiff shows an insertion as an insertion with context, not a rewrite", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].join("\n");
  const after = ["a", "b", "c", "d", "e", "f", "X", "g", "h", "i", "j", "k", "l"].join("\n");
  const diff = unifiedDiff(before, after, 2);
  assert.equal(diff, ["  e", "  f", "+ X", "  g", "  h"].join("\n"));
  assert.equal(unifiedDiff("", "one\ntwo"), "+ one\n+ two");
  assert.equal(unifiedDiff("one\ntwo", "one"), "  one\n- two");
});

test("serializeJson keeps the file's indentation and trailing newline", () => {
  assert.equal(serializeJson({ a: 1 }, '{\n    "x": 1\n}\n'), '{\n    "a": 1\n}\n');
  assert.equal(serializeJson({ a: 1 }, '{\n\t"x": 1\n}'), '{\n\t"a": 1\n}');
  assert.equal(serializeJson({ a: 1 }, ""), '{\n  "a": 1\n}\n');
});

test("tomlString and parseStringArray round-trip Windows paths and quotes", () => {
  const parts = ['C:\\Program Files\\nodejs\\node.exe', "C:\\Users\\b\\thetokentown.mjs", "sync", 'a"b'];
  const literal = `[${parts.map(tomlString).join(", ")}]`;
  assert.deepEqual(parseStringArray(literal), parts);
  assert.deepEqual(parseStringArray(`['/opt/x', "y"] # trailing comment`), ["/opt/x", "y"]);
  assert.deepEqual(parseStringArray('[\n  "a",\n  "b",\n]'), ["a", "b"]);
  assert.equal(parseStringArray("[1, 2]"), null);
  assert.equal(parseStringArray('"not an array"'), null);
});

test("scanTopLevel finds notify, single- or multi-line, only at the top level", () => {
  const single = scanTopLevel('model = "x"\nnotify = ["/opt/n", "turn-ended"] # hi\n\n[profiles.a]\nnotify = ["nope"]\n');
  assert.equal(single.unreadable, null);
  assert.equal(single.end, 3);
  assert.deepEqual(single.notify?.values, ["/opt/n", "turn-ended"]);
  assert.equal(single.notify?.start, 1);
  assert.equal(single.notify?.end, 1);

  const multi = scanTopLevel('a = 1\nnotify = [\n  "/opt/n",\n  "turn-ended",\n]\nb = "[not a table]"\n[t]\n');
  assert.deepEqual(multi.notify?.values, ["/opt/n", "turn-ended"]);
  assert.equal(multi.notify?.start, 1);
  assert.equal(multi.notify?.end, 4);
  assert.equal(multi.end, 6);

  const none = scanTopLevel('# only comments\n\nmodel = "x"\n[t]\nnotify = ["in a table"]\n');
  assert.equal(none.notify, null);
  assert.equal(none.end, 3);

  const empty = scanTopLevel("");
  assert.equal(empty.notify, null);
  assert.equal(empty.unreadable, null);
});

test("scanTopLevel refuses text that is not TOML", () => {
  assert.equal(scanTopLevel("model = \nthis is not toml\n").unreadable, "this is not toml");
  assert.equal(scanTopLevel('{ "json": true }').unreadable, '{ "json": true }');
  // A multi-line string is skipped, not misread.
  const withString = scanTopLevel('s = """\nnotify = ["fake"]\n"""\nnotify = ["real"]\n');
  assert.deepEqual(withString.notify?.values, ["real"]);
});

test("mergeCrontab adds our line once and removes only ours", () => {
  const theirs = "0 * * * * /usr/bin/backup\n";
  const ours = "*/15 * * * * /usr/local/bin/thetokentown sync --hook --flush # thetokentown sync";
  const merged = mergeCrontab(theirs, ours);
  assert.equal(merged, `0 * * * * /usr/bin/backup\n${ours}\n`);
  assert.equal(mergeCrontab(merged, ours), merged, "idempotent");
  assert.equal(mergeCrontab(merged, null), theirs, "theirs survives byte for byte");
  assert.equal(mergeCrontab("", null), "");
  assert.equal(mergeCrontab(`${ours}\n`, null), "");
});

test("launchdPlist runs sync --hook --flush every 15 minutes with the given binary", () => {
  const plist = launchdPlist(["/usr/local/bin/thetokentown"]);
  assert.match(plist, /<key>Label<\/key>\s*<string>dev\.thetokentown\.sync<\/string>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/thetokentown<\/string>\s*<string>sync<\/string>\s*<string>--hook<\/string>\s*<string>--flush<\/string>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.match(launchdPlist(["/a b/node", "/x/<y>.mjs"]), /<string>\/x\/&lt;y&gt;\.mjs<\/string>/, "xml-escaped");
});
