import { getAi } from "./ai";
import { getDb } from "./db";
import type { LessonDeps } from "./lessons";
import { getPluginRegistry } from "./plugins/runtime";
import { getSandboxRunner, sandboxRequired } from "./sandbox";

function intEnv(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Lesson generation needs the provider chain and the sandbox together: every
 * generated solution is executed before it is stored.
 */
export function lessonDeps(): LessonDeps {
  return {
    db: getDb(),
    generate: getAi().generate,
    sandbox: getSandboxRunner(),
    plugins: getPluginRegistry(),
    requireSandbox: sandboxRequired(),
    maxFixAttempts: intEnv(process.env.SOLUTION_MAX_ATTEMPTS, 2),
  };
}
