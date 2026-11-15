import type { Db } from "./db";
import { nowIso } from "./db";
import { BadRequestError, ConflictError, NotFoundError } from "./errors";
import { loadLesson } from "./lessons";
import { buildHintPrompt, HINT_SYSTEM } from "./prompts";
import type { GenerateJson } from "./providers";
import { HintSchema } from "./schemas";
import type { HintResult } from "./types";

export const MAX_HINT_LEVEL = 3;
const HINT_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface HintDeps {
  db: Db;
  generate: GenerateJson;
  now?: () => Date;
}

interface HintRow {
  step_index: number;
  level: number;
  text: string;
}

function findHint(
  db: Db,
  lessonId: string,
  stepIndex: number,
  level: number,
): HintRow | null {
  const row = db
    .prepare(
      "SELECT step_index, level, text FROM hints WHERE lesson_id = ? AND step_index = ? AND level = ?",
    )
    .get(lessonId, stepIndex, level) as HintRow | undefined;
  return row ?? null;
}

export function listHints(
  db: Db,
  lessonId: string,
): Array<{ stepIndex: number; level: number; text: string }> {
  const rows = db
    .prepare(
      "SELECT step_index, level, text FROM hints WHERE lesson_id = ? ORDER BY step_index ASC, level ASC",
    )
    .all(lessonId) as unknown as HintRow[];
  return rows.map((row) => ({
    stepIndex: row.step_index,
    level: row.level,
    text: row.text,
  }));
}

export interface HintRequest {
  userId: string;
  lessonId: string;
  stepIndex: number;
  level: number;
}

/**
 * Hints unlock one rung at a time. Rung 1 is seeded from the generated lesson;
 * later rungs are generated on demand and stored, so they are stable and free
 * to re-read.
 */
export async function requestHint(
  deps: HintDeps,
  input: HintRequest,
): Promise<HintResult> {
  const lesson = loadLesson(deps.db, input.userId, input.lessonId);
  if (!lesson) throw new NotFoundError("Lesson not found.");

  const step = lesson.content.steps[input.stepIndex];
  if (!step) throw new BadRequestError("That step does not exist.");

  if (
    !Number.isInteger(input.level) ||
    input.level < 1 ||
    input.level > MAX_HINT_LEVEL
  ) {
    throw new BadRequestError(
      `Hint level must be between 1 and ${MAX_HINT_LEVEL}.`,
    );
  }

  const existing = findHint(
    deps.db,
    input.lessonId,
    input.stepIndex,
    input.level,
  );
  if (existing) {
    return {
      level: input.level,
      text: existing.text,
      nextLevel: input.level < MAX_HINT_LEVEL ? input.level + 1 : null,
      cached: true,
    };
  }

  if (input.level > 1) {
    const previous = findHint(
      deps.db,
      input.lessonId,
      input.stepIndex,
      input.level - 1,
    );
    if (!previous) {
      throw new ConflictError(
        `Unlock hint ${input.level - 1} first — each rung builds on the one before it.`,
      );
    }
  }

  const previousHints: string[] = [];
  for (let level = 1; level < input.level; level += 1) {
    const row = findHint(deps.db, input.lessonId, input.stepIndex, level);
    if (row) previousHints.push(row.text);
  }

  const generated = await deps.generate({
    task: `lesson:hint:${input.level}`,
    system: HINT_SYSTEM,
    prompt: buildHintPrompt({
      language: lesson.language,
      step,
      level: input.level,
      previousHints,
    }),
    schema: HintSchema,
    userId: input.userId,
    maxTokens: 500,
    temperature: 0.5,
    cacheTtlSeconds: HINT_TTL_SECONDS,
  });

  const now = (deps.now ?? (() => new Date()))();
  deps.db
    .prepare(
      `INSERT INTO hints (lesson_id, step_index, level, text, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(lesson_id, step_index, level) DO UPDATE SET text = excluded.text`,
    )
    .run(
      input.lessonId,
      input.stepIndex,
      input.level,
      generated.data.hint.trim(),
      nowIso(now),
    );

  return {
    level: input.level,
    text: generated.data.hint.trim(),
    nextLevel: input.level < MAX_HINT_LEVEL ? input.level + 1 : null,
    cached: false,
  };
}
