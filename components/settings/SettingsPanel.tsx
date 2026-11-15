"use client";

import Link from "next/link";
import type { FeatureFlags } from "@/lib/flags";
import { useAppUpdates } from "@/components/pwa/AppUpdatesProvider";

const SW_LABELS: Record<string, string> = {
  unsupported: "not available in this browser",
  registering: "registering…",
  ready: "active",
  waiting: "new version waiting",
};

export function SettingsPanel({
  flags,
  contentSource,
  contentVersion,
  isDeveloper,
}: {
  flags: FeatureFlags;
  contentSource: "remote" | "bundled";
  contentVersion: number;
  isDeveloper: boolean;
}) {
  const updates = useAppUpdates();

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>App updates</h2>
          <span className="badge badge-lang">v{updates.appVersion}</span>
        </div>
        <div className="settings-rows">
          <div className="settings-row">
            <span>Current app version</span>
            <strong>{updates.appVersion}</strong>
          </div>
          <div className="settings-row">
            <span>Latest version on server</span>
            <strong>{updates.serverAppVersion ?? "—"}</strong>
          </div>
          <div className="settings-row">
            <span>Minimum supported</span>
            <strong>{updates.minSupportedVersion ?? "—"}</strong>
          </div>
          <div className="settings-row">
            <span>Service worker</span>
            <strong>{SW_LABELS[updates.serviceWorker] ?? updates.serviceWorker}</strong>
          </div>
          <div className="settings-row">
            <span>Last checked</span>
            <strong>
              {updates.lastChecked
                ? new Date(updates.lastChecked).toLocaleString()
                : "not checked yet"}
            </strong>
          </div>
        </div>
        <div className="workspace-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void updates.checkNow()}
            disabled={updates.checking}
          >
            {updates.checking ? (
              <>
                <span className="spinner" aria-hidden="true" /> Checking…
              </>
            ) : (
              "Check for updates"
            )}
          </button>
          {updates.updateReady ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={updates.applyUpdate}
              disabled={updates.updating}
            >
              {updates.updating ? "Updating…" : "Apply update now"}
            </button>
          ) : null}
          <span className="small muted">
            Checks run on launch, when you return to the tab, and every 30
            minutes.
          </span>
        </div>
        {updates.required ? (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            This build is below the minimum supported version. Use the
            update-required screen to reload.
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Content updates</h2>
          <span className="badge">
            {contentSource === "remote"
              ? `remote v${contentVersion}`
              : "bundled"}
          </span>
        </div>
        <p className="small muted">
          New content packs download in the background and are swapped in after
          the lesson you are working on ends — no page reload, and a failed
          download never replaces working content.
        </p>
        <div className="settings-rows">
          <div className="settings-row">
            <span>Live content version</span>
            <strong>{contentVersion}</strong>
          </div>
          <div className="settings-row">
            <span>Pending download</span>
            <strong>
              {updates.contentPending !== null
                ? `v${updates.contentPending} staged`
                : "none"}
            </strong>
          </div>
          <div className="settings-row">
            <span>Updates enabled</span>
            <strong>{flags.contentUpdates ? "yes" : "disabled by flag"}</strong>
          </div>
        </div>
        {updates.contentToast ? (
          <div className="alert alert-ok" style={{ marginTop: 12 }}>
            {updates.contentToast}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Feature flags</h2>
          <span className="small muted">
            Set <code>FEATURE_FLAGS</code> as JSON on the server
          </span>
        </div>
        <div className="flag-grid">
          {Object.entries(flags).map(([flag, enabled]) => (
            <div className="flag-row" key={flag}>
              <span className="mono small">{flag}</span>
              <span className={`badge ${enabled ? "badge-ok" : "badge-warn"}`}>
                {enabled ? "on" : "off"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {isDeveloper ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Developer tools</h2>
          </div>
          <p className="small muted">
            Publish content, inspect plugin health, and roll back releases from
            the developer console.
          </p>
          <div className="workspace-actions">
            <Link className="btn btn-ghost btn-sm" href="/admin">
              Open admin console
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
