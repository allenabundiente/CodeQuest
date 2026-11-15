import { ConfigurationError } from "../errors";
import type { Language } from "../types";
import { createJudge0Runner } from "./judge0";
import { createPistonRunner } from "./piston";
import type { SandboxRunner } from "./types";

export * from "./types";
export { createPistonRunner, fetchPistonRuntimes } from "./piston";
export { createJudge0Runner, JUDGE0_LANGUAGE_IDS } from "./judge0";
export { runTestsOnSolution, outputsMatch, normalizeOutput } from "./verify";
export type { VerifyOptions } from "./verify";

export type SandboxDriver = "piston" | "judge0";

export interface SandboxConfig {
  driver: SandboxDriver;
  pistonUrl: string;
  judge0Url: string;
  judge0Token?: string;
  versions?: Partial<Record<Language, string>>;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function parseJsonEnv<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function sandboxConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SandboxConfig {
  const driver = (env.SANDBOX_DRIVER ?? "piston").toLowerCase();
  return {
    driver: driver === "judge0" ? "judge0" : "piston",
    pistonUrl: (env.PISTON_URL ?? "http://localhost:2000").replace(/\/$/, ""),
    judge0Url: (env.JUDGE0_URL ?? "http://localhost:2358").replace(/\/$/, ""),
    judge0Token: env.JUDGE0_AUTH_TOKEN || undefined,
    versions: parseJsonEnv<Partial<Record<Language, string>>>(
      env.PISTON_LANG_VERSIONS,
    ),
    timeoutMs: Number(env.SANDBOX_TIMEOUT_MS ?? 6000),
  };
}

export function createSandboxRunner(config: SandboxConfig): SandboxRunner {
  if (config.driver === "judge0") {
    if (!config.judge0Url) {
      throw new ConfigurationError("JUDGE0_URL is not set.");
    }
    return createJudge0Runner({
      baseUrl: config.judge0Url,
      authToken: config.judge0Token,
      timeoutMs: config.timeoutMs,
      fetchImpl: config.fetchImpl,
    });
  }

  if (!config.pistonUrl) {
    throw new ConfigurationError("PISTON_URL is not set.");
  }
  return createPistonRunner({
    baseUrl: config.pistonUrl,
    versions: config.versions,
    timeoutMs: config.timeoutMs,
    fetchImpl: config.fetchImpl,
  });
}

let singleton: SandboxRunner | null = null;

export function getSandboxRunner(): SandboxRunner {
  singleton ??= createSandboxRunner(sandboxConfigFromEnv());
  return singleton;
}

export function sandboxRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env.SANDBOX_REQUIRED ?? "true").toLowerCase() !== "false";
}
