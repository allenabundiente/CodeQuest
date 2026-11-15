import type { Language } from "../types";
import type { ExecutionRequest, ExecutionResult, SandboxRunner } from "./types";
import { SandboxExecutionError } from "./types";

interface PistonRuntime {
  language: string;
  version: string;
  aliases?: string[];
}

const FILE_NAMES: Record<Language, string> = {
  python: "main.py",
  javascript: "main.js",
  typescript: "main.ts",
  go: "main.go",
  java: "Main.java",
  cpp: "main.cpp",
};

const PISTON_LANGUAGE: Record<Language, string> = {
  python: "python",
  javascript: "javascript",
  typescript: "typescript",
  go: "go",
  java: "java",
  cpp: "c++",
};

interface PistonExecuteResponse {
  run?: {
    stdout?: string;
    stderr?: string;
    code?: number | null;
    signal?: string | null;
  };
  compile?: {
    stdout?: string;
    stderr?: string;
    code?: number | null;
  };
  message?: string;
}

export interface PistonOptions {
  baseUrl: string;
  versions?: Partial<Record<Language, string>>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createPistonRunner(options: PistonOptions): SandboxRunner {
  const doFetch = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 6000;

  return {
    name: "piston",

    async execute(request: ExecutionRequest): Promise<ExecutionResult> {
      const runTimeout = request.timeoutMs ?? timeoutMs;
      const startedAt = Date.now();

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/api/v2/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            language: PISTON_LANGUAGE[request.language],
            version: options.versions?.[request.language] ?? "*",
            files: [
              { name: FILE_NAMES[request.language], content: request.code },
            ],
            stdin: request.stdin ?? "",
            run_timeout: runTimeout,
            compile_timeout: Math.max(runTimeout, 10_000),
          }),
          signal: AbortSignal.timeout(runTimeout + 10_000),
        });
      } catch (error) {
        throw new SandboxExecutionError(
          `Piston request failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      const raw = await response.text();
      if (!response.ok) {
        throw new SandboxExecutionError(
          `Piston returned HTTP ${response.status}: ${raw.slice(0, 300)}`,
          { status: response.status },
        );
      }

      let payload: PistonExecuteResponse;
      try {
        payload = JSON.parse(raw) as PistonExecuteResponse;
      } catch (error) {
        throw new SandboxExecutionError("Piston returned a non-JSON body", {
          cause: error,
        });
      }

      const compileError = payload.compile?.stderr?.trim() ?? "";
      const stderr = [compileError, payload.run?.stderr ?? ""]
        .filter((part) => part.length > 0)
        .join("\n");

      const exitCode =
        typeof payload.run?.code === "number" ? payload.run.code : null;
      const signal = payload.run?.signal ?? null;
      const timedOut =
        signal === "SIGKILL" ||
        signal === "SIGXCPU" ||
        exitCode === 137 ||
        exitCode === 124;

      return {
        stdout: payload.run?.stdout ?? "",
        stderr: stderr || payload.message || "",
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
      };
    },
  };
}

/** Fetch installed runtimes; useful for health checks and version pinning. */
export async function fetchPistonRuntimes(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PistonRuntime[]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/v2/runtimes`);
  if (!response.ok) {
    throw new SandboxExecutionError(
      `Piston runtimes returned HTTP ${response.status}`,
      { status: response.status },
    );
  }
  return (await response.json()) as PistonRuntime[];
}
