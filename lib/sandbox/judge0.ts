import type { Language } from "../types";
import type { ExecutionRequest, ExecutionResult, SandboxRunner } from "./types";
import { SandboxExecutionError } from "./types";

/** Default Judge0 CE language ids (python 3.8, node 12, ts 3.7, go 1.13, java 13, C++17). */
export const JUDGE0_LANGUAGE_IDS: Record<Language, number> = {
  python: 71,
  javascript: 63,
  typescript: 74,
  go: 60,
  java: 62,
  cpp: 54,
};

interface Judge0SubmissionResponse {
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  exit_code?: number | null;
  time?: string | null;
  status?: { id?: number; description?: string };
}

/** Judge0 status ids that mean the code itself misbehaved (not the service). */
const TIMEOUT_STATUS = 5;
const ACCEPTED_STATUS = 3;

export interface Judge0Options {
  baseUrl: string;
  authToken?: string;
  languageIds?: Partial<Record<Language, number>>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createJudge0Runner(options: Judge0Options): SandboxRunner {
  const doFetch = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 6000;

  return {
    name: "judge0",

    async execute(request: ExecutionRequest): Promise<ExecutionResult> {
      const runTimeout = request.timeoutMs ?? timeoutMs;
      const languageId =
        options.languageIds?.[request.language] ??
        JUDGE0_LANGUAGE_IDS[request.language];
      const startedAt = Date.now();

      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (options.authToken) {
        headers["x-auth-token"] = options.authToken;
      }

      let response: Response;
      try {
        response = await doFetch(
          `${baseUrl}/submissions?base64_encoded=false&wait=true`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              source_code: request.code,
              language_id: languageId,
              stdin: request.stdin ?? "",
              cpu_time_limit: Math.max(1, runTimeout / 1000),
              wall_time_limit: Math.max(2, runTimeout / 1000 + 2),
            }),
            signal: AbortSignal.timeout(runTimeout + 15_000),
          },
        );
      } catch (error) {
        throw new SandboxExecutionError(
          `Judge0 request failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      const raw = await response.text();
      if (!response.ok) {
        throw new SandboxExecutionError(
          `Judge0 returned HTTP ${response.status}: ${raw.slice(0, 300)}`,
          { status: response.status },
        );
      }

      let payload: Judge0SubmissionResponse;
      try {
        payload = JSON.parse(raw) as Judge0SubmissionResponse;
      } catch (error) {
        throw new SandboxExecutionError("Judge0 returned a non-JSON body", {
          cause: error,
        });
      }

      const compileOutput = payload.compile_output?.trim() ?? "";
      const stderr = [compileOutput, payload.stderr ?? ""]
        .filter((part) => part.length > 0)
        .join("\n");

      const statusId = payload.status?.id;
      const timedOut = statusId === TIMEOUT_STATUS;
      const exitCode =
        typeof payload.exit_code === "number"
          ? payload.exit_code
          : statusId === ACCEPTED_STATUS
            ? 0
            : null;

      return {
        stdout: payload.stdout ?? "",
        stderr: stderr || payload.message || payload.status?.description || "",
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
      };
    },
  };
}
