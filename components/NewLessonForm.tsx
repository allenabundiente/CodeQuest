"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DIFFICULTIES, LANGUAGES } from "@/lib/types";
import type { Difficulty, Language } from "@/lib/types";

type Mode = "goal" | "code" | "pdf" | "github";

const MODES: Array<{ id: Mode; label: string; blurb: string }> = [
  {
    id: "goal",
    label: "Goal",
    blurb: "Describe what you want to build and CodeQuest designs the path.",
  },
  {
    id: "code",
    label: "Code + error",
    blurb: "Paste what you wrote and the error you got. The lesson repairs the misconception.",
  },
  {
    id: "pdf",
    label: "PDF",
    blurb: "Upload a handout or module. Text-based PDFs only.",
  },
  {
    id: "github",
    label: "GitHub repo",
    blurb: "Import a public repo and learn the patterns it actually uses.",
  },
];

export function NewLessonForm({
  defaultSteps,
  aiConfigured,
  providerChain,
  githubImportEnabled,
}: {
  defaultSteps: number;
  aiConfigured: boolean;
  providerChain: string[];
  githubImportEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("goal");
  const [goal, setGoal] = useState(() => searchParams.get("goal") ?? "");
  const [code, setCode] = useState("");
  const [errorText, setErrorText] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<"" | Language>("");
  const [difficulty, setDifficulty] = useState<"" | Difficulty>("");
  const [stepCount, setStepCount] = useState(defaultSteps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Array<{ path: string; message: string }> | null>(null);

  const modes = MODES.filter(
    (entry) => entry.id !== "github" || githubImportEnabled,
  );
  const activeMode = modes.find((entry) => entry.id === mode) ?? modes[0];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!aiConfigured) return;

    setBusy(true);
    setError(null);
    setDetails(null);

    try {
      let response: Response;

      if (mode === "pdf") {
        if (!file) {
          setError("Choose a PDF first.");
          setBusy(false);
          return;
        }
        const form = new FormData();
        form.set("pdf", file);
        if (goal.trim()) form.set("goal", goal.trim());
        if (language) form.set("language", language);
        if (difficulty) form.set("difficulty", difficulty);
        form.set("stepCount", String(stepCount));
        response = await fetch("/api/lessons", { method: "POST", body: form });
      } else {
        const payload: Record<string, unknown> = {
          source: mode,
          stepCount,
        };
        if (goal.trim()) payload.goal = goal.trim();
        if (language) payload.language = language;
        if (difficulty) payload.difficulty = difficulty;
        if (mode === "code") {
          payload.code = code;
          payload.errorText = errorText;
        }
        if (mode === "github") payload.url = repoUrl.trim();

        response = await fetch("/api/lessons", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = (await response.json()) as {
        lesson?: { id: string };
        error?: {
          message?: string;
          details?: unknown;
        };
      };

      if (!response.ok || !data.lesson) {
        setError(data.error?.message ?? "Could not build the lesson.");
        setDetails(
          Array.isArray(data.error?.details)
            ? (data.error.details as Array<{ path: string; message: string }>)
            : null,
        );
        setBusy(false);
        return;
      }

      router.push(`/lessons/${data.lesson.id}`);
    } catch {
      setError("Network error while building the lesson.");
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="tabs" role="tablist" aria-label="Lesson source">
        {modes.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={mode === entry.id}
            className={mode === entry.id ? "tab active" : "tab"}
            onClick={() => setMode(entry.id)}
            disabled={busy}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <p className="small muted" style={{ margin: "12px 0 18px" }}>
        {activeMode.blurb}
      </p>

      {!aiConfigured ? (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          <strong>No providers configured.</strong> Add{" "}
          <code>OPENROUTER_API_KEY</code> and/or <code>GROQ_API_KEY</code> to
          your <code>.env</code> file, then restart the dev server.
        </div>
      ) : null}

      <form className="form" onSubmit={submit}>
        {mode === "pdf" ? (
          <div className="field">
            <label className="label" htmlFor="pdf">
              PDF handout
            </label>
            <input
              id="pdf"
              className="input"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              disabled={busy}
            />
            <p className="small muted">
              Up to 10 MB, with selectable text. Scans cannot be read.
            </p>
          </div>
        ) : null}

        {mode === "github" ? (
          <div className="field">
            <label className="label" htmlFor="repo">
              Repository URL
            </label>
            <input
              id="repo"
              className="input"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              disabled={busy}
              required
            />
            <p className="small muted">
              Public repos only. The importer reads a bounded set of source files.
            </p>
          </div>
        ) : null}

        {mode === "code" ? (
          <>
            <div className="field">
              <label className="label" htmlFor="code">
                Your code
              </label>
              <textarea
                id="code"
                className="textarea code"
                placeholder={"def total(items):\n    return sum(items)"}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                spellCheck={false}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="errorText">
                Error or stack trace
              </label>
              <textarea
                id="errorText"
                className="textarea"
                placeholder="TypeError: unsupported operand type(s) for +: 'int' and 'str'"
                value={errorText}
                onChange={(event) => setErrorText(event.target.value)}
                spellCheck={false}
                disabled={busy}
              />
            </div>
          </>
        ) : null}

        <div className="field">
          <label className="label" htmlFor="goal">
            {mode === "goal"
              ? "What do you want to learn or build?"
              : "Extra context (optional)"}
          </label>
          <textarea
            id="goal"
            className="textarea"
            placeholder={
              mode === "goal"
                ? "I want to understand how to group a list of records by a key and compute totals for each group."
                : "Focus the lesson on the part I keep getting wrong."
            }
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            disabled={busy}
            required={mode === "goal"}
          />
        </div>

        <div className="row-3">
          <div className="field">
            <label className="label" htmlFor="language">
              Language
            </label>
            <select
              id="language"
              className="select"
              value={language}
              onChange={(event) => setLanguage(event.target.value as "" | Language)}
              disabled={busy}
            >
              <option value="">Auto</option>
              {LANGUAGES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="difficulty">
              Difficulty
            </label>
            <select
              id="difficulty"
              className="select"
              value={difficulty}
              onChange={(event) =>
                setDifficulty(event.target.value as "" | Difficulty)
              }
              disabled={busy}
            >
              <option value="">Auto</option>
              {DIFFICULTIES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="steps">
              Steps
            </label>
            <select
              id="steps"
              className="select"
              value={stepCount}
              onChange={(event) => setStepCount(Number(event.target.value))}
              disabled={busy}
            >
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <div className="alert alert-error">
            <div>{error}</div>
            {details && details.length > 0 ? (
              <ul style={{ marginTop: 8 }}>
                {details.slice(0, 4).map((detail, index) => (
                  <li key={`${detail.path}-${index}`} className="small">
                    {detail.path}: {detail.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {busy ? (
          <div className="alert alert-warn">
            <div className="status-line" style={{ marginBottom: 6 }}>
              <span className="spinner" aria-hidden="true" />
              <strong>
                {mode === "pdf"
                  ? "Extracting your PDF, writing steps, then testing every solution…"
                  : "Writing steps, then testing every solution in the sandbox…"}
              </strong>
            </div>
            <span className="small">
              This usually takes 30–90 seconds. Solutions that fail their tests
              are discarded, so only verified steps are saved.
            </span>
          </div>
        ) : null}

        <div className="workspace-actions">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !aiConfigured}
          >
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" /> Building…
              </>
            ) : (
              "Build lesson"
            )}
          </button>
          <span className="small muted">
            {providerChain.length > 0
              ? `Fallback chain: ${providerChain.join(" → ")}`
              : "Add a provider key to enable generation."}
          </span>
        </div>
      </form>
    </div>
  );
}
