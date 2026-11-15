import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../lib/errors";
import { createLesson } from "../lib/lessons";
import { translateLesson } from "../lib/translate";
import type { GenerateJson } from "../lib/providers/generate";
import type { LessonDraft } from "../lib/types";
import { fakeGenerate, fakeSandbox, makeDb, seedUser } from "./helpers";

const draft: LessonDraft = {
  title: "Doubling numbers",
  summary: "Read a number and print twice its value.",
  language: "python",
  difficulty: "beginner",
  estimatedMinutes: 15,
  learningObjectives: ["Read stdin", "Print output"],
  steps: [
    {
      title: "Double it",
      goal: "Print the doubled input.",
      explanation: "Parse the input, multiply by two, and print the result.",
      starterCode: "# TODO",
      solution: "SECRET_SOLUTION_CODE",
      tests: [{ name: "Two", input: "2", expected: "4" }],
      hints: ["Think about doubling.", "Multiply by two.", "Print n * 2."],
    },
    {
      title: "Triple it",
      goal: "Print triple the input.",
      explanation: "Parse the input and print three times its value.",
      starterCode: "# TODO",
      solution: "SECRET_SOLUTION_CODE",
      tests: [{ name: "Two", input: "2", expected: "6" }],
      hints: ["Think about tripling.", "Multiply by three.", "Print n * 3."],
    },
  ],
};

async function fixture(generate: GenerateJson) {
  const db = makeDb();
  const user = seedUser(db);
  const lesson = await createLesson(
    { db, sandbox: fakeSandbox(), generate: fakeGenerate(() => draft), requireSandbox: false },
    { userId: user.id, source: "goal", goal: "Practice multiplication", stepCount: 2 },
  );
  return { db, user, lesson };
}

test("translates learner prose, caches it, and never sends solutions", async () => {
  let capturedPrompt = "";
  let calls = 0;
  const translateGenerate = fakeGenerate((options) => {
    calls += 1;
    capturedPrompt = options.prompt;
    return {
      title: "Pagdodoble ng numero",
      summary: "Magbasa ng numero at i-print ang doble nito.",
      steps: draft.steps.map((step) => ({
        title: `Isalin: ${step.title}`,
        goal: "Isalin ang layunin.",
        explanation: "Isalin ang paliwanag para sa mag-aaral.",
        hints: ["Unang rung.", "Ikalawang rung.", "Ikatlong rung."],
      })),
    };
  });

  const { db, user, lesson } = await fixture(translateGenerate);

  const first = await translateLesson(
    { db, generate: translateGenerate },
    { userId: user.id, lessonId: lesson.id, locale: "tl" },
  );
  const second = await translateLesson(
    { db, generate: translateGenerate },
    { userId: user.id, lessonId: lesson.id, locale: "tl" },
  );

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.equal(second.title, "Pagdodoble ng numero");
  assert.equal(second.steps.length, 2);
  assert.equal(capturedPrompt.includes("SECRET_SOLUTION_CODE"), false);

  const row = db
    .prepare("SELECT locale FROM translations WHERE lesson_id = ?")
    .all(lesson.id) as Array<{ locale: string }>;
  assert.equal(row.length, 1);
  assert.equal(row[0].locale, "tl");
});

test("rejects a translation with the wrong number of steps", async () => {
  const badGenerate = fakeGenerate(() => ({
    title: "Mali",
    summary: "Kulang ang mga hakbang.",
    steps: [
      {
        title: "Isa",
        goal: "Layunin",
        explanation: "Paliwanag para sa mag-aaral.",
        hints: ["a"],
      },
    ],
  }));

  const { db, user, lesson } = await fixture(fakeGenerate(() => draft));

  await assert.rejects(
    translateLesson(
      { db, generate: badGenerate },
      { userId: user.id, lessonId: lesson.id, locale: "ceb" },
    ),
    (error: unknown) =>
      error instanceof AppError && error.code === "translation_invalid",
  );
});
