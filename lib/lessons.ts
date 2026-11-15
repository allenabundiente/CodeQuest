import type { RepoContext } from "./ingest/github";
import { buildPasteContext } from "./ingest/paste";
import {
  LessonDraftSchema,
  SolutionCandidateSchema,
} from "./schemas";
import type { GenerateJson } from "./providers";
import type { PluginRegistry } from "./plugins/registry";
import { runTestsOnSolution } from "./sandbox";
import type { SandboxRunner } from "./sandbox";
import { BadRequestError, LessonGenerationFailedError } from "./errors";
import type { Db } from "./db";
import { newId, nowIso, todayKey } from "./db";
import {
  buildLessonPrompt,
  buildSolutionFixPrompt,
  LESSON_SYSTEM,
  SOLUTION_FIX_SYSTEM,
} from "./prompts";
import type {
  Difficulty,
  Language,
  LessonContent,
  LessonDraft,
  LessonRecord,
  LessonSummary,
  LessonView,
  SourceKind,
  StoredStep,
  TestCase,
} from "./types";

export interface LessonDeps {
  db: Db;
  generate: GenerateJson;
  sandbox: SandboxRunner;
  /** Optional plugin runtime; hooks never block generation failures. */
  plugins?: PluginRegistry;
  now?: () => Date;
  maxFixAttempts?: number;
  requireSandbox?: boolean;
}

export interface LessonInput {
  userId: string;
  source: SourceKind;
  goal?: string;
  code?: string;
  errorText?: string;
  pdfText?: string;
  github?: RepoContext;
  language?: Language;
  difficulty?: Difficulty;
  title?: string;
  stepCount?: number;
}

interface LessonRow {
  id: string;
  user_id: string;
  title: string;
  summary: string;
  language: string;
  difficulty: string;
  source: string;
  goal: string | null;
  content: string;
  verified: number;
  provider: string | null;
  created_at: string;
}

function toRecord(row: LessonRow): LessonRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    summary: row.summary,
    language: row.language as Language,
    difficulty: row.difficulty as Difficulty,
    source: row.source as SourceKind,
    goal: row.goal,
    content: JSON.parse(row.content) as LessonContent,
    verified: row.verified === 1,
    provider: row.provider,
    createdAt: row.created_at,
  };
}

function sourceFromInput(input: LessonInput): {
  material: string;
  goal: string | null;
  label: string;
} {
  switch (input.source) {
    case "goal": {
      const goal = input.goal?.trim();
      if (!goal || goal.length < 8) {
        throw new BadRequestError(
          "Describe what you want to learn in at least a sentence.",
        );
      }
      return { material: goal, goal, label: "learning goal" };
    }
    case "code": {
      const context = buildPasteContext({
        code: input.code,
        errorText: input.errorText,
        goal: input.goal,
        language: input.language,
        title: input.title,
      });
      return {
        material: context.material,
        goal: input.goal?.trim() || null,
        label: "pasted code and error",
      };
    }
    case "pdf": {
      const text = input.pdfText?.trim();
      if (!text) throw new BadRequestError("Upload a PDF to build a lesson from.");
      return {
        material: text,
        goal: input.goal?.trim() || null,
        label: "PDF handout",
      };
    }
    case "github": {
      if (!input.github) throw new BadRequestError("Import a GitHub repository first.");
      return {
        material: input.github.text,
        goal: input.goal?.trim() || null,
        label: `${input.github.owner}/${input.github.repo}@${input.github.ref}`,
      };
    }
    default:
      throw new BadRequestError("Unsupported lesson source.");
  }
}

function validatedTests(tests: TestCase[]): TestCase[] {
  return tests
    .filter((test) => typeof test.expected === "string")
    .slice(0, 5)
    .map((test, index) => ({
      name: test.name?.slice(0, 120) || `Test ${index + 1}`,
      input: typeof test.input === "string" ? test.input : "",
      expected: test.expected,
    }));
}

/**
 * Seed only rung 1 from the draft so the first nudge is instant. Rungs 2 and 3
 * are generated on demand, which keeps the ladder genuinely sequential.
 */
function seedHints(
  db: Db,
  lessonId: string,
  steps: StoredStep[],
  now: Date,
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO hints (lesson_id, step_index, level, text, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  steps.forEach((step, stepIndex) => {
    const first = step.hints[0]?.trim();
    if (!first || first.length < 10) return;
    insert.run(lessonId, stepIndex, 1, first, nowIso(now));
  });
}

async function verifyStep(
  deps: LessonDeps,
  input: LessonInput,
  draft: LessonDraft,
  step: StoredStep,
  userId: string,
): Promise<StoredStep> {
  const language = draft.language;
  const tests = validatedTests(step.tests);
  if (tests.length === 0) {
    return { ...step, tests: [], verified: false, testsPassed: 0 };
  }

  let report = await runTestsOnSolution(deps.sandbox, {
    language,
    code: step.solution,
    tests,
  });
  let solution = step.solution;

  const maxFixes = deps.maxFixAttempts ?? 2;
  for (let attempt = 1; attempt <= maxFixes && !report.passed; attempt += 1) {
    let candidate;
    try {
      candidate = await deps.generate({
        task: "lesson:solution-fix",
        system: SOLUTION_FIX_SYSTEM,
        prompt: buildSolutionFixPrompt({
          language,
          step,
          failingCode: solution,
          outcomes: report.outcomes,
        }),
        schema: SolutionCandidateSchema,
        userId,
        temperature: 0.2,
        maxTokens: 2500,
      });
    } catch {
      // Provider trouble while repairing: stop repairing, discard the step.
      break;
    }

    const candidateReport = await runTestsOnSolution(deps.sandbox, {
      language,
      code: candidate.data.code,
      tests,
    });
    if (candidateReport.passed) {
      solution = candidate.data.code;
      report = candidateReport;
      break;
    }
  }

  return {
    ...step,
    solution,
    tests,
    verified: report.passed,
    testsPassed: report.passed ? report.outcomes.length : 0,
  };
}

export async function createLesson(
  deps: LessonDeps,
  input: LessonInput,
): Promise<LessonRecord> {
  const source = sourceFromInput(input);
  const stepCount = Math.min(4, Math.max(1, input.stepCount ?? 3));
  const requireSandbox = deps.requireSandbox ?? true;

  const draftResult = await deps.generate({
    task: "lesson:draft",
    system: LESSON_SYSTEM,
    prompt: buildLessonPrompt({
      source: input.source,
      material: source.material,
      goal: source.goal,
      language: input.language,
      difficulty: input.difficulty,
      stepCount,
      sourceLabel: source.label,
    }),
    schema: LessonDraftSchema,
    userId: input.userId,
    maxTokens: 6000,
    temperature: 0.5,
    cacheTtlSeconds: 7 * 24 * 60 * 60,
  });

  let draft = draftResult.data;

  // A provider occasionally ignores the requested language; retry once with an
  // explicit correction instead of verifying a program in the wrong language.
  if (input.language && draft.language !== input.language) {
    const retry = await deps.generate({
      task: "lesson:draft-language-retry",
      system: LESSON_SYSTEM,
      prompt: `${buildLessonPrompt({
        source: input.source,
        material: source.material,
        goal: source.goal,
        language: input.language,
        difficulty: input.difficulty,
        stepCount,
        sourceLabel: source.label,
      })}\n\nIMPORTANT: the previous attempt used ${draft.language}. Rewrite the entire lesson in ${input.language}.`,
      schema: LessonDraftSchema,
      userId: input.userId,
      maxTokens: 6000,
      temperature: 0.4,
      cacheTtlSeconds: 7 * 24 * 60 * 60,
    });
    if (retry.data.language === input.language) {
      draft = retry.data;
    }
  }

  if (deps.plugins) {
    const hook = await deps.plugins.runHook("lesson.afterDraft", {
      draft,
      source: input.source,
    });
    if (Object.keys(hook.patch).length > 0) {
      const merged = LessonDraftSchema.safeParse({ ...draft, ...hook.patch });
      if (merged.success) {
        draft = merged.data;
      }
    }
  }

  const rawSteps: StoredStep[] = draft.steps.map((step) => ({
    ...step,
    tests: validatedTests(step.tests),
    verified: false,
    testsPassed: 0,
  }));

  let steps: StoredStep[];
  let discardedSteps = 0;

  if (!requireSandbox) {
    steps = rawSteps;
  } else {
    steps = [];
    for (const step of rawSteps) {
      const verified = await verifyStep(deps, input, draft, step, input.userId);
      if (verified.verified) {
        steps.push(verified);
      } else {
        discardedSteps += 1;
      }
    }
    if (steps.length === 0) {
      throw new LessonGenerationFailedError(
        "Every generated solution failed in the sandbox, so nothing was saved. Try a more specific prompt or a smaller scope.",
        {
          discardedSteps,
          provider: draftResult.provider,
          language: draft.language,
        },
      );
    }
  }

  const storedDraft: LessonDraft = { ...draft, steps: steps.map((step) => ({ ...step })) };
  const content: LessonContent = {
    draft: storedDraft,
    steps,
    discardedSteps,
    sourceNote: source.label,
  };

  const now = (deps.now ?? (() => new Date()))();
  const id = newId();
  const record: LessonRecord = {
    id,
    userId: input.userId,
    title: draft.title,
    summary: draft.summary,
    language: draft.language,
    difficulty: draft.difficulty,
    source: input.source,
    goal: source.goal,
    content,
    verified: steps.length > 0 && steps.every((step) => step.verified),
    provider: draftResult.provider,
    createdAt: nowIso(now),
  };

  deps.db
    .prepare(
      `INSERT INTO lessons (id, user_id, title, summary, language, difficulty, source, goal, content, verified, provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.userId,
      record.title,
      record.summary,
      record.language,
      record.difficulty,
      record.source,
      record.goal,
      JSON.stringify(record.content),
      record.verified ? 1 : 0,
      record.provider,
      record.createdAt,
    );

  seedHints(deps.db, id, steps, now);
  recordActivity(deps.db, input.userId, todayKey(now));

  return record;
}

export function loadLesson(
  db: Db,
  userId: string,
  lessonId: string,
): LessonRecord | null {
  const row = db
    .prepare("SELECT * FROM lessons WHERE id = ? AND user_id = ?")
    .get(lessonId, userId) as LessonRow | undefined;
  return row ? toRecord(row) : null;
}

export function listLessons(db: Db, userId: string): LessonSummary[] {
  const rows = db
    .prepare(
      "SELECT * FROM lessons WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(userId) as unknown as LessonRow[];
  return rows.map((row) => {
    const record = toRecord(row);
    return {
      id: record.id,
      title: record.title,
      summary: record.summary,
      language: record.language,
      difficulty: record.difficulty,
      source: record.source,
      verified: record.verified,
      stepCount: record.content.steps.length,
      createdAt: record.createdAt,
    };
  });
}

/** Strip solutions and draft hints before sending a lesson to the browser. */
export function toLessonView(record: LessonRecord): LessonView {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    language: record.language,
    difficulty: record.difficulty,
    source: record.source,
    verified: record.verified,
    provider: record.provider,
    createdAt: record.createdAt,
    estimatedMinutes: record.content.draft.estimatedMinutes,
    learningObjectives: record.content.draft.learningObjectives,
    discardedSteps: record.content.discardedSteps,
    steps: record.content.steps.map((step) => ({
      title: step.title,
      goal: step.goal,
      explanation: step.explanation,
      starterCode: step.starterCode,
      tests: step.tests,
    })),
  };
}

export interface AttemptInput {
  userId: string;
  lessonId: string;
  stepIndex: number;
  code: string;
}

export async function recordAttempt(
  deps: LessonDeps,
  input: AttemptInput,
) {
  const lesson = loadLesson(deps.db, input.userId, input.lessonId);
  if (!lesson) throw new BadRequestError("Lesson not found.");
  const step = lesson.content.steps[input.stepIndex];
  if (!step) throw new BadRequestError("That step does not exist.");
  if (!input.code.trim()) throw new BadRequestError("Write some code first.");

  const report = await runTestsOnSolution(deps.sandbox, {
    language: lesson.language,
    code: input.code,
    tests: step.tests,
  });

  const now = (deps.now ?? (() => new Date()))();
  deps.db
    .prepare(
      `INSERT INTO attempts (id, lesson_id, user_id, step_index, code, passed, results, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId(),
      input.lessonId,
      input.userId,
      input.stepIndex,
      input.code,
      report.passed ? 1 : 0,
      JSON.stringify(report),
      nowIso(now),
    );

  recordActivity(deps.db, input.userId, todayKey(now));

  const pluginRun = deps.plugins
    ? await deps.plugins.runHook("attempt.evaluated", {
        passed: report.passed,
        outcomes: report.outcomes,
        language: lesson.language,
        stepTitle: step.title,
      })
    : null;

  return {
    report,
    lessonTitle: lesson.title,
    pluginMessages: pluginRun?.messages ?? [],
    pluginFailures: pluginRun?.failures.map((failure) => failure.pluginId) ?? [],
  };
}

export function recordActivity(db: Db, userId: string, day: string): void {
  db.prepare(
    `INSERT INTO daily_activity (user_id, day, actions) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET actions = actions + 1`,
  ).run(userId, day);
}
