import assert from "node:assert/strict";
import test from "node:test";
import {
  DifficultySchema,
  LanguageSchema,
  LessonDraftSchema,
  TranslationLocaleSchema,
} from "../lib/schemas";
import {
  DIFFICULTIES,
  LANGUAGES,
  TRANSLATION_LOCALES,
} from "../lib/types";

test("schema enums match the domain tuples", () => {
  for (const language of LANGUAGES) {
    assert.equal(LanguageSchema.safeParse(language).success, true);
  }
  for (const difficulty of DIFFICULTIES) {
    assert.equal(DifficultySchema.safeParse(difficulty).success, true);
  }
  for (const locale of TRANSLATION_LOCALES) {
    assert.equal(TranslationLocaleSchema.safeParse(locale).success, true);
  }
  assert.equal(TranslationLocaleSchema.safeParse("en").success, false);
});

test("accepts a well-formed lesson draft", () => {
  const result = LessonDraftSchema.safeParse({
    title: "Group totals",
    summary: "Group records and sum their values using a dictionary.",
    language: "python",
    difficulty: "beginner",
    estimatedMinutes: 25,
    learningObjectives: ["Use dictionaries"],
    steps: [
      {
        title: "Sum by key",
        goal: "Print totals per key.",
        explanation:
          "Parse each line, split the key and the number, then accumulate the totals.",
        starterCode: "# TODO",
        solution: "from collections import defaultdict",
        tests: [{ name: "One", input: "a 1", expected: "a 1" }],
        hints: ["What maps keys to totals?", "Use a dict.", "Add to the running total."],
      },
    ],
  });

  assert.equal(result.success, true);
});

test("rejects drafts with an unknown language or missing tests", () => {
  const base = {
    title: "Group totals",
    summary: "Group records and sum their values using a dictionary.",
    language: "ruby",
    difficulty: "beginner",
    estimatedMinutes: 25,
    learningObjectives: ["Use dictionaries"],
    steps: [
      {
        title: "Sum by key",
        goal: "Print totals per key.",
        explanation:
          "Parse each line, split the key and the number, then accumulate the totals.",
        starterCode: "# TODO",
        solution: "print(1)",
        tests: [],
        hints: [],
      },
    ],
  };

  const result = LessonDraftSchema.safeParse(base);
  assert.equal(result.success, false);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    assert.ok(paths.includes("language"));
    assert.ok(paths.some((path) => path.includes("tests")));
  }
});
