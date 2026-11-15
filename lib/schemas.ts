import { z } from "zod";

/**
 * Bump when a prompt or schema changes so cached model output is not reused.
 */
export const SCHEMA_VERSION = "2026-11-11.1";

/**
 * Literal enums are declared here (instead of reusing the readonly tuples in
 * lib/types.ts) so Zod infers a precise union type. tests/schemas.test.ts keeps
 * them in sync with LANGUAGES / DIFFICULTIES / TRANSLATION_LOCALES.
 */
export const LanguageSchema = z.enum([
  "python",
  "javascript",
  "typescript",
  "go",
  "java",
  "cpp",
]);

export const DifficultySchema = z.enum([
  "beginner",
  "intermediate",
  "advanced",
]);

export const TranslationLocaleSchema = z.enum(["tl", "ceb"]);

export const TestCaseSchema = z.object({
  name: z.string().max(120).optional(),
  input: z.string().max(4000).default(""),
  expected: z.string().max(4000),
});

const ContentSchema = z.string().min(1).max(4000);

export const LessonStepSchema = z.object({
  title: z.string().min(3).max(160),
  goal: z.string().min(3).max(600),
  explanation: z.string().min(20).max(4000),
  starterCode: z.string().min(1).max(8000),
  solution: z.string().min(10).max(8000),
  tests: z.array(TestCaseSchema).min(1).max(5),
  hints: z.array(z.string().min(4).max(600)).max(5).default([]),
});

export const LessonDraftSchema = z.object({
  title: z.string().min(3).max(120),
  summary: z.string().min(20).max(600),
  language: LanguageSchema,
  difficulty: DifficultySchema,
  estimatedMinutes: z.number().int().min(5).max(240),
  learningObjectives: z.array(z.string().min(3).max(200)).min(1).max(5),
  steps: z.array(LessonStepSchema).min(1).max(5),
});

export const SolutionCandidateSchema = z.object({
  code: z.string().min(10).max(8000),
  explanation: z.string().max(1200).default(""),
});

export const HintSchema = z.object({
  hint: z.string().min(20).max(900),
});

export const TranslationStepSchema = z.object({
  title: ContentSchema,
  goal: ContentSchema,
  explanation: ContentSchema,
  hints: z.array(z.string().min(2).max(900)).max(5),
});

export const TranslationSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1200),
  steps: z.array(TranslationStepSchema).min(1).max(5),
});

export type LessonDraftOutput = z.infer<typeof LessonDraftSchema>;
