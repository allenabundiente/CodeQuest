import test from "node:test";
import assert from "node:assert/strict";
import { buildReadiness } from "../lib/ready";
import type { ContentSnapshot } from "../lib/content/types";

const content: ContentSnapshot = {
  pack: {} as ContentSnapshot["pack"],
  source: "bundled",
  version: 3,
  publishedAt: null,
  fallbackReason: "no published pack",
};

const base = {
  databaseOk: true,
  content,
  plugins: { total: 2, valid: 2 },
  providers: ["openrouter"],
  sandbox: { driver: "piston", url: "https://emkc.org/api/v2/piston" },
};

test("readiness is true when the database and content load", () => {
  const report = buildReadiness({
    ...base,
    now: new Date("2026-02-02T00:00:00.000Z"),
  });
  assert.equal(report.ready, true);
  assert.equal(report.generatedAt, "2026-02-02T00:00:00.000Z");
  assert.equal(report.checks.database, "ok");
  assert.equal(report.checks.content.source, "bundled");
  assert.equal(report.checks.content.fallbackReason, "no published pack");
  assert.equal(report.checks.ai.configured, true);
});

test("readiness fails when the database probe fails", () => {
  const report = buildReadiness({ ...base, databaseOk: false });
  assert.equal(report.ready, false);
  assert.equal(report.checks.database, "error");
});

test("readiness fails without content and tolerates missing providers", () => {
  const report = buildReadiness({ ...base, content: null, providers: [] });
  assert.equal(report.ready, false);
  assert.equal(report.checks.content.version, null);
  assert.equal(report.checks.content.source, "bundled");
  assert.equal(report.checks.ai.configured, false);
});
