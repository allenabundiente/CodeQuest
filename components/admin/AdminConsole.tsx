"use client";

import { useState } from "react";
import { svgToDataUri } from "@/lib/content/svg";
import { contrastRatio } from "@/lib/content/theme";
import type {
  ContentCopy,
  ContentPack,
  ContentTheme,
  FeaturedLesson,
} from "@/lib/content/schema";
import type { AdminState } from "@/lib/content/types";
import type { PluginEventRecord } from "@/lib/plugins/runtime";
import type { PluginStatus } from "@/lib/plugins/types";
import { DIFFICULTIES, LANGUAGES } from "@/lib/types";

type Tab = "content" | "plugins" | "history";

interface AdminPayload {
  state: AdminState;
  plugins: PluginStatus[];
  events: PluginEventRecord[];
}

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; details: string[] };

async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return {
      ok: false,
      message: "Network error — is the dev server still running?",
      details: [],
    };
  }

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string; details?: unknown };
  } | null;

  if (!response.ok) {
    const details = Array.isArray(payload?.error?.details)
      ? payload.error.details.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    return {
      ok: false,
      message: payload?.error?.message ?? `Request failed (${response.status}).`,
      details,
    };
  }

  return { ok: true, data: payload as T };
}

function clonePack(pack: ContentPack): ContentPack {
  return JSON.parse(JSON.stringify(pack)) as ContentPack;
}

const COPY_FIELDS: Array<{
  key: keyof ContentCopy;
  label: string;
  multiline?: boolean;
}> = [
  { key: "brandName", label: "Brand name" },
  { key: "tagline", label: "Tagline" },
  { key: "dashboardEyebrow", label: "Dashboard eyebrow" },
  { key: "dashboardTitle", label: "Dashboard title" },
  { key: "dashboardSubtitle", label: "Dashboard subtitle", multiline: true },
  { key: "emptyStateTitle", label: "Empty state title" },
  { key: "emptyStateBody", label: "Empty state body", multiline: true },
  { key: "loginTitle", label: "Login title" },
  { key: "loginSubtitle", label: "Login subtitle", multiline: true },
  { key: "newLessonTitle", label: "Builder title" },
  { key: "newLessonSubtitle", label: "Builder subtitle", multiline: true },
  { key: "footer", label: "Footer", multiline: true },
];

const THEME_COLORS: Array<{ key: keyof ContentTheme; label: string }> = [
  { key: "bg", label: "Page background" },
  { key: "panel", label: "Panel" },
  { key: "text", label: "Body text" },
  { key: "muted", label: "Muted text" },
  { key: "accent", label: "Accent" },
  { key: "accentInk", label: "Accent ink" },
  { key: "blue", label: "Secondary blue" },
  { key: "border", label: "Border" },
  { key: "danger", label: "Danger" },
  { key: "warn", label: "Warning" },
];

export function AdminConsole({
  initialState,
  initialPlugins,
  initialEvents,
}: {
  initialState: AdminState;
  initialPlugins: PluginStatus[];
  initialEvents: PluginEventRecord[];
}) {
  const [tab, setTab] = useState<Tab>("content");
  const [state, setState] = useState<AdminState>(initialState);
  const [pack, setPack] = useState<ContentPack>(() =>
    clonePack(initialState.baseline),
  );
  const [plugins, setPlugins] = useState<PluginStatus[]>(initialPlugins);
  const [events, setEvents] = useState<PluginEventRecord[]>(initialEvents);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    message: string;
    items?: string[];
  } | null>(null);

  const dirty = JSON.stringify(pack) !== JSON.stringify(state.baseline);
  const bodyContrast = contrastRatio(pack.theme.text, pack.theme.bg);
  const buttonContrast = contrastRatio(pack.theme.accentInk, pack.theme.accent);
  const contrastWarnings = [
    bodyContrast < 4.5
      ? `Body text on background is ${bodyContrast.toFixed(2)}:1 — publish checks require 4.5:1.`
      : null,
    buttonContrast < 4.5
      ? `Button text on accent is ${buttonContrast.toFixed(2)}:1 — publish checks require 4.5:1.`
      : null,
  ].filter((entry): entry is string => Boolean(entry));

  function setCopy(key: keyof ContentCopy, value: string) {
    setPack((current) => ({
      ...current,
      copy: { ...current.copy, [key]: value },
    }));
  }

  function setTheme(key: keyof ContentTheme, value: string) {
    setPack((current) => ({
      ...current,
      theme: { ...current.theme, [key]: value },
    }));
  }

  function setAsset(key: keyof ContentPack["assets"], value: string) {
    setPack((current) => ({
      ...current,
      assets: { ...current.assets, [key]: value },
    }));
  }

  function updateLesson(index: number, patch: Partial<FeaturedLesson>) {
    setPack((current) => ({
      ...current,
      lessons: current.lessons.map((lesson, entry) =>
        entry === index ? { ...lesson, ...patch } : lesson,
      ),
    }));
  }

  function addLesson() {
    setPack((current) => ({
      ...current,
      lessons: [
        ...current.lessons,
        {
          slug: `lesson-${current.lessons.length + 1}`,
          title: "New featured lesson",
          summary: "Describe the exercise this lesson practices.",
          language: "python",
          difficulty: "beginner",
          minutes: 20,
          objectives: ["Practice the core idea"],
          tags: [],
        },
      ],
    }));
  }

  async function refreshAll() {
    const result = await requestJson<AdminPayload>("/api/admin/content");
    if (!result.ok) {
      setNotice({
        kind: "error",
        message: result.message,
        items: result.details,
      });
      return;
    }
    setState(result.data.state);
    setPlugins(result.data.plugins);
    setEvents(result.data.events);
    setPack(clonePack(result.data.state.baseline));
  }

  async function saveDraft() {
    setBusy("save");
    setNotice(null);
    const result = await requestJson<{ draft: { version: number } }>(
      "/api/admin/content",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack, notes: notes || null }),
      },
    );
    setBusy(null);
    if (!result.ok) {
      setNotice({
        kind: "error",
        message: result.message,
        items: result.details,
      });
      return;
    }
    setNotice({
      kind: "ok",
      message: `Draft v${result.data.draft.version} saved.`,
    });
    await refreshAll();
  }

  async function publish() {
    setBusy("publish");
    setNotice(null);
    const result = await requestJson<{
      published: { version: number };
      warnings: string[];
      state: AdminState;
    }>("/api/admin/content/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: notes || null }),
    });
    setBusy(null);
    if (!result.ok) {
      setNotice({
        kind: "error",
        message: result.message,
        items: result.details,
      });
      return;
    }
    const warnings = result.data.warnings ?? [];
    setNotice({
      kind: "ok",
      message: `Published v${result.data.published.version}. The app is now serving it.${
        warnings.length > 0
          ? ` Plugin infrastructure warnings: ${warnings.join(" · ")}`
          : ""
      }`,
    });
    await refreshAll();
  }

  async function rollback(version: number) {
    if (
      !window.confirm(
        `Restore v${version} and publish it as the live content? The current release is archived.`,
      )
    ) {
      return;
    }
    setBusy(`rollback-${version}`);
    setNotice(null);
    const result = await requestJson<{
      published: { version: number };
      state: AdminState;
    }>("/api/admin/content/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    });
    setBusy(null);
    if (!result.ok) {
      setNotice({
        kind: "error",
        message: result.message,
        items: result.details,
      });
      return;
    }
    setNotice({
      kind: "ok",
      message: `Rolled back: v${result.data.published.version} is live.`,
    });
    await refreshAll();
  }

  async function resetPlugin(pluginId: string) {
    setBusy(`plugin-${pluginId}`);
    setNotice(null);
    const result = await requestJson<{
      plugins: PluginStatus[];
      events: PluginEventRecord[];
    }>("/api/admin/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reset", pluginId }),
    });
    setBusy(null);
    if (!result.ok) {
      setNotice({
        kind: "error",
        message: result.message,
        items: result.details,
      });
      return;
    }
    setPlugins(result.data.plugins);
    setEvents(result.data.events);
    setNotice({ kind: "ok", message: `Plugin ${pluginId} reset.` });
  }

  return (
    <div className="stack">
      <section className="lesson-head">
        <p className="eyebrow">Developer console</p>
        <h1 className="lesson-title">Content &amp; plugins</h1>
        <p className="lede">
          Edit the learner-facing pack and publish it without a deploy. If a
          published pack ever becomes invalid, the app automatically serves the
          bundled pack instead.
        </p>
        <div className="lesson-meta">
          <span
            className={
              state.active.source === "remote" ? "badge badge-ok" : "badge badge-warn"
            }
          >
            {state.active.source === "remote"
              ? `live: remote v${state.active.version}`
              : "live: bundled pack"}
          </span>
          <span className="badge">
            draft {state.draft ? `v${state.draft.version}` : "none"}
          </span>
          <span className="badge">{state.history.length} versions</span>
          {dirty ? <span className="badge badge-warn">unsaved edits</span> : null}
        </div>
        {state.active.fallbackReason ? (
          <div className="alert alert-error">
            <strong>Bundled fallback is active.</strong>{" "}
            {state.active.fallbackReason}
          </div>
        ) : null}
      </section>

      <div className="admin-toolbar">
        <div className="tabs" role="tablist" aria-label="Admin sections">
          <button
            type="button"
            className={tab === "content" ? "tab active" : "tab"}
            onClick={() => setTab("content")}
          >
            Content
          </button>
          <button
            type="button"
            className={tab === "plugins" ? "tab active" : "tab"}
            onClick={() => setTab("plugins")}
          >
            Plugins ({plugins.filter((plugin) => plugin.valid && !plugin.disabled).length}/
            {plugins.length})
          </button>
          <button
            type="button"
            className={tab === "history" ? "tab active" : "tab"}
            onClick={() => setTab("history")}
          >
            History &amp; audit
          </button>
        </div>

        <div className="admin-toolbar-actions">
          <input
            className="input admin-note-input"
            placeholder="Version note (optional)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={300}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={saveDraft}
            disabled={busy !== null}
          >
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={publish}
            disabled={busy !== null || !state.draft || dirty}
            title={
              dirty
                ? "Save the draft before publishing"
                : !state.draft
                  ? "Save a draft first"
                  : "Run checks and publish"
            }
          >
            {busy === "publish" ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>

      {dirty && state.draft ? (
        <div className="alert alert-warn">
          You have unsaved edits. Save the draft before publishing, otherwise the
          previous draft is what goes live.
        </div>
      ) : null}

      {notice ? (
        <div className={`alert ${notice.kind === "ok" ? "alert-ok" : "alert-error"}`}>
          <div>{notice.message}</div>
          {notice.items && notice.items.length > 0 ? (
            <ul style={{ marginTop: 8 }}>
              {notice.items.map((item, index) => (
                <li key={`${item}-${index}`} className="small">
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {tab === "content" ? (
        <div className="admin-layout">
          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <h2>Copy</h2>
                <span className="small muted">Learner-facing strings</span>
              </div>
              <div className="form">
                <div className="admin-grid-2">
                  {COPY_FIELDS.map((field) => (
                    <div
                      className={field.multiline ? "field admin-span-2" : "field"}
                      key={field.key}
                    >
                      <label className="label" htmlFor={`copy-${field.key}`}>
                        {field.label}
                      </label>
                      {field.multiline ? (
                        <textarea
                          id={`copy-${field.key}`}
                          className="textarea"
                          rows={3}
                          value={pack.copy[field.key]}
                          onChange={(event) =>
                            setCopy(field.key, event.target.value)
                          }
                        />
                      ) : (
                        <input
                          id={`copy-${field.key}`}
                          className="input"
                          value={pack.copy[field.key]}
                          onChange={(event) =>
                            setCopy(field.key, event.target.value)
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Theme tokens</h2>
                <span className="small muted">Applied to every page</span>
              </div>
              <div className="admin-grid-2">
                {THEME_COLORS.map((token) => (
                  <div className="field" key={token.key}>
                    <label className="label" htmlFor={`theme-${token.key}`}>
                      {token.label}
                    </label>
                    <div className="color-row">
                      <input
                        id={`theme-${token.key}`}
                        type="color"
                        value={pack.theme[token.key]}
                        onChange={(event) =>
                          setTheme(token.key, event.target.value)
                        }
                        aria-label={`${token.label} color`}
                      />
                      <input
                        className="input mono"
                        value={pack.theme[token.key]}
                        onChange={(event) =>
                          setTheme(token.key, event.target.value)
                        }
                        spellCheck={false}
                      />
                    </div>
                  </div>
                ))}
                <div className="field">
                  <label className="label" htmlFor="theme-radius">
                    Corner radius
                  </label>
                  <input
                    id="theme-radius"
                    className="input mono"
                    value={pack.theme.radius}
                    onChange={(event) => setTheme("radius", event.target.value)}
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="admin-contrast">
                <span className="small muted">
                  Body contrast {bodyContrast.toFixed(2)}:1 · button contrast{" "}
                  {buttonContrast.toFixed(2)}:1
                </span>
                {contrastWarnings.length > 0 ? (
                  <ul>
                    {contrastWarnings.map((warning) => (
                      <li key={warning} className="small">
                        {warning}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="badge badge-ok">contrast passes</span>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Assets</h2>
                <span className="small muted">Inline SVG, rendered via data URI</span>
              </div>
              <div className="stack">
                <div className="field">
                  <label className="label" htmlFor="asset-logo">
                    Logo mark
                  </label>
                  <textarea
                    id="asset-logo"
                    className="textarea code admin-svg"
                    value={pack.assets.logoMark}
                    onChange={(event) =>
                      setAsset("logoMark", event.target.value)
                    }
                    spellCheck={false}
                  />
                  <div className="asset-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={svgToDataUri(pack.assets.logoMark)} alt="Logo preview" />
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="asset-empty">
                    Empty-state illustration
                  </label>
                  <textarea
                    id="asset-empty"
                    className="textarea code admin-svg"
                    value={pack.assets.emptyStateArt}
                    onChange={(event) =>
                      setAsset("emptyStateArt", event.target.value)
                    }
                    spellCheck={false}
                  />
                  <div className="asset-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={svgToDataUri(pack.assets.emptyStateArt)}
                      alt="Empty state preview"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Featured lessons</h2>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={addLesson}
                >
                  Add lesson
                </button>
              </div>
              <div className="stack">
                {pack.lessons.map((lesson, index) => (
                  <div className="admin-lesson" key={`${lesson.slug}-${index}`}>
                    <div className="admin-lesson-head">
                      <span className="badge">{index + 1}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setPack((current) => ({
                            ...current,
                            lessons: current.lessons.filter(
                              (_, entry) => entry !== index,
                            ),
                          }))
                        }
                        disabled={pack.lessons.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="admin-grid-2">
                      <div className="field">
                        <label className="label">Title</label>
                        <input
                          className="input"
                          value={lesson.title}
                          onChange={(event) =>
                            updateLesson(index, { title: event.target.value })
                          }
                        />
                      </div>
                      <div className="field">
                        <label className="label">Slug</label>
                        <input
                          className="input mono"
                          value={lesson.slug}
                          onChange={(event) =>
                            updateLesson(index, { slug: event.target.value })
                          }
                        />
                      </div>
                      <div className="field admin-span-2">
                        <label className="label">Summary</label>
                        <textarea
                          className="textarea"
                          rows={2}
                          value={lesson.summary}
                          onChange={(event) =>
                            updateLesson(index, { summary: event.target.value })
                          }
                        />
                      </div>
                      <div className="field">
                        <label className="label">Language</label>
                        <select
                          className="select"
                          value={lesson.language}
                          onChange={(event) =>
                            updateLesson(index, {
                              language: event.target.value as FeaturedLesson["language"],
                            })
                          }
                        >
                          {LANGUAGES.map((language) => (
                            <option key={language} value={language}>
                              {language}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label className="label">Difficulty</label>
                        <select
                          className="select"
                          value={lesson.difficulty}
                          onChange={(event) =>
                            updateLesson(index, {
                              difficulty: event.target.value as FeaturedLesson["difficulty"],
                            })
                          }
                        >
                          {DIFFICULTIES.map((difficulty) => (
                            <option key={difficulty} value={difficulty}>
                              {difficulty}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label className="label">Minutes</label>
                        <input
                          className="input"
                          type="number"
                          min={5}
                          max={240}
                          value={lesson.minutes}
                          onChange={(event) =>
                            updateLesson(index, {
                              minutes: Number(event.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label className="label">Tags (comma separated)</label>
                        <input
                          className="input"
                          value={lesson.tags.join(", ")}
                          onChange={(event) =>
                            updateLesson(index, {
                              tags: event.target.value
                                .split(",")
                                .map((tag) => tag.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </div>
                      <div className="field admin-span-2">
                        <label className="label">Objectives (one per line)</label>
                        <textarea
                          className="textarea"
                          rows={3}
                          value={lesson.objectives.join("\n")}
                          onChange={(event) =>
                            updateLesson(index, {
                              objectives: event.target.value
                                .split("\n")
                                .map((objective) => objective.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="stack admin-preview">
            <section className="panel">
              <div className="panel-head">
                <h2>Live preview</h2>
                <span className="small muted">Updates as you type</span>
              </div>
              <div
                className="preview-shell"
                style={
                  {
                    background: pack.theme.bg,
                    borderColor: pack.theme.border,
                    borderRadius: pack.theme.radius,
                    color: pack.theme.text,
                  } as React.CSSProperties
                }
              >
                <div
                  className="preview-top"
                  style={{ borderColor: pack.theme.border }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={svgToDataUri(pack.assets.logoMark)}
                    alt=""
                    style={{ borderRadius: pack.theme.radius }}
                  />
                  <span style={{ color: pack.theme.text }}>
                    {pack.copy.brandName}
                  </span>
                </div>
                <div
                  className="preview-hero"
                  style={{ background: pack.theme.panel }}
                >
                  <p
                    className="preview-eyebrow"
                    style={{ color: pack.theme.accent }}
                  >
                    {pack.copy.dashboardEyebrow}
                  </p>
                  <h3 style={{ color: pack.theme.text }}>
                    {pack.copy.dashboardTitle}, Ana.
                  </h3>
                  <p style={{ color: pack.theme.muted }}>
                    {pack.copy.dashboardSubtitle}
                  </p>
                  <span
                    className="preview-btn"
                    style={{
                      background: pack.theme.accent,
                      color: pack.theme.accentInk,
                    }}
                  >
                    Build a lesson
                  </span>
                </div>
                {pack.lessons[0] ? (
                  <div
                    className="preview-lesson"
                    style={{
                      borderColor: pack.theme.border,
                      background: pack.theme.panel,
                    }}
                  >
                    <span
                      className="preview-lang"
                      style={{ color: pack.theme.blue }}
                    >
                      {pack.lessons[0].language} · {pack.lessons[0].difficulty}
                    </span>
                    <h4 style={{ color: pack.theme.text }}>
                      {pack.lessons[0].title}
                    </h4>
                    <p style={{ color: pack.theme.muted }}>
                      {pack.lessons[0].summary}
                    </p>
                  </div>
                ) : null}
                <p
                  className="preview-footer"
                  style={{ color: pack.theme.muted }}
                >
                  {pack.copy.footer}
                </p>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Release state</h2>
              </div>
              <div className="stack">
                <div className="meter-head">
                  <span>Editing baseline</span>
                  <span>{state.baselineSource}</span>
                </div>
                <div className="meter-head">
                  <span>Saved draft</span>
                  <span>
                    {state.draft ? `v${state.draft.version}` : "none — save to start"}
                  </span>
                </div>
                <div className="meter-head">
                  <span>Published</span>
                  <span>
                    {state.published ? `v${state.published.version}` : "bundled only"}
                  </span>
                </div>
                <p className="small muted">
                  Publish runs the plugin checks first; a failing check blocks
                  the release and is written to the audit log.
                </p>
              </div>
            </section>
          </aside>
        </div>
      ) : null}

      {tab === "plugins" ? (
        <div className="stack">
          {plugins.map((plugin) => (
            <section className="panel plugin-card" key={plugin.id}>
              <div className="panel-head">
                <div>
                  <h2>{plugin.name}</h2>
                  <span className="small muted mono">
                    {plugin.id}@{plugin.version}
                  </span>
                </div>
                <div className="badges">
                  <span
                    className={`badge ${plugin.valid ? "badge-ok" : "badge-warn"}`}
                  >
                    {plugin.valid ? "manifest valid" : "invalid manifest"}
                  </span>
                  <span
                    className={`badge ${plugin.disabled ? "badge-warn" : ""}`}
                  >
                    {plugin.disabled ? "isolated" : plugin.enabled ? "enabled" : "disabled"}
                  </span>
                  <span className="badge">failures: {plugin.failures}</span>
                </div>
              </div>
              <div className="badges">
                {plugin.hooks.map((hook) => (
                  <span className="badge badge-lang" key={hook}>
                    {hook}
                  </span>
                ))}
              </div>
              {plugin.lastError ? (
                <div className="alert alert-error" style={{ marginTop: 12 }}>
                  {plugin.lastError}
                </div>
              ) : null}
              <div className="workspace-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => resetPlugin(plugin.id)}
                  disabled={busy !== null || !plugin.valid}
                >
                  {busy === `plugin-${plugin.id}` ? "Resetting…" : "Reset isolation"}
                </button>
                <span className="small muted">
                  Disabled automatically after three consecutive hook failures.
                </span>
              </div>
            </section>
          ))}

          <section className="panel">
            <div className="panel-head">
              <h2>Recent hook events</h2>
              <span className="small muted">Newest first · max 20</span>
            </div>
            {events.length === 0 ? (
              <p className="muted small">No hook runs recorded yet.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Plugin</th>
                      <th>Hook</th>
                      <th>Result</th>
                      <th>Message</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td className="mono">{event.pluginId}</td>
                        <td className="mono">{event.hook}</td>
                        <td>
                          <span
                            className={`badge ${event.ok ? "badge-ok" : "badge-warn"}`}
                          >
                            {event.ok ? "ok" : "failed"}
                          </span>
                        </td>
                        <td className="small">
                          {event.message ?? "—"}
                        </td>
                        <td className="small muted">
                          {new Date(event.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Version history</h2>
              <span className="small muted">
                Rollback republishes an old pack as a new version
              </span>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.history.map((version) => (
                    <tr key={version.id}>
                      <td className="mono">v{version.version}</td>
                      <td>
                        <span
                          className={`badge ${
                            version.status === "published"
                              ? "badge-ok"
                              : version.status === "draft"
                                ? "badge-warn"
                                : ""
                          }`}
                        >
                          {version.status}
                        </span>
                      </td>
                      <td className="small">{version.notes ?? "—"}</td>
                      <td className="small muted">
                        {new Date(version.createdAt).toLocaleString()}
                      </td>
                      <td>
                        {version.status !== "draft" &&
                        version.version !== state.published?.version ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => rollback(version.version)}
                            disabled={busy !== null}
                          >
                            {busy === `rollback-${version.version}`
                              ? "Restoring…"
                              : "Rollback"}
                          </button>
                        ) : (
                          <span className="small muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Audit log</h2>
              <span className="small muted">Latest 25 developer actions</span>
            </div>
            {state.audit.length === 0 ? (
              <p className="muted small">No developer actions recorded yet.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Details</th>
                      <th>Actor</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.audit.map((entry) => (
                      <tr key={entry.id}>
                        <td className="mono">{entry.action}</td>
                        <td className="small">{entry.target ?? "—"}</td>
                        <td className="small">{entry.details ?? "—"}</td>
                        <td className="small muted">
                          {entry.actorEmail ?? "cli"}
                        </td>
                        <td className="small muted">
                          {new Date(entry.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
