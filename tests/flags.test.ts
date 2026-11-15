import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlags,
  isFeatureEnabled,
  parseFeatureFlags,
} from "../lib/flags";

test("parseFeatureFlags falls back to defaults without input", () => {
  assert.deepEqual(parseFeatureFlags(undefined), DEFAULT_FEATURE_FLAGS);
  assert.deepEqual(parseFeatureFlags(""), DEFAULT_FEATURE_FLAGS);
});

test("parseFeatureFlags applies known booleans and ignores the rest", () => {
  const flags = parseFeatureFlags(
    '{"githubImport":false,"plugins":false,"unknown":true,"streakEmails":"no"}',
  );
  assert.equal(flags.githubImport, false);
  assert.equal(flags.plugins, false);
  assert.equal(flags.streakEmails, true);
  assert.equal(flags.contentUpdates, true);
});

test("malformed or non-object flags cannot take the app down", () => {
  assert.deepEqual(parseFeatureFlags("{not json"), DEFAULT_FEATURE_FLAGS);
  assert.deepEqual(parseFeatureFlags("[]"), DEFAULT_FEATURE_FLAGS);
  assert.deepEqual(parseFeatureFlags("null"), DEFAULT_FEATURE_FLAGS);
});

test("getFeatureFlags and isFeatureEnabled read FEATURE_FLAGS", () => {
  const env = {
    FEATURE_FLAGS: '{"pwaUpdates":false}',
  } as unknown as NodeJS.ProcessEnv;
  assert.equal(getFeatureFlags(env).pwaUpdates, false);
  assert.equal(isFeatureEnabled("pwaUpdates", env), false);
  assert.equal(isFeatureEnabled("contentUpdates", env), true);
});
