"use client";

import { useCallback, useEffect, useState } from "react";

const MAX_DELAY_MS = 30_000;

/**
 * Render free instances sleep. If the first story or an API call reaches a
 * cold instance, show a friendly wake-up screen and retry with backoff instead
 * of leaving the learner on a blank error page.
 */
export function ColdStartGate() {
  const [online, setOnline] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(9_000),
      });
      setOnline(response.ok);
      if (!response.ok) setAttempt((value) => value + 1);
    } catch {
      setOnline(false);
      setAttempt((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void probe(), 0);
    return () => window.clearTimeout(timer);
  }, [probe]);

  useEffect(() => {
    if (online) return;
    const delay = Math.min(
      MAX_DELAY_MS,
      2_000 * 2 ** Math.min(attempt, 4),
    );
    const timer = window.setTimeout(() => void probe(), delay);
    return () => window.clearTimeout(timer);
  }, [online, attempt, probe]);

  if (online) return null;

  const nextRetry = Math.round(
    Math.min(MAX_DELAY_MS, 2_000 * 2 ** Math.min(attempt, 4)) / 1000,
  );

  return (
    <div className="wake-overlay" role="alertdialog" aria-modal="true">
      <div className="wake-card">
        <span className="wake-pulse" aria-hidden="true" />
        <p className="eyebrow">Free-tier server</p>
        <h2>Waking CodeQuest up…</h2>
        <p className="muted small">
          Render sleeps idle instances. The first request can take up to a
          minute. We retry automatically with backoff; your drafts are safe.
        </p>
        <div className="wake-progress" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="small muted">
          Attempt {Math.max(1, attempt)} · next retry in about {nextRetry}s
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void probe()}
          disabled={busy}
        >
          {busy ? "Checking…" : "Retry now"}
        </button>
      </div>
    </div>
  );
}
