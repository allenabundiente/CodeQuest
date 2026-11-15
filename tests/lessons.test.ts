import assert from "node:assert/strict";
import test from "node:test";
import { LessonGenerationFailedError } from "../lib/errors";
import {
  createLesson,
  loadLesson,
  recordAttempt,
  toLessonView,
} from "../lib/lessons";
import { createPluginRegistry } from "../lib/plugins/registry";
import type { PluginDefinition } from "../lib/plugins/types";
import type { GenerateJson } from "../lib/providers/generate";
import type { LessonDraft } from "../lib/types";
import { fakeGenerate, fakeSandbox, makeDb, seedUser } from "./helpers";

function draft(overrides: Partial<LessonDraft> = {}): LessonDraft {
  return {
    title: "Doubling numbers",
    summary: "Practice doubling values read from standard input.",
    language: "python",
    difficulty: "beginner",
    estimatedMinutes: 20,
    learningObjectives: ["Read input", "Do arithmetic"],
    steps: [
      {
        title: "Double it",
        goal: "Print the doubled input.",
        explanation:
          "Read a number from stdin, multiply it by two, and print the result.",
        starterCode: "value = int(input())\n# TODO: print the doubled value",
        solution: "print(int(input()) * 2)",
        tests: [{ name: "Two", input: "2", expected: "4" }],
        hints: ["What operation doubles a number?", "Multiply by two.", "Print n * 2."],
      },
    ],
    ...overrides,
  };
}

test("verifies a passing solution and stores the lesson", async () => {
  const db = makeDb();
  const user = seedUser(db);

  const lesson = await createLesson(
    {
      db,
      sandbox: fakeSandbox(),
      generate: fakeGenerate(() => draft()),
      requireSandbox: true,
      maxFixAttempts: 1,
    },
    { userId: user.id, source: "goal", goal: "Learn doubling", stepCount: 1 },
  );

  assert.equal(lesson.content.steps.length, 1);
  assert.equal(lesson.content.steps[0].verified, true);
  assert.equal(lesson.verified, true);
  assert.equal(lesson.content.discardedSteps, 0);

  const stored = loadLesson(db, user.id, lesson.id);
  assert.ok(stored);
  assert.equal(loadLesson(db, user.id, "missing"), null);

  const other = seedUser(db, "other@example.com");
  assert.equal(loadLesson(db, other.id, lesson.id), null);
});

test("discards a failing step when the repair also fails and keeps the rest", async () => {
  const db = makeDb();
  const user = seedUser(db);

  const broken = {
    ...draft().steps[0],
    title: "Broken step",
    solution: "BROKEN",
    tests: [{ name: "Two", input: "2", expected: "4" }],
  };
  const good = draft().steps[0];

  const generate = fakeGenerate((options) => {
    if (options.task === "lesson:draft") {
      return draft({ steps: [good, broken] });
    }
    if (options.task === "lesson:solution-fix") {
      return { code: "BROKEN", explanation: "still wrong" };
    }
    throw new Error(`unexpected task ${options.task}`);
  });

  const lesson = await createLesson(
    {
      db,
      sandbox: fakeSandbox(),
      generate,
      requireSandbox: true,
      maxFixAttempts: 1,
    },
    { userId: user.id, source: "goal", goal: "Practice doubling", stepCount: 2 },
  );

  assert.equal(lesson.content.steps.length, 1);
  assert.equal(lesson.content.steps[0].title, "Double it");
  assert.equal(lesson.content.discardedSteps, 1);
});

test("repairs a failing solution before discarding it", async () => {
  const db = makeDb();
  const user = seedUser(db);

  const broken = {
    ...draft().steps[0],
    solution: "BROKEN",
  };

  const generate = fakeGenerate((options) => {
    if (options.task === "lesson:draft") {
      return draft({ steps: [broken] });
    }
    if (options.task === "lesson:solution-fix") {
      return { code: "print(int(input()) * 2)", explanation: "fixed" };
    }
    throw new Error(`unexpected task ${options.task}`);
  });

  const lesson = await createLesson(
    {
      db,
      sandbox: fakeSandbox(),
      generate,
      requireSandbox: true,
      maxFixAttempts: 2,
    },
    { userId: user.id, source: "goal", goal: "Practice doubling", stepCount: 1 },
  );

  assert.equal(lesson.verified, true);
  assert.equal(lesson.content.steps[0].solution, "print(int(input()) * 2)");
});

test("refuses to save a lesson when every solution fails", async () => {
  const db = makeDb();
  const user = seedUser(db);

  const generate: GenerateJson = fakeGenerate((options) => {
    if (options.task === "lesson:draft") {
      return draft({
        steps: [{ ...draft().steps[0], solution: "BROKEN" }],
      });
    }
    return { code: "BROKEN", explanation: "nope" };
  });

  await assert.rejects(
    createLesson(
      {
        db,
        sandbox: fakeSandbox(),
        generate,
        requireSandbox: true,
        maxFixAttempts: 1,
      },
      { userId: user.id, source: "goal", goal: "Practice doubling", stepCount: 1 },
    ),
    (error: unknown) => error instanceof LessonGenerationFailedError,
  );

  const count = db
    .prepare("SELECT COUNT(*) AS total FROM lessons")
    .get() as { total: number };
  assert.equal(count.total, 0);
});

test("never sends reference solutions or draft hints to the browser", async () => {
  const db = makeDb();
  const user = seedUser(db);

  const lesson = await createLesson(
    {
      db,
      sandbox: fakeSandbox(),
      generate: fakeGenerate(() => draft()),
      requireSandbox: true,
    },
    { userId: user.id, source: "goal", goal: "Learn doubling", stepCount: 1 },
  );

  const view = toLessonView(lesson);
  assert.equal("solution" in view.steps[0], false);
  assert.equal("hints" in view.steps[0], false);
  assert.equal(JSON.stringify(view).includes("print(int(input())"), false);
});

test("applies lesson.afterDraft patches and returns attempt plugin messages", async () => {
  const db = makeDb();
  const user = seedUser(db);

  const plugin: PluginDefinition = {
    manifest: {
      id: "test-hooks",
      name: "Test Hooks",
      version: "1.0.0",
      description: "Exercises both learner-facing hooks in tests.",
      hooks: ["lesson.afterDraft", "attempt.evaluated"],
      enabled: true,
    },
    handlers: {
      "lesson.afterDraft": () => ({
        patch: { summary: "Patched by a plugin for the test suite." },
      }),
      "attempt.evaluated": () => ({
        messages: ["Keep the invariant in mind."],
      }),
    },
  };

  const deps = {
    db,
    sandbox: fakeSandbox(),
    generate: fakeGenerate(() => draft()),
    plugins: createPluginRegistry([plugin]),
    requireSandbox: true,
  };

  const lesson = await createLesson(deps, {
    userId: user.id,
    source: "goal",
    goal: "Learn doubling",
    stepCount: 1,
  });
  assert.equal(lesson.summary, "Patched by a plugin for the test suite.");

  const attempt = await recordAttempt(deps, {
    userId: user.id,
    lessonId: lesson.id,
    stepIndex: 0,
    code: "print(int(input()) * 2)",
  });
  assert.deepEqual(attempt.pluginMessages, ["Keep the invariant in mind."]);
});

test("records an attempt and daily activity", async () => {
  const db = makeDb();
  const user = seedUser(db);
  const deps = {
    db,
    sandbox: fakeSandbox(),
    generate: fakeGenerate(() => draft()),
    requireSandbox: true,
  };

  const lesson = await createLesson(deps, {
    userId: user.id,
    source: "goal",
    goal: "Learn doubling",
    stepCount: 1,
  });

  const { report } = await recordAttempt(deps, {
    userId: user.id,
    lessonId: lesson.id,
    stepIndex: 0,
    code: "print(int(input()) * 2)",
  });

  assert.equal(report.passed, true);
  const attempts = db
    .prepare("SELECT passed FROM attempts WHERE lesson_id = ?")
    .all(lesson.id) as Array<{ passed: number }>;
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].passed, 1);

  const activity = db
    .prepare("SELECT COUNT(*) AS total FROM daily_activity WHERE user_id = ?")
    .get(user.id) as { total: number };
  assert.equal(activity.total, 1);
});
