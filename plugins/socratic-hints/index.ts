import type { HookHandler } from "../../lib/plugins/types";

const MAX_MESSAGES = 2;

function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  return (line ?? "").slice(0, 180);
}

const attemptHandler: HookHandler<"attempt.evaluated"> = (payload) => {
  if (payload.passed) {
    return {
      messages: [
        `${payload.stepTitle} passes all ${payload.outcomes.length} test${
          payload.outcomes.length === 1 ? "" : "s"
        }. Before moving on, say the invariant out loud in one sentence.`,
      ],
    };
  }

  const failures = payload.outcomes.filter((outcome) => !outcome.passed);
  const messages: string[] = [];

  if (failures.some((outcome) => outcome.timedOut)) {
    messages.push(
      "A test timed out: look for a loop or recursion whose exit condition can never become true.",
    );
  }

  const stderr = failures
    .map((outcome) => outcome.stderr.trim())
    .find((entry) => entry.length > 0);
  if (
    stderr &&
    /(SyntaxError|IndentationError|NameError|TypeError|ReferenceError|panic:|error:)/i.test(
      stderr,
    )
  ) {
    messages.push(
      `The runtime rejected the program before comparing output: ${firstLine(stderr)}`,
    );
  }

  if (messages.length === 0) {
    messages.push(
      "The program ran but the output differs. Compare expected and actual character by character, including blank lines.",
    );
  }

  return { messages: messages.slice(0, MAX_MESSAGES) };
};

export const handlers = {
  "attempt.evaluated": attemptHandler,
};
