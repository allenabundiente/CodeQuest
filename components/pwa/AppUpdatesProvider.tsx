"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { validateStagedContent } from "@/lib/content/stage";
import { compareVersions } from "@/lib/version";
import type { VersionInfo } from "@/lib/version";
import { Mascot } from "./Mascot";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const CONTENT_STAGED_KEY = "cq_content_staged";
const CONTENT_VERSION_KEY = "cq_content_version";
const CONTENT_PREVIOUS_KEY = "cq_content_previous_version";

interface AppUpdatesValue {
  appVersion: string;
  serverAppVersion: string | null;
  contentVersion: number | null;
  minSupportedVersion: string | null;
  changelog: string[];
  lastChecked: string | null;
  checking: boolean;
  updateReady: boolean;
  updating: boolean;
  required: boolean;
  contentPending: number | null;
  contentToast: string | null;
  serviceWorker: "unsupported" | "registering" | "ready" | "waiting";
  checkNow: () => Promise<void>;
  applyUpdate: () => void;
  dismissUpdate: () => void;
  setLessonActive: (active: boolean) => void;
}

const UpdatesContext = createContext<AppUpdatesValue | null>(null);

export function useAppUpdates(): AppUpdatesValue {
  const value = useContext(UpdatesContext);
  if (!value) {
    throw new Error("useAppUpdates must be used inside AppUpdatesProvider.");
  }
  return value;
}

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private modes; updates still work.
  }
}

export function AppUpdatesProvider({
  appVersion,
  contentUpdatesEnabled,
  pwaUpdatesEnabled,
  children,
}: {
  appVersion: string;
  contentUpdatesEnabled: boolean;
  pwaUpdatesEnabled: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [required, setRequired] = useState(false);
  const [serverUpdate, setServerUpdate] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [swState, setSwState] = useState<
    "unsupported" | "registering" | "ready" | "waiting"
  >("unsupported");
  const [contentPending, setContentPending] = useState<number | null>(null);
  const [contentToast, setContentToast] = useState<string | null>(null);

  const lessonCount = useRef(0);
  const stagedRef = useRef<{ version: number } | null>(null);
  const applyingContent = useRef(false);

  const applyStagedContent = useCallback(() => {
    if (applyingContent.current) return;

    let staged: { version: number; pack?: unknown } | null = null;
    try {
      const raw = readString(CONTENT_STAGED_KEY);
      staged = raw ? (JSON.parse(raw) as { version: number; pack?: unknown }) : null;
    } catch {
      staged = null;
    }
    if (!staged || typeof staged.version !== "number") {
      stagedRef.current = null;
      setContentPending(null);
      return;
    }

    applyingContent.current = true;
    try {
      const applied = Number(readString(CONTENT_VERSION_KEY) ?? "0") || 0;
      if (applied > 0) {
        writeString(CONTENT_PREVIOUS_KEY, String(applied));
      }
      writeString(CONTENT_VERSION_KEY, String(staged.version));
      try {
        localStorage.removeItem(CONTENT_STAGED_KEY);
      } catch {
        // ignore
      }
      stagedRef.current = null;
      setContentPending(null);
      setContentToast(`New lessons applied (content v${staged.version}).`);
      // Re-renders server components with the new pack; no full reload, and
      // the user's editor drafts stay in localStorage.
      router.refresh();
    } finally {
      applyingContent.current = false;
    }
  }, [router]);

  const stageContent = useCallback(
    async (expectedVersion: number) => {
      try {
        const response = await fetch("/api/content/active", {
          cache: "no-store",
        });
        if (!response.ok) return false;
        const payload: unknown = await response.json();
        const result = validateStagedContent(payload, expectedVersion);
        if (!result.ok) {
          console.warn(`[codequest] content update discarded: ${result.error}`);
          return false;
        }

        const staged = {
          version: result.staged.version,
          pack: result.staged.pack,
        };
        // Single atomic write: the pack is never marked applied while partially
        // downloaded.
        writeString(CONTENT_STAGED_KEY, JSON.stringify(staged));
        stagedRef.current = { version: staged.version };
        setContentPending(staged.version);

        if (lessonCount.current === 0) {
          applyStagedContent();
        }
        return true;
      } catch {
        return false;
      }
    },
    [applyStagedContent],
  );

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      if (pwaUpdatesEnabled && "serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistration()
          .then((registration) => registration?.update())
          .catch(() => undefined);
      }

      const response = await fetch("/api/version", { cache: "no-store" });
      if (!response.ok) return;
      const info = (await response.json()) as VersionInfo;
      setVersionInfo(info);

      setLastChecked(new Date().toISOString());

      if (compareVersions(appVersion, info.minSupportedVersion) < 0) {
        setRequired(true);
        return;
      }
      setRequired(false);

      setServerUpdate(compareVersions(info.appVersion, appVersion) > 0);

      if (!contentUpdatesEnabled) return;
      const storedVersion = readString(CONTENT_VERSION_KEY);
      if (storedVersion === null) {
        // First visit: the page was server-rendered with this version.
        writeString(CONTENT_VERSION_KEY, String(info.contentVersion));
        return;
      }
      const applied = Number(storedVersion) || 0;
      if (info.contentVersion !== applied) {
        await stageContent(info.contentVersion);
      }
    } catch {
      // Offline or server restart: keep the currently applied version.
    } finally {
      setChecking(false);
    }
  }, [appVersion, contentUpdatesEnabled, pwaUpdatesEnabled, stageContent]);

  const setLessonActive = useCallback(
    (active: boolean) => {
      lessonCount.current = Math.max(
        0,
        lessonCount.current + (active ? 1 : -1),
      );
      if (
        !active &&
        lessonCount.current === 0 &&
        stagedRef.current &&
        contentUpdatesEnabled
      ) {
        applyStagedContent();
      }
    },
    [applyStagedContent, contentUpdatesEnabled],
  );

  const applyUpdate = useCallback(() => {
    if (updating) return;
    setUpdating(true);
    if (waiting) {
      let reloaded = false;
      const reload = () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener("controllerchange", reload, {
        once: true,
      });
      waiting.postMessage({ type: "SKIP_WAITING" });
      window.setTimeout(reload, 5000);
      return;
    }
    window.location.reload();
  }, [updating, waiting]);

  const dismissUpdate = useCallback(() => {
    setDismissedVersion(versionInfo?.appVersion ?? "service-worker");
  }, [versionInfo]);

  useEffect(() => {
    // Deferred a tick so the launch check does not cascade a render during
    // hydration; the interval and focus/online handlers are callbacks already.
    const initialCheck = window.setTimeout(() => void checkNow(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkNow();
    }, CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkNow();
    };
    const onOnline = () => void checkNow();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [checkNow]);

  useEffect(() => {
    if (!contentToast) return;
    const timer = window.setTimeout(() => setContentToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [contentToast]);

  useEffect(() => {
    if (!pwaUpdatesEnabled) return;
    if (process.env.NEXT_PUBLIC_ENABLE_SW === "false") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        if (cancelled) return;
        setSwState(registration.waiting ? "waiting" : "ready");
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaiting(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              const nextWaiting = registration.waiting ?? installing;
              setWaiting(nextWaiting);
              setSwState("waiting");
            }
          });
        });
      })
      .catch(() => {
        if (!cancelled) setSwState("unsupported");
      });

    return () => {
      cancelled = true;
    };
  }, [pwaUpdatesEnabled]);

  const currentUpdateVersion = versionInfo?.appVersion ?? "service-worker";
  // "Later" is per-version: a newer build brings the banner back.
  const dismissed = dismissedVersion === currentUpdateVersion;
  const updateReady =
    pwaUpdatesEnabled && (Boolean(waiting) || serverUpdate);
  const showBanner = updateReady && !dismissed && !required;
  const changelog = useMemo(
    () => versionInfo?.changelog ?? [],
    [versionInfo],
  );

  const value = useMemo<AppUpdatesValue>(
    () => ({
      appVersion,
      serverAppVersion: versionInfo?.appVersion ?? null,
      contentVersion: versionInfo?.contentVersion ?? null,
      minSupportedVersion: versionInfo?.minSupportedVersion ?? null,
      changelog,
      lastChecked,
      checking,
      updateReady,
      updating,
      required,
      contentPending,
      contentToast,
      serviceWorker: swState,
      checkNow,
      applyUpdate,
      dismissUpdate,
      setLessonActive,
    }),
    [
      appVersion,
      versionInfo,
      changelog,
      lastChecked,
      checking,
      updateReady,
      updating,
      required,
      contentPending,
      contentToast,
      swState,
      checkNow,
      applyUpdate,
      dismissUpdate,
      setLessonActive,
    ],
  );

  return (
    <UpdatesContext.Provider value={value}>
      {children}

      {contentPending !== null && !contentToast ? (
        <div className="content-toast" role="status">
          <span className="content-toast-dot" aria-hidden="true" />
          New lessons are ready — they will apply when this lesson ends.
        </div>
      ) : null}

      {contentToast ? (
        <div className="content-toast content-toast-ok" role="status">
          {contentToast}
        </div>
      ) : null}

      {showBanner ? (
        <aside className="update-banner" aria-live="polite">
          <Mascot size={54} />
          <div className="update-banner-body">
            <div className="update-banner-head">
              <strong>New version ready!</strong>
              {versionInfo?.appVersion ? (
                <span className="badge badge-lang">v{versionInfo.appVersion}</span>
              ) : null}
            </div>
            {changelog.length > 0 ? (
              <ul className="update-changelog">
                {changelog.slice(0, 3).map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : (
              <p className="small muted">
                A fresher build is available. Your saved progress and drafts
                stay put.
              </p>
            )}
            <div className="update-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={applyUpdate}
                disabled={updating}
              >
                {updating ? "Updating…" : "Update now"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={dismissUpdate}
                disabled={updating}
              >
                Later
              </button>
            </div>
          </div>
        </aside>
      ) : null}

      {required ? (
        <div className="update-required" role="alertdialog" aria-modal="true">
          <div className="update-required-card">
            <Mascot size={72} />
            <p className="eyebrow">Update required</p>
            <h1>This version is too old to continue.</h1>
            <p className="muted">
              CodeQuest now requires app version{" "}
              <strong>{versionInfo?.minSupportedVersion ?? "a newer build"}</strong>
              . You are on <strong>{appVersion}</strong>. Reloading picks up the
              newest build and keeps your saved progress.
            </p>
            {changelog.length > 0 ? (
              <ul className="update-changelog">
                {changelog.slice(0, 3).map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              onClick={applyUpdate}
              disabled={updating}
            >
              {updating ? "Reloading…" : "Reload now"}
            </button>
          </div>
        </div>
      ) : null}
    </UpdatesContext.Provider>
  );
}
