import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors";
import { requestHint } from "../lib/hints";
import { createLesson } from "../lib/lessons";
import type { GenerateJson } from "../lib/providers/generate";
import type { LessonDraft } from "../lib/types";
import { fakeGenerate, fakeSandbox, makeDb, seedUser } from "./helpers";

function draft(hints: string[]): LessonDraft {
  return {
    title: "Reading input",
    summary: "Practice reading and transforming a value from standard input.",
    language: "python",
    difficulty: "beginner",
    estimatedMinutes: 15,
    learningObjectives: ["Read stdin"],
    steps: [
      {
        title: "Double it",
        goal: "Print the doubled input.",
        explanation: "Read a number from stdin and print twice its value.",
        starterCode: "# TODO\nvalue = int(input())",
        solution: "print(int(input()) * 2)",
        tests: [{ name: "Two", input: "2", expected: "4" }],
        hints,
      },
    ],
  };
}

async function lessonWithHints(
  hints: string[],
  generate: GenerateJson = fakeGenerate(() => draft(hints)),
) {
  const db = makeDb();
  const user = seedUser(db);
  const lesson = await createLesson(
    { db, sandbox: fakeSandbox(), generate, requireSandbox: false },
    { userId: user.id, source: "goal", goal: "Practice doubling", stepCount: 1 },
  );
  return { db, user, lesson };
}

test("serves the seeded first rung without another model call", async () => {
  const { db, user, lesson } = await lessonWithHints([
    "Think about what doubling means.",
    "Multiply the parsed number by two.",
    "Print the value of n times two.",
  ]);

  const hint = await requestHint(
    { db, generate: fakeGenerate(() => assert.fail("should not generate")) },
    { userId: user.id, lessonId: lesson.id, stepIndex: 0, level: 1 },
  );

  assert.equal(hint.cached, true);
  assert.equal(hint.level, 1);
  assert.match(hint.text, /doubling/);
  assert.equal(hint.nextLevel, 2);

  // Rung 2 is not seeded: it must be generated, not served from the draft.
  let calls = 0;
  const generate = fakeGenerate(() => {
    calls += 1;
    return { hint: "Multiply the number you parsed by two." };
  });
  const second = await requestHint(
    { db, generate },
    { userId: user.id, lessonId: lesson.id, stepIndex: 0, level: 2 },
  );
  assert.equal(second.cached, false);
  assert.equal(calls, 1);
});

test("refuses to skip a rung", async () => {
  const { db, user, lesson } = await lessonWithHints([]);

  await assert.rejects(
    requestHint(
      { db, generate: fakeGenerate(() => ({ hint: "never used" })) },
      { userId: user.id, lessonId: lesson.id, stepIndex: 0, level: 3 },
    ),
    (error: unknown) => error instanceof ConflictError,
  );
});

test("generates a missing rung and then caches it", async () => {
  const { db, user, lesson } = await lessonWithHints([]);
  let calls = 0;
  const generate = fakeGenerate(() => {
    calls += 1;
    return { hint: "Start by parsing the input into an integer." };
  });

  const first = await requestHint(
    { db, generate },
    { userId: user.id, lessonId: lesson.id, stepIndex: 0, level: 1 },
  );
  const second = await requestHint(
    { db, generate },
    { userId: user.id, lessonId: lesson.id, stepIndex: 0, level: 1 },
  );

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test("validates level, step, and lesson ownership", async () => {
  const { db, user, lesson } = await lessonWithHints([]);

  await assert.rejects(
    requestHint(
      { db, generate: fakeGenerate(() => ({ hint: "x" })) },
      { userId: user.id, lessonId: lesson.id, stepIndex: 0, level: 5 },
    ),
    (error: unknown) => error instanceof BadRequestError,
  );

  await assert.rejects(
    requestHint(
      { db, generate: fakeGenerate(() => ({ hint: "x" })) },
      { userId: user.id, lessonId: lesson.id, stepIndex: 3, level: 1 },
    ),
    (error: unknown) => error instanceof BadRequestError,
  );

  const other = seedUser(db, "other@example.com");
  await assert.rejects(
    requestHint(
      { db, generate: fakeGenerate(() => ({ hint: "x" })) },
      { userId: other.id, lessonId: lesson.id, stepIndex: 0, level: 1 },
    ),
    (error: unknown) => error instanceof NotFoundError,
  );
});
