import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPasteContext,
  detectLanguage,
} from "../lib/ingest/paste";
import {
  fetchRepoContext,
  parseGitHubUrl,
} from "../lib/ingest/github";
import { isPdfUpload } from "../lib/ingest/pdf";
import { jsonResponse } from "./helpers";

test("parses repository, branch, and subdirectory URLs", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/acme/demo"), {
    owner: "acme",
    repo: "demo",
  });
  assert.deepEqual(
    parseGitHubUrl("https://github.com/acme/demo/tree/dev/src/lib"),
    {
      owner: "acme",
      repo: "demo",
      ref: "dev",
      path: "src/lib",
    },
  );
  assert.deepEqual(parseGitHubUrl("acme/demo.git"), {
    owner: "acme",
    repo: "demo",
  });
});

test("rejects non-GitHub and malformed URLs", () => {
  assert.throws(() => parseGitHubUrl("https://gitlab.com/acme/demo"));
  assert.throws(() => parseGitHubUrl("https://github.com/acme"));
  assert.throws(() => parseGitHubUrl("   "));
});

test("sniffs common languages from pasted code", () => {
  assert.equal(detectLanguage("def total(items):\n    return sum(items)"), "python");
  assert.equal(
    detectLanguage("const total = items.reduce((a, b) => a + b, 0);"),
    "javascript",
  );
  assert.equal(
    detectLanguage("package main\n\nfunc main() {\n  fmt.Println(1)\n}"),
    "go",
  );
});

test("builds a labeled paste transcript and refuses an empty submission", () => {
  const context = buildPasteContext({
    code: "def total(items):\n    return sum(items)",
    errorText: "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
  });

  assert.equal(context.language, "python");
  assert.match(context.material, /Learner's code/);
  assert.match(context.material, /Error output/);
  assert.throws(() => buildPasteContext({}));
});

test("imports bounded source files and skips vendor/test paths", async () => {
  const requested: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/repos/acme/demo")) {
      return jsonResponse({ default_branch: "main", description: "Demo app" });
    }
    if (url.includes("/git/trees/main")) {
      return jsonResponse({
        truncated: false,
        tree: [
          { path: "src/app.py", type: "blob", size: 120 },
          { path: "src/util.ts", type: "blob", size: 90 },
          { path: "node_modules/left-pad/index.js", type: "blob", size: 40 },
          { path: "tests/test_app.py", type: "blob", size: 40 },
          { path: "README.md", type: "blob", size: 50 },
          { path: "src/logo.png", type: "blob", size: 30 },
        ],
      });
    }
    if (url.startsWith("https://raw.githubusercontent.com/acme/demo/main/src/app.py")) {
      return new Response('print("hi")');
    }
    if (url.startsWith("https://raw.githubusercontent.com/acme/demo/main/src/util.ts")) {
      return new Response("export const x = 1;");
    }
    return new Response("missing", { status: 404 });
  }) as typeof fetch;

  const repo = await fetchRepoContext({
    url: "https://github.com/acme/demo",
    fetchImpl,
  });

  assert.deepEqual(
    repo.files.map((file) => file.path),
    ["src/app.py", "src/util.ts"],
  );
  assert.equal(repo.ref, "main");
  assert.match(repo.text, /### src\/app.py/);
  assert.match(repo.text, /print\("hi"\)/);
  assert.ok(requested.some((url) => url.includes("raw.githubusercontent.com")));
});

test("detects PDF uploads by extension or mime type", () => {
  assert.equal(isPdfUpload("lesson.pdf", "application/octet-stream"), true);
  assert.equal(isPdfUpload("lesson", "application/pdf"), true);
  assert.equal(isPdfUpload("notes.txt", "text/plain"), false);
});
