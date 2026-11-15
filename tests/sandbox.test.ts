import assert from "node:assert/strict";
import test from "node:test";
import { createJudge0Runner } from "../lib/sandbox/judge0";
import { createPistonRunner } from "../lib/sandbox/piston";
import { runTestsOnSolution, outputsMatch } from "../lib/sandbox/verify";
import type { SandboxRunner } from "../lib/sandbox";
import { jsonResponse } from "./helpers";

test("Piston payload maps cpp to c++ and names the source file", async () => {
  const captured: { url?: string; body?: Record<string, unknown> } = {};
  const runner = createPistonRunner({
    baseUrl: "http://piston.test",
    versions: { cpp: "10.2.0" },
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(input);
      captured.body = JSON.parse(String(init?.body));
      return jsonResponse({
        language: "c++",
        version: "10.2.0",
        run: { stdout: "4\n", stderr: "", code: 0, signal: null },
      });
    }) as typeof fetch,
  });

  const result = await runner.execute({
    language: "cpp",
    code: "int main() {}",
    stdin: "2",
  });

  assert.equal(captured.url, "http://piston.test/api/v2/execute");
  assert.equal(captured.body?.language, "c++");
  const files = captured.body?.files as Array<{ name: string }>;
  assert.equal(files[0].name, "main.cpp");
  assert.equal(captured.body?.version, "10.2.0");
  assert.equal(result.stdout, "4\n");
  assert.equal(result.exitCode, 0);
});

test("Piston flags SIGKILL and compile errors", async () => {
  const runner = createPistonRunner({
    baseUrl: "http://piston.test",
    fetchImpl: (async () =>
      jsonResponse({
        compile: { stderr: "syntax error", code: 1 },
        run: { stdout: "", stderr: "", code: null, signal: "SIGKILL" },
      })) as typeof fetch,
  });

  const result = await runner.execute({ language: "python", code: "x" });
  assert.equal(result.timedOut, true);
  assert.match(result.stderr, /syntax error/);
});

test("Judge0 posts a submission with the configured language id", async () => {
  const captured: {
    url?: string;
    body?: Record<string, unknown>;
    headers?: Headers;
  } = {};
  const runner = createJudge0Runner({
    baseUrl: "http://judge0.test",
    authToken: "secret-token",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(input);
      captured.body = JSON.parse(String(init?.body));
      captured.headers = new Headers(init?.headers);
      return jsonResponse({
        stdout: "4\n",
        stderr: null,
        compile_output: null,
        status: { id: 3, description: "Accepted" },
      });
    }) as typeof fetch,
  });

  const result = await runner.execute({
    language: "python",
    code: "print(4)",
    stdin: "2",
  });

  assert.match(captured.url ?? "", /\/submissions\?base64_encoded=false&wait=true$/);
  assert.equal(captured.body?.language_id, 71);
  assert.equal(captured.headers?.get("x-auth-token"), "secret-token");
  assert.equal(result.exitCode, 0);
});

test("output comparison tolerates trailing whitespace but not different values", () => {
  assert.equal(outputsMatch("4\n", "4"), true);
  assert.equal(outputsMatch("a\nb\n", "a \nb"), true);
  assert.equal(outputsMatch("4", "5"), false);
  assert.equal(outputsMatch("", "anything"), true);
});

test("verification fails the step when any test mismatches", async () => {
  const runner: SandboxRunner = {
    name: "stub",
    async execute(request) {
      return {
        stdout: request.stdin === "2" ? "4\n" : "0\n",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 1,
      };
    },
  };

  const report = await runTestsOnSolution(runner, {
    language: "python",
    code: "print(4)",
    tests: [
      { input: "2", expected: "4" },
      { input: "3", expected: "6" },
    ],
  });

  assert.equal(report.passed, false);
  assert.equal(report.outcomes.length, 2);
  assert.equal(report.outcomes[0].passed, true);
  assert.equal(report.outcomes[1].passed, false);
});

test("verification surfaces infrastructure failure instead of scoring it as wrong", async () => {
  const runner: SandboxRunner = {
    name: "dead",
    async execute() {
      throw new Error("connection refused");
    },
  };

  await assert.rejects(
    runTestsOnSolution(runner, {
      language: "python",
      code: "print(1)",
      tests: [{ input: "", expected: "1" }],
    }),
    /connection refused/,
  );
});

test("a timed out run is never a pass", async () => {
  const runner: SandboxRunner = {
    name: "slow",
    async execute() {
      return {
        stdout: "4\n",
        stderr: "",
        exitCode: 137,
        timedOut: true,
        durationMs: 6000,
      };
    },
  };

  const report = await runTestsOnSolution(runner, {
    language: "python",
    code: "while True: pass",
    tests: [{ input: "2", expected: "4" }],
  });

  assert.equal(report.passed, false);
  assert.equal(report.outcomes[0].timedOut, true);
});
