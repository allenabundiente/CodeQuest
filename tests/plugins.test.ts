import assert from "node:assert/strict";
import test from "node:test";
import { BUNDLED_PACK } from "../lib/content/bundled";
import type { ContentPack } from "../lib/content/schema";
import { createPluginRegistry } from "../lib/plugins/registry";
import type {
  HookHandler,
  HookPayloads,
  PluginDefinition,
  PluginManifest,
} from "../lib/plugins/types";
import { samplePlugins } from "../plugins/index";

function clonePack(pack: ContentPack): ContentPack {
  return JSON.parse(JSON.stringify(pack)) as ContentPack;
}

const ATTEMPT: HookPayloads["attempt.evaluated"] = {
  passed: false,
  outcomes: [
    {
      name: "Test 1",
      passed: false,
      expected: "4",
      actual: "0",
      stderr: "",
      exitCode: 0,
      timedOut: true,
    },
  ],
  language: "python",
  stepTitle: "Double it",
};

function testPlugin(
  id: string,
  hooks: PluginManifest["hooks"],
  handlers: PluginDefinition["handlers"],
): PluginDefinition {
  return {
    manifest: {
      id,
      name: "Test Plugin",
      version: "1.0.0",
      description: "A plugin used only inside the test suite.",
      hooks,
      enabled: true,
    },
    handlers,
  };
}

test("the bundled socratic-hints plugin reacts to failures and passes", async () => {
  const registry = createPluginRegistry(samplePlugins);

  const failed = await registry.runHook("attempt.evaluated", ATTEMPT);
  assert.equal(failed.failures.length, 0);
  assert.ok(failed.messages.some((message) => /timed out/i.test(message)));

  const passed = await registry.runHook("attempt.evaluated", {
    ...ATTEMPT,
    passed: true,
    outcomes: [{ ...ATTEMPT.outcomes[0], passed: true, timedOut: false }],
  });
  assert.ok(passed.messages.some((message) => /passes all/i.test(message)));
});

test("the bundled publish-checklist plugin allows the bundled pack and blocks bad contrast", async () => {
  const registry = createPluginRegistry(samplePlugins);

  const allowed = await registry.runHook("content.beforePublish", {
    pack: BUNDLED_PACK,
    version: 1,
  });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.errors, []);

  const lowContrast = clonePack(BUNDLED_PACK);
  lowContrast.theme.text = "#000000";
  lowContrast.theme.bg = "#000000";

  const blocked = await registry.runHook("content.beforePublish", {
    pack: lowContrast,
    version: 2,
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((error) => /contrast/i.test(error)));
});

test("isolates a throwing plugin after repeated failures and allows a reset", async () => {
  const registry = createPluginRegistry(
    [testPlugin("boom-plugin", ["attempt.evaluated"], {
      "attempt.evaluated": () => {
        throw new Error("exploded");
      },
    })],
    { failureThreshold: 2 },
  );

  const first = await registry.runHook("attempt.evaluated", ATTEMPT);
  assert.equal(first.failures.length, 1);
  assert.match(first.failures[0].message, /exploded/);

  await registry.runHook("attempt.evaluated", ATTEMPT);

  const isolated = await registry.runHook("attempt.evaluated", ATTEMPT);
  assert.equal(isolated.failures.length, 0);

  const status = registry.status().find((plugin) => plugin.id === "boom-plugin");
  assert.equal(status?.disabled, true);
  assert.equal(status?.failures, 2);

  assert.equal(registry.reset("boom-plugin"), true);
  const reset = registry.status().find((plugin) => plugin.id === "boom-plugin");
  assert.equal(reset?.disabled, false);
  assert.equal(reset?.failures, 0);
  assert.equal(registry.reset("missing-plugin"), false);
});

test("times out a hanging plugin without blocking the others", async () => {
  const hang: HookHandler<"attempt.evaluated"> = () =>
    new Promise(() => {
      // deliberately never resolves
    });

  const registry = createPluginRegistry(
    [
      testPlugin("slow-plugin", ["attempt.evaluated"], {
        "attempt.evaluated": hang,
      }),
      testPlugin("fast-plugin", ["attempt.evaluated"], {
        "attempt.evaluated": () => ({ messages: ["fast plugin ran"] }),
      }),
    ],
    { hookTimeoutMs: 50, failureThreshold: 1 },
  );

  const result = await registry.runHook("attempt.evaluated", ATTEMPT);
  assert.ok(result.failures.some((failure) => /timed out/i.test(failure.message)));
  assert.deepEqual(result.messages, ["fast plugin ran"]);
  assert.equal(
    registry.status().find((plugin) => plugin.id === "slow-plugin")?.disabled,
    true,
  );
});

test("rejects invalid manifests and manifests without handlers", async () => {
  const registry = createPluginRegistry([
    {
      manifest: { id: "Bad ID", name: "X" } as unknown as PluginManifest,
      handlers: {},
    },
    testPlugin("no-handler", ["content.beforePublish"], {}),
    testPlugin("valid-plugin", ["attempt.evaluated"], {
      "attempt.evaluated": () => ({ messages: ["ok"] }),
    }),
  ]);

  const status = registry.status();
  const invalidId = status.find((plugin) => plugin.valid === false);
  assert.ok(invalidId);
  const noHandler = status.find((plugin) => plugin.id === "no-handler");
  assert.equal(noHandler?.valid, false);
  assert.match(noHandler?.error ?? "", /no handler/i);
  assert.equal(
    status.find((plugin) => plugin.id === "valid-plugin")?.valid,
    true,
  );

  const result = await registry.runHook("content.beforePublish", {
    pack: BUNDLED_PACK,
    version: null,
  });
  assert.equal(result.failures.length, 0);
  assert.equal(result.ok, true);
});

test("merges patches returned by lesson.afterDraft plugins", async () => {
  const registry = createPluginRegistry([
    testPlugin("summary-plugin", ["lesson.afterDraft"], {
      "lesson.afterDraft": () => ({
        patch: { summary: "Patched by a plugin for the test suite." },
      }),
    }),
  ]);

  const result = await registry.runHook("lesson.afterDraft", {
    draft: { ...BUNDLED_PACK } as never,
    source: "goal",
  });

  assert.equal(result.patch.summary, "Patched by a plugin for the test suite.");
  assert.equal(result.ok, true);
});
