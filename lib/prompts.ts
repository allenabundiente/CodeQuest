import type {
  Difficulty,
  Language,
  LessonStep,
  SourceKind,
  TestOutcome,
  TranslationLocale,
} from "./types";

export const MAX_PROMPT_SOURCE_CHARS = 18_000;

const LESSON_SHAPE = `{
  "title": "string, max 120 chars",
  "summary": "string, 2-3 sentences",
  "language": "python | javascript | typescript | go | java | cpp",
  "difficulty": "beginner | intermediate | advanced",
  "estimatedMinutes": 20,
  "learningObjectives": ["string"],
  "steps": [
    {
      "title": "string",
      "goal": "string, one sentence",
      "explanation": "string, 3-6 sentences that teach the idea",
      "starterCode": "string, scaffold with TODO comments",
      "solution": "string, complete working program",
      "tests": [{ "name": "Test 1", "input": "literal stdin", "expected": "exact stdout" }],
      "hints": ["concept nudge", "concrete approach", "near-complete guidance"]
    }
  ]
}`;

export const LESSON_SYSTEM = `You are CodeQuest, a curriculum engineer who turns source material into short, runnable programming lessons for Filipino learners.

Return exactly ONE JSON object and nothing else. Never wrap it in markdown fences.

Required shape:
${LESSON_SHAPE}

Non-negotiable rules:
1. "language" must be exactly one of: python, javascript, typescript, go, java, cpp. Use the requested language when one is given.
2. Produce between 1 and 4 steps. Each step must be independently runnable.
3. Every "solution" must be a COMPLETE self-contained program. It reads all input from stdin and writes ONLY the required result to stdout. No prompts, labels, or decorative output.
4. "tests" must contain 1-3 cases per step with literal stdin text and the exact stdout the program produces, including spacing. Expected output is compared after trimming trailing whitespace, so do not rely on leading/trailing blank lines.
5. "starterCode" must be a scaffold containing TODO comments. It must not already contain the working solution.
6. "explanation" teaches the concept in 3-6 sentences and connects it to the source material. Do not paste the source verbatim.
7. "hints" must be exactly 3 ladder rungs: (a) a conceptual nudge, (b) a concrete approach or pseudocode, (c) near-complete guidance in prose. Never include a full code listing or the final solution.
8. Never use randomness, current time, network access, file I/O, or interactive prompts. Standard library only.
9. Match the requested difficulty. Beginners get small inputs and explicit goals.
10. The lesson must be solvable from the information given.`;

export interface LessonSource {
  source: SourceKind;
  material: string;
  goal: string | null;
  language?: Language | null;
  difficulty?: Difficulty;
  stepCount: number;
  sourceLabel: string;
}

const SOURCE_GUIDANCE: Record<SourceKind, string> = {
  goal:
    "Build the lesson from the learner's stated goal. Invent small, realistic exercises that lead to that goal.",
  code:
    "The learner pasted code and/or an error. Build a lesson that repairs the underlying misconception first, then extends the same program with one harder step.",
  pdf:
    "Turn the attached document into practice. Teach the concepts the document covers, but write your own examples instead of copying text.",
  github:
    "Use the repository as the working context. Teach the patterns the repository actually uses, with small exercises inspired by its code.",
};

export function buildLessonPrompt(input: LessonSource): string {
  const language = input.language
    ? `Requested language: ${input.language}. Every step must use it.`
    : "Choose the language that fits the source material best (Python or JavaScript unless the source clearly uses another).";
  const difficulty = input.difficulty
    ? `Requested difficulty: ${input.difficulty}.`
    : "Choose a difficulty that fits the source material.";

  return [
    SOURCE_GUIDANCE[input.source],
    "",
    `Source type: ${input.source} (${input.sourceLabel}).`,
    language,
    difficulty,
    `Produce exactly ${input.stepCount} step${input.stepCount === 1 ? "" : "s"}.`,
    input.goal ? `Learner goal: ${input.goal}` : "",
    "",
    "<source_material>",
    input.material.slice(0, MAX_PROMPT_SOURCE_CHARS),
    "</source_material>",
    "",
    "Remember: JSON only, every solution runnable from stdin, every test exact. Do not include commentary outside the JSON object.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const SOLUTION_FIX_SYSTEM = `You are CodeQuest's sandbox debugger. A generated solution failed its own tests inside a sandbox.

Return exactly one JSON object, no markdown fences:
{ "code": "complete corrected program", "explanation": "one short paragraph on what was wrong" }

Rules:
- The program must read all input from stdin and write only the expected output to stdout.
- Keep the original exercise and test expectations unchanged. Fix the program, never the tests.
- Standard library only. No randomness, time, network, file I/O, or prompts.
- The code must be complete, not a diff.`;

export interface SolutionFixInput {
  language: Language;
  step: LessonStep;
  failingCode: string;
  outcomes: TestOutcome[];
}

export function buildSolutionFixPrompt(input: SolutionFixInput): string {
  const failures = input.outcomes
    .filter((outcome) => !outcome.passed)
    .slice(0, 3)
    .map((outcome, index) =>
      [
        `Failing test ${index + 1}: ${outcome.name}`,
        `expected stdout: ${JSON.stringify(outcome.expected)}`,
        `actual stdout: ${JSON.stringify(outcome.actual)}`,
        outcome.timedOut ? "the program timed out" : "",
        outcome.stderr ? `stderr: ${outcome.stderr.slice(0, 800)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  return [
    `Language: ${input.language}`,
    `Exercise: ${input.step.title} — ${input.step.goal}`,
    `Tests to satisfy: ${JSON.stringify(input.step.tests)}`,
    "",
    "Current program:",
    "```",
    input.failingCode,
    "```",
    "",
    failures,
    "",
    "Return the corrected complete program as JSON.",
  ].join("\n");
}

export const HINT_SYSTEM = `You are CodeQuest's tutor. You give one rung of a hint ladder for a single exercise.

Return exactly one JSON object, no markdown fences:
{ "hint": "the hint text" }

Rules:
- Never write a full solution, and never write more than two short lines of code.
- Level 1 is a conceptual nudge ("what property of the data matters here?").
- Level 2 is a concrete approach or pseudocode plan.
- Level 3 walks through the final step in prose while leaving the typing to the learner.
- Build on the earlier rungs; do not repeat them.
- Speak directly to the learner in 2-4 sentences.`;

export interface HintPromptInput {
  language: Language;
  step: LessonStep;
  level: number;
  previousHints: string[];
}

export function buildHintPrompt(input: HintPromptInput): string {
  return [
    `Language: ${input.language}`,
    `Exercise: ${input.step.title}`,
    `Goal: ${input.step.goal}`,
    `Explanation already shown: ${input.step.explanation}`,
    `Tests: ${JSON.stringify(input.step.tests)}`,
    `Starter code:`,
    "```",
    input.step.starterCode,
    "```",
    input.previousHints.length
      ? `Earlier rungs (do not repeat):\n${input.previousHints.map((hint, index) => `${index + 1}. ${hint}`).join("\n")}`
      : "This is the first rung.",
    "",
    `Produce rung ${input.level} of 3.`,
  ].join("\n");
}

const LOCALE_NAMES: Record<TranslationLocale, string> = {
  tl: "Tagalog (Filipino). Natural conversational Tagalog is fine; common programming terms may stay in English.",
  ceb: "Cebuano (Bisaya). Use natural conversational Cebuano/Bisaya; common programming terms may stay in English.",
};

export const TRANSLATION_SYSTEM = `You are CodeQuest's localizer. Translate learner-facing lesson text while keeping the technical meaning exact.

Return exactly one JSON object, no markdown fences:
{
  "title": "translated title",
  "summary": "translated summary",
  "steps": [{ "title": "...", "goal": "...", "explanation": "...", "hints": ["..."] }]
}

Rules:
- Translate only learner-facing prose. Never translate code, function names, identifiers, CLI commands, or test data.
- Keep the same number of steps and the same number of hints per step, in the same order.
- Keep sentences short and friendly, the way a tutor would explain in person.
- Do not add new advice, exercises, or examples that were not in the original.
- Preserve meaning precisely: if the original says "indentation", do not say "spacing".`;

export function buildTranslationPrompt(
  locale: TranslationLocale,
  payload: {
    title: string;
    summary: string;
    steps: Array<{ title: string; goal: string; explanation: string; hints: string[] }>;
  },
): string {
  return [
    `Target language: ${LOCALE_NAMES[locale]}`,
    "",
    "Lesson JSON to translate:",
    JSON.stringify(payload, null, 2),
    "",
    "Return the translated JSON object only.",
  ].join("\n");
}
