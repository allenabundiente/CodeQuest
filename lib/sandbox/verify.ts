import type { Language, TestCase, TestOutcome, VerificationReport } from "../types";
import type { SandboxRunner } from "./types";

/** Normalize line endings, trailing whitespace, and surrounding blank lines. */
export function normalizeOutput(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Grading is exact after normalization. An empty expected value only requires
 * the program to exit successfully (used for "no output" exercises).
 */
export function outputsMatch(expected: string, actual: string): boolean {
  if (expected.trim() === "") return true;
  return normalizeOutput(expected) === normalizeOutput(actual);
}

export interface VerifyOptions {
  language: Language;
  code: string;
  tests: TestCase[];
  timeoutMs?: number;
  maxTests?: number;
  onOutcome?: (outcome: TestOutcome, index: number) => void;
}

/**
 * Runs each test in the sandbox sequentially (cheap boxes choke on parallel
 * jobs). Infrastructure failures are surfaced instead of being scored as a
 * wrong answer, so a down sandbox never silently discards a correct solution.
 */
export async function runTestsOnSolution(
  runner: SandboxRunner,
  options: VerifyOptions,
): Promise<VerificationReport> {
  const tests = options.tests.slice(0, options.maxTests ?? 5);
  const outcomes: TestOutcome[] = [];
  let infraFailures = 0;
  let firstInfraError: unknown = null;

  for (const [index, test] of tests.entries()) {
    const name = test.name ?? `Test ${index + 1}`;
    try {
      const result = await runner.execute({
        language: options.language,
        code: options.code,
        stdin: test.input,
        timeoutMs: options.timeoutMs,
      });
      const passed =
        !result.timedOut &&
        result.exitCode !== null &&
        outputsMatch(test.expected, result.stdout);
      const outcome: TestOutcome = {
        name,
        passed,
        expected: test.expected,
        actual: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      };
      outcomes.push(outcome);
      options.onOutcome?.(outcome, index);
    } catch (error) {
      infraFailures += 1;
      firstInfraError ??= error;
      const outcome: TestOutcome = {
        name,
        passed: false,
        expected: test.expected,
        actual: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
        timedOut: false,
      };
      outcomes.push(outcome);
      options.onOutcome?.(outcome, index);
    }
  }

  if (tests.length > 0 && infraFailures === tests.length && firstInfraError) {
    throw firstInfraError;
  }

  return {
    passed: outcomes.length > 0 && outcomes.every((outcome) => outcome.passed),
    outcomes,
  };
}
