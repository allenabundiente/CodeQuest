import { createDb } from "../lib/db";
import type { Db } from "../lib/db";
import { createUser } from "../lib/db";
import type { GenerateJson, GenerateJsonOptions } from "../lib/providers/generate";
import type { SandboxRunner } from "../lib/sandbox";

export function makeDb(): Db {
  return createDb(":memory:");
}

export function seedUser(db: Db, email = "learner@example.com") {
  return createUser(db, { email, name: "Test Learner" });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function fakeGenerate(
  handler: (options: GenerateJsonOptions<unknown>) => unknown,
): GenerateJson {
  return async <T,>(
    options: GenerateJsonOptions<T>,
  ): Promise<{
    data: T;
    provider: "gemini";
    model: string;
    cached: boolean;
    attempts: number;
  }> => ({
    data: handler(options as unknown as GenerateJsonOptions<unknown>) as T,
    provider: "gemini",
    model: "gemini-test",
    cached: false,
    attempts: 1,
  });
}

/**
 * Deterministic stand-in for Piston/Judge0: doubles numeric stdin, and returns
 * 0 for any program containing the BROKEN marker.
 */
export function fakeSandbox(): SandboxRunner {
  return {
    name: "fake",
    async execute(request) {
      const input = (request.stdin ?? "").trim();
      const numeric = Number(input);
      const output = request.code.includes("BROKEN")
        ? "0"
        : Number.isFinite(numeric)
          ? String(numeric * 2)
          : "";
      return {
        stdout: `${output}\n`,
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 1,
      };
    },
  };
}
