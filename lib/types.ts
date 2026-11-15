export const LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "go",
  "java",
  "cpp",
] as const;
export type Language = (typeof LANGUAGES)[number];

export const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const SOURCES = ["goal", "code", "pdf", "github"] as const;
export type SourceKind = (typeof SOURCES)[number];

export const TRANSLATION_LOCALES = ["tl", "ceb"] as const;
export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number];

export interface TestCase {
  input: string;
  expected: string;
  name?: string;
}

export interface LessonStep {
  title: string;
  goal: string;
  explanation: string;
  starterCode: string;
  solution: string;
  tests: TestCase[];
  hints: string[];
}

export interface LessonDraft {
  title: string;
  summary: string;
  language: Language;
  difficulty: Difficulty;
  estimatedMinutes: number;
  learningObjectives: string[];
  steps: LessonStep[];
}

export interface StoredStep extends LessonStep {
  /** True when the solution passed every test in the sandbox. */
  verified: boolean;
  testsPassed: number;
}

export interface LessonContent {
  draft: LessonDraft;
  /** Failing solutions are discarded before the lesson is stored. */
  steps: StoredStep[];
  discardedSteps: number;
  sourceNote: string;
}

/** Client-safe step: the reference solution and draft hints never leave the server. */
export interface LessonStepView {
  title: string;
  goal: string;
  explanation: string;
  starterCode: string;
  tests: TestCase[];
}

export interface LessonView {
  id: string;
  title: string;
  summary: string;
  language: Language;
  difficulty: Difficulty;
  source: SourceKind;
  verified: boolean;
  provider: string | null;
  createdAt: string;
  estimatedMinutes: number;
  learningObjectives: string[];
  discardedSteps: number;
  steps: LessonStepView[];
}

export interface LessonRecord {
  id: string;
  userId: string;
  title: string;
  summary: string;
  language: Language;
  difficulty: Difficulty;
  source: SourceKind;
  goal: string | null;
  content: LessonContent;
  verified: boolean;
  provider: string | null;
  createdAt: string;
}

export interface TestOutcome {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface VerificationReport {
  passed: boolean;
  outcomes: TestOutcome[];
}

export interface TranslationStep {
  title: string;
  goal: string;
  explanation: string;
  hints: string[];
}

export interface HintResult {
  level: number;
  text: string;
  nextLevel: number | null;
  cached: boolean;
}

export interface TranslationPayload {
  locale: TranslationLocale;
  title: string;
  summary: string;
  steps: TranslationStep[];
}

export interface LessonSummary {
  id: string;
  title: string;
  summary: string;
  language: Language;
  difficulty: Difficulty;
  source: SourceKind;
  verified: boolean;
  stepCount: number;
  createdAt: string;
}

export interface QuotaSnapshot {
  usedCalls: number;
  remainingCalls: number;
  limitCalls: number;
  usedTokens: number;
  limitTokens: number;
  resetAt: string;
}

export interface StreakSummary {
  current: number;
  longest: number;
  activeToday: boolean;
  days: string[];
}
