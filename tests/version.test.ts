import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVersionInfo,
  compareVersions,
  isBelowMinimum,
} from "../lib/version";

test("compareVersions orders numeric segments", () => {
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3", "1.2.4"), -1);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("v2.0", "1.99.99"), 1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0"), 0);
});

test("compareVersions treats malformed segments as zero", () => {
  assert.equal(compareVersions("1.x.3", "1.0.3"), 0);
  assert.equal(compareVersions("", "0.0.0"), 0);
});

test("isBelowMinimum gates required updates", () => {
  assert.equal(isBelowMinimum("0.3.9", "0.4.0"), true);
  assert.equal(isBelowMinimum("0.4.0", "0.4.0"), false);
  assert.equal(isBelowMinimum("0.4.1", "0.4.0"), false);
});

test("buildVersionInfo merges, dedupes, and caps changelog entries", () => {
  const info = buildVersionInfo({
    appVersion: "0.4.0",
    contentVersion: 7,
    minSupportedVersion: "0.2.0",
    contentChangelog: ["Group lessons by topic", "  ", "Group lessons by topic"],
    contentSource: "remote",
    publishedAt: "2026-01-01T00:00:00.000Z",
    now: new Date("2026-05-05T12:00:00.000Z"),
  });

  assert.equal(info.appVersion, "0.4.0");
  assert.equal(info.contentVersion, 7);
  assert.equal(info.minSupportedVersion, "0.2.0");
  assert.equal(info.contentSource, "remote");
  assert.equal(info.publishedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(info.generatedAt, "2026-05-05T12:00:00.000Z");
  assert.equal(info.changelog[0], "Group lessons by topic");
  assert.equal(
    info.changelog.filter((entry) => entry === "Group lessons by topic").length,
    1,
  );
  assert.ok(info.changelog.length <= 10);
  assert.ok(info.changelog.every((entry) => entry.trim().length > 0));
});
