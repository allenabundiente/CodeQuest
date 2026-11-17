"use client";

import Link from "next/link";
import { GuidedEditor } from "@/components/editor/GuidedEditor";
import { SolutionEditor } from "@/components/editor/SolutionEditor";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useAppUpdates } from "@/components/pwa/AppUpdatesProvider";
import type {
  LessonView,
  TranslationLocale,
  TranslationPayload,
  VerificationReport,
} from "@/lib/types";

const MAX_HINT_LEVEL = 3;

const LOCALE_LABELS: Record<TranslationLocale, string> = {
  tl: "Tagalog",
  ceb: "Bisaya",
};

interface HintRow {
  stepIndex: number;
  level: number;
  text: string;
}

const DRAFT_EVENT = "cq-draft-change";

function readRawDraft(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseDraft(raw: string | null): Record<number, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const draft: Record<number, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const index = Number(key);
      if (Number.isInteger(index) && typeof value === "string") {
        draft[index] = value;
      }
    }
    return draft;
  } catch {
    return {};
  }
}

function writeDraft(key: string, value: Record<number, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(DRAFT_EVENT));
  } catch {
    return;
  }
}

function subscribeDrafts(callback: () => void): () => void {
  window.addEventListener(DRAFT_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(DRAFT_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function LessonWorkspace({
  lesson,
  initialHints,
}: {
  lesson: LessonView;
  initialHints: HintRow[];
}) {
  const { setLessonActive } = useAppUpdates();
  const draftKey = `cq_draft_${lesson.id}`;

  const [stepIndex, setStepIndex] = useState(0);
  const [editorMode, setEditorMode] = useState<"guided" | "code">("guided");
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [reports, setReports] = useState<Record<number, VerificationReport | null>>({});
  const [pluginMessages, setPluginMessages] = useState<Record<number, string[]>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [hints, setHints] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialHints.map((hint) => [`${hint.stepIndex}:${hint.level}`, hint.text])),
  );
  const [hintBusy, setHintBusy] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);

  const [locale, setLocale] = useState<"en" | TranslationLocale>("en");
  const [translations, setTranslations] = useState<
    Partial<Record<TranslationLocale, TranslationPayload>>
  >({});
  const [translateBusy, setTranslateBusy] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const step = lesson.steps[stepIndex];
  const report = reports[stepIndex] ?? null;
  const translation = locale === "en" ? null : translations[locale];
  const translatedStep = translation?.steps[stepIndex];
  const draftRaw = useSyncExternalStore(
    subscribeDrafts,
    useCallback(() => readRawDraft(draftKey), [draftKey]),
    () => null,
  );
  const draft = useMemo(() => parseDraft(draftRaw), [draftRaw]);
  const code = edits[stepIndex] ?? draft[stepIndex] ?? step.starterCode;
  const hintKey = (level: number) => `${stepIndex}:${level}`;
  const unlocked = Math.max(
    0,
    ...Object.keys(hints)
      .filter((key) => key.startsWith(`${stepIndex}:`))
      .map((key) => Number(key.split(":")[1] ?? 0)),
  );
  const nextLevel = Math.min(MAX_HINT_LEVEL, unlocked + 1);
  const allCleared = lesson.steps.every((_, index) => reports[index]?.passed);

  // Staged content waits for the active lesson to end (leaving this page).
  useEffect(() => {
    setLessonActive(true);
    return () => setLessonActive(false);
  }, [setLessonActive]);

  function updateCode(next: string) {
    const nextEdits = { ...edits, [stepIndex]: next };
    setEdits(nextEdits);
    // Drafts are the durable copy: an update reload restores them without a
    // server round trip and without blocking the reload.
    writeDraft(draftKey, { ...draft, ...nextEdits });
  }

  async function runTests() {
    if (running) return;
    if (!code.trim()) {
      setRunError("Write some code first.");
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      const response = await fetch(`/api/lessons/${lesson.id}/attempt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepIndex, code }),
      });
      const data = (await response.json()) as {
        report?: VerificationReport;
        pluginMessages?: string[];
        error?: { message?: string };
      };
      if (!response.ok || !data.report) {
        setRunError(data.error?.message ?? "The sandbox run failed.");
        return;
      }
      setReports((previous) => ({ ...previous, [stepIndex]: data.report ?? null }));
      setPluginMessages((previous) => ({
        ...previous,
        [stepIndex]: data.pluginMessages ?? [],
      }));
    } catch {
      setRunError("Network error while running tests.");
    } finally {
      setRunning(false);
    }
  }

  async function unlockHint(level: number) {
    setHintBusy(true);
    setHintError(null);
    try {
      const response = await fetch(`/api/lessons/${lesson.id}/hints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepIndex, level }),
      });
      const data = (await response.json()) as {
        hint?: { level: number; text: string };
        error?: { message?: string };
      };
      if (!response.ok || !data.hint) {
        setHintError(data.error?.message ?? "Could not unlock that hint.");
        return;
      }
      const hint = data.hint;
      setHints((previous) => ({ ...previous, [`${stepIndex}:${hint.level}`]: hint.text }));
    } catch {
      setHintError("Network error while fetching the hint.");
    } finally {
      setHintBusy(false);
    }
  }

  async function showTranslation(target: TranslationLocale) {
    setTranslateError(null);
    if (translations[target]) {
      setLocale(target);
      return;
    }
    setTranslateBusy(true);
    try {
      const response = await fetch(`/api/lessons/${lesson.id}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: target }),
      });
      const data = (await response.json()) as {
        translation?: TranslationPayload;
        error?: { message?: string };
      };
      if (!response.ok || !data.translation) {
        setTranslateError(data.error?.message ?? "Could not translate this lesson.");
        return;
      }
      setTranslations((previous) => ({ ...previous, [target]: data.translation }));
      setLocale(target);
    } catch {
      setTranslateError("Network error while translating.");
    } finally {
      setTranslateBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], .cm-editor",
        )
      ) {
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index < lesson.steps.length) setStepIndex(index);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lesson.steps.length]);

  return (
    <div className="stack">
      <section className="lesson-head">
        <div className="lesson-toolbar">
          <p className="eyebrow">Lesson</p>
          <div className="tabs" aria-label="Lesson language">
            <button
              type="button"
              className={locale === "en" ? "tab active" : "tab"}
              onClick={() => setLocale("en")}
            >
              Original
            </button>
            {(Object.keys(LOCALE_LABELS) as TranslationLocale[]).map((entry) => (
              <button
                key={entry}
                type="button"
                className={locale === entry ? "tab active" : "tab"}
                onClick={() => showTranslation(entry)}
                disabled={translateBusy}
              >
                {translateBusy && locale !== entry ? `${LOCALE_LABELS[entry]}…` : LOCALE_LABELS[entry]}
              </button>
            ))}
          </div>
        </div>

        <h1 className="lesson-title">{translation?.title ?? lesson.title}</h1>
        <p className="lede">{translation?.summary ?? lesson.summary}</p>

        <div className="lesson-meta">
          <span className="badge">{lesson.difficulty}</span>
          <span className="badge badge-lang">{lesson.language}</span>
          <span className="badge">{lesson.estimatedMinutes} min</span>
          <span className="badge">{lesson.source}</span>
          {lesson.verified ? (
            <span className="badge badge-ok">solutions sandbox-verified</span>
          ) : null}
          {lesson.discardedSteps > 0 ? (
            <span className="badge badge-warn">
              {lesson.discardedSteps} failing step
              {lesson.discardedSteps === 1 ? "" : "s"} discarded
            </span>
          ) : null}
        </div>

        {lesson.learningObjectives.length > 0 ? (
          <div className="objectives">
            <span className="label">You will practice</span>
            <ul>
              {lesson.learningObjectives.map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {translateError ? (
          <div className="alert alert-error">{translateError}</div>
        ) : null}
      </section>

      {allCleared ? (
        <div className="complete">
          <div>
            <h3>Quest complete — every step passes.</h3>
            <p className="small muted">
              Your streak counted this session. Build the next lesson from
              something you are actually stuck on.
            </p>
          </div>
          <Link className="btn btn-primary btn-sm" href="/new">
            New lesson
          </Link>
        </div>
      ) : null}

      <div className="step-tabs" role="tablist" aria-label="Lesson steps">
        {lesson.steps.map((entry, index) => (
          <button
            key={entry.title}
            type="button"
            role="tab"
            aria-selected={index === stepIndex}
            className={index === stepIndex ? "step-tab active" : "step-tab"}
            onClick={() => setStepIndex(index)}
          >
            <span
              className={reports[index]?.passed ? "dot done" : "dot"}
              aria-hidden="true"
            />
            {index + 1}. {entry.title}
          </button>
        ))}
      </div>

      <div className="challenge-shell">
        <div className="challenge-layout">
        <section className="panel brief challenge-panel">
          <div>
            <span className="label">Step {stepIndex + 1} of {lesson.steps.length}</span>
            <h3>{translatedStep?.title ?? step.title}</h3>
          </div>
          <p className="brief-goal">{translatedStep?.goal ?? step.goal}</p>
          <p className="brief-explanation">
            {translatedStep?.explanation ?? step.explanation}
          </p>

          <div>
            <span className="label">Tests your code must pass</span>
            <div className="test-list" style={{ marginTop: 8 }}>
              {step.tests.map((test, index) => (
                <div className="test-case" key={`${test.name ?? "test"}-${index}`}>
                  <span className="test-case-title">
                    {test.name ?? `Test ${index + 1}`}
                  </span>
                  <div>
                    <span className="io-label">stdin</span>
                    <pre className="pre">{test.input.trim() || "(no input)"}</pre>
                  </div>
                  <div>
                    <span className="io-label">expected stdout</span>
                    <pre className="pre">{test.expected.trim() || "(no output)"}</pre>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="hint-ladder">
            <div className="hint-ladder-head">
              <span className="label">Hint ladder</span>
              <span className="small muted">
                {unlocked} of {MAX_HINT_LEVEL} unlocked
              </span>
            </div>

            {Array.from({ length: MAX_HINT_LEVEL }, (_, index) => index + 1).map(
              (level) => {
                // A translation must never reveal a rung the learner has not
                // unlocked in the original lesson.
                const unlockedText = hints[hintKey(level)];
                const text = unlockedText
                  ? (translatedStep?.hints[level - 1] ?? unlockedText)
                  : undefined;
                if (text) {
                  return (
                    <div className="hint" key={level}>
                      <span className="hint-level">Rung {level}</span>
                      <span>{text}</span>
                    </div>
                  );
                }
                const locked = level !== nextLevel;
                return (
                  <div className="hint-locked" key={level}>
                    <span>
                      Rung {level} ·{" "}
                      {locked ? "unlock the earlier rung first" : "ready when you are"}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => unlockHint(level)}
                      disabled={locked || hintBusy}
                    >
                      {hintBusy && !locked ? "Unlocking…" : "Unlock"}
                    </button>
                  </div>
                );
              },
            )}

            {hintError ? <div className="alert alert-error">{hintError}</div> : null}
          </div>
        </section>

        <section
          className="panel challenge-panel challenge-editor"
          aria-labelledby="workspace-title"
        >
          <div className="panel-head">
            <h2 id="workspace-title">Workspace</h2>
            <div className="editor-tools">
              <div className="segmented editor-mode" role="group" aria-label="Editor mode">
                <button
                  type="button"
                  className={editorMode === "guided" ? "tab active" : "tab"}
                  aria-pressed={editorMode === "guided"}
                  onClick={() => setEditorMode("guided")}
                >
                  Blocks
                </button>
                <button
                  type="button"
                  className={editorMode === "code" ? "tab active" : "tab"}
                  aria-pressed={editorMode === "code"}
                  onClick={() => setEditorMode("code")}
                >
                  Full code
                </button>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => updateCode(step.starterCode)}
                disabled={running}
              >
                Reset
              </button>
            </div>
          </div>

          <div
            className={
              editorMode === "guided"
                ? "editor-pane guided-pane is-active"
                : "editor-pane guided-pane"
            }
          >
            <GuidedEditor
              key={stepIndex}
              code={code}
              onChange={updateCode}
              onRun={runTests}
              readOnly={running}
              onUseCode={() => setEditorMode("code")}
            />
          </div>

          <div
            className={
              editorMode === "code"
                ? "editor-pane code-pane is-active"
                : "editor-pane code-pane"
            }
          >
            <SolutionEditor
              value={code}
              language={lesson.language}
              onChange={updateCode}
              onRun={runTests}
              readOnly={running}
            />
          </div>

          <p className="small muted editor-note">
            <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> runs tests. Blocks
            mode fills the generated TODO lines; Full code is there for anything
            else.
          </p>

          <div className="workspace-actions challenge-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={runTests}
              disabled={running || !code.trim()}
              aria-keyshortcuts="Control+Enter Meta+Enter"
            >
              {running ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Running tests…
                </>
              ) : (
                "Run tests"
              )}
            </button>
            {report?.passed ? (
              <span className="badge badge-ok">all tests passed</span>
            ) : null}
            {report && !report.passed ? (
              <span className="badge badge-warn">not passing yet</span>
            ) : null}
            <div className="step-jump">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}
                disabled={stepIndex === 0 || running}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setStepIndex(Math.min(lesson.steps.length - 1, stepIndex + 1))
                }
                disabled={stepIndex >= lesson.steps.length - 1 || running}
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section
          className="panel challenge-panel challenge-output"
          aria-labelledby="output-title"
          aria-live="polite"
        >
          <div className="panel-head">
            <h2 id="output-title">Output</h2>
            {report ? (
              <span
                className={report.passed ? "badge badge-ok" : "badge badge-warn"}
              >
                {report.passed ? "passed" : "needs work"}
              </span>
            ) : null}
          </div>

          {runError ? (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              {runError}
            </div>
          ) : null}

          {(pluginMessages[stepIndex] ?? []).length > 0 ? (
            <div className="alert alert-ok" style={{ marginBottom: 12 }}>
              <strong className="small">Plugin tips</strong>
              <ul style={{ marginTop: 6 }}>
                {(pluginMessages[stepIndex] ?? []).map((message) => (
                  <li className="small" key={message}>
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report ? (
            <div className="results">
              {report.outcomes.map((outcome, index) => (
                <div
                  className={outcome.passed ? "result ok" : "result bad"}
                  key={`${outcome.name}-${index}`}
                >
                  <div className="result-head">
                    <span>{outcome.name}</span>
                    <span className="result-status">
                      {outcome.passed ? "passed" : outcome.timedOut ? "timed out" : "failed"}
                    </span>
                  </div>
                  {!outcome.passed ? (
                    <>
                      <div>
                        <span className="io-label">expected</span>
                        <pre className="pre">{outcome.expected.trim() || "(no output)"}</pre>
                      </div>
                      <div>
                        <span className="io-label">your output</span>
                        <pre className="pre">{outcome.actual.trim() || "(no output)"}</pre>
                      </div>
                      {outcome.stderr ? (
                        <div>
                          <span className="io-label">stderr</span>
                          <pre className="pre">{outcome.stderr.slice(0, 1200)}</pre>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="output-empty">
              <p className="small muted">
                Run tests to see each case&apos;s expected and actual output.
              </p>
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}
