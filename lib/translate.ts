import type { Db } from "./db";
import { nowIso } from "./db";
import { AppError, NotFoundError } from "./errors";
import { loadLesson } from "./lessons";
import { buildTranslationPrompt, TRANSLATION_SYSTEM } from "./prompts";
import type { GenerateJson } from "./providers";
import { TranslationSchema } from "./schemas";
import type { TranslationLocale, TranslationPayload } from "./types";

const TRANSLATION_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface TranslateDeps {
  db: Db;
  generate: GenerateJson;
  now?: () => Date;
}

export interface TranslatedLesson extends TranslationPayload {
  cached: boolean;
}

interface HintRow {
  step_index: number;
  level: number;
  text: string;
}

function readCached(
  db: Db,
  lessonId: string,
  locale: TranslationLocale,
): TranslationPayload | null {
  const row = db
    .prepare(
      "SELECT payload FROM translations WHERE lesson_id = ? AND locale = ?",
    )
    .get(lessonId, locale) as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as TranslationPayload;
  } catch {
    return null;
  }
}

/**
 * Translate learner-facing prose (title, summary, goal, explanation, hints)
 * and cache the result per locale. Code, tests and identifiers are never sent
 * for translation.
 */
export async function translateLesson(
  deps: TranslateDeps,
  input: { userId: string; lessonId: string; locale: TranslationLocale },
): Promise<TranslatedLesson> {
  const lesson = loadLesson(deps.db, input.userId, input.lessonId);
  if (!lesson) throw new NotFoundError("Lesson not found.");

  const cached = readCached(deps.db, input.lessonId, input.locale);
  if (cached) return { ...cached, cached: true };

  const hintRows = deps.db
    .prepare(
      "SELECT step_index, level, text FROM hints WHERE lesson_id = ? ORDER BY step_index ASC, level ASC",
    )
    .all(input.lessonId) as unknown as HintRow[];

  const source = {
    title: lesson.title,
    summary: lesson.summary,
    steps: lesson.content.steps.map((step, index) => {
      const hints = hintRows
        .filter((row) => row.step_index === index)
        .map((row) => row.text);
      return {
        title: step.title,
        goal: step.goal,
        explanation: step.explanation,
        hints: hints.length > 0 ? hints : step.hints,
      };
    }),
  };

  const generated = await deps.generate({
    task: "lesson:translate",
    system: TRANSLATION_SYSTEM,
    prompt: buildTranslationPrompt(input.locale, source),
    schema: TranslationSchema,
    userId: input.userId,
    maxTokens: 3500,
    temperature: 0.3,
    cacheTtlSeconds: TRANSLATION_TTL_SECONDS,
  });

  const steps = generated.data.steps;
  if (steps.length !== source.steps.length) {
    throw new AppError(
      "translation_invalid",
      "The translator returned a different number of steps than the lesson, so it was discarded.",
      502,
    );
  }

  const payload: TranslationPayload = {
    locale: input.locale,
    title: generated.data.title,
    summary: generated.data.summary,
    steps: steps.map((step, index) => ({
      title: step.title,
      goal: step.goal,
      explanation: step.explanation,
      hints: step.hints,
    })),
  };

  deps.db
    .prepare(
      `INSERT INTO translations (lesson_id, locale, payload, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(lesson_id, locale) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
    )
    .run(
      input.lessonId,
      input.locale,
      JSON.stringify(payload),
      nowIso((deps.now ?? (() => new Date()))()),
    );

  return { ...payload, cached: false };
}
