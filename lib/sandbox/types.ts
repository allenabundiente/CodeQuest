import type { Language } from "../types";

export interface ExecutionRequest {
  language: Language;
  code: string;
  stdin?: string;
  timeoutMs?: number;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface SandboxRunner {
  /** "piston" | "judge0", surfaced in health checks and errors. */
  name: string;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

export class SandboxExecutionError extends Error {
  readonly status?: number;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "SandboxExecutionError";
    this.status = options.status;
  }
}
