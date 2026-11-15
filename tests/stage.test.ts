import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateStagedContent } from "../lib/content/stage";

const pack: unknown = JSON.parse(
  readFileSync(path.join(process.cwd(), "content/bundled/pack.json"), "utf8"),
);

test("a complete pack with the advertised version is staged", () => {
  const result = validateStagedContent({ version: 5, pack }, 5);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.staged.version, 5);
    assert.equal(typeof result.staged.pack.meta.name, "string");
  }
});

test("a version mismatch is rejected instead of applied", () => {
  const result = validateStagedContent({ version: 6, pack }, 5);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Expected content v5/);
});

test("missing, zero, or fractional versions are rejected", () => {
  for (const version of [undefined, 0, -1, 1.5, "3"]) {
    const result = validateStagedContent({ version, pack }, 0);
    assert.equal(result.ok, false);
  }
});

test("a partial or invalid pack never replaces working content", () => {
  const missing = validateStagedContent({ version: 2, pack: {} }, 2);
  assert.equal(missing.ok, false);

  const wrongShape = validateStagedContent(
    { version: 2, pack: { ...(pack as object), lessons: "nope" } },
    2,
  );
  assert.equal(wrongShape.ok, false);

  const notAnObject = validateStagedContent("html error page", 2);
  assert.equal(notAnObject.ok, false);
});
