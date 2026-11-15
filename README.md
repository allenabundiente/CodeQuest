# CodeQuest

Turn your own material into runnable programming lessons. CodeQuest writes a
short, multi-step lesson from a goal, pasted code and error, a PDF handout, or a
GitHub repository — then **executes every reference solution in a sandbox and
throws away the ones that fail their own tests** before saving anything.

Built with Next.js (App Router), TypeScript, Node's built-in SQLite, and Zod.

## What is in the box

| Area | Implementation |
| --- | --- |
| Provider layer | `lib/providers` — one OpenAI-compatible adapter for **Gemini** and **DeepSeek** (via OpenRouter) and **Groq**, automatic fallback, retry-once schema repair, JSON schema validation with Zod, content-addressed response cache |
| Quotas | `lib/quota.ts` — rolling 24h per-user call and token budget, recorded per provider call |
| Custom lessons | `lib/ingest` + `lib/lessons.ts` — goals, pasted code/errors, text-based PDFs (10 MB cap), public GitHub repos |
| Sandbox verification | `lib/sandbox` — self-hosted **Piston** or **Judge0 CE** clients, test harness with output normalization, failing solutions discarded |
| Hint ladder | `lib/hints.ts` — three rungs, unlocked sequentially, seeded from the lesson and generated on demand, stored per step |
| GitHub import | `lib/ingest/github.ts` — bounded tree scan, skips vendor/test/minified files, reads at most 12 source files |
| Translation | `lib/translate.ts` — Tagalog (`tl`) and Bisaya/Cebuano (`ceb`), prose only (never code), cached per locale |
| Streak emails | `lib/streaks.ts` + `lib/email.ts` — daily Resend job, one email per learner per day, restart-safe |
| UI | Dashboard with streak/quota, lesson builder, lesson workspace with code editor, test results, hint ladder, translation toggle |
| Plugin system | `plugins/` + `lib/plugins` — validated `manifest.json`, three hook points, per-plugin timeout and failure isolation, SQLite event log, two sample plugins |
| Content admin | `/admin` — developer role, draft/publish, version history, rollback, audit log, live preview of copy/theme/assets/lessons, bundled-pack fallback |
| Content CLI | `npm run content:export` / `content:import` for pack portability |
| In-app updates | Prompt-mode service worker (`public/sw.js`), mascot update banner, Settings manual check, staged content swaps, required-update gate |
| Operations | `/api/health` + `/api/ready`, JSON feature flags, Sentry error reporting, `render.yaml`, GitHub Actions CI/CD |

## Quick start

```bash
npm install
cp .env.example .env          # add provider keys
docker compose up -d          # self-hosted Piston on :2000
npm run dev                   # http://localhost:3000
```

Open the app, pick any email on the sign-in screen (local demo sessions), and
build a lesson. Without provider keys the app still runs and the dashboard
explains what to configure — generation is simply disabled.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Enables Gemini and DeepSeek |
| `GROQ_API_KEY` | Enables the Groq fallback |
| `GEMINI_MODEL`, `DEEPSEEK_MODEL`, `GROQ_MODEL` | Model ids (defaults in `.env.example`) |
| `PROVIDER_ORDER` | Fallback order, default `gemini,deepseek,groq`; providers without a key are skipped |
| `AI_TIMEOUT_MS` | Per-provider request timeout (default 45s) |
| `AI_CACHE_TTL_SECONDS` | Default cache TTL (7 days) |
| `QUOTA_DAILY_CALLS`, `QUOTA_DAILY_TOKENS` | Rolling 24h per-user budget |
| `LESSON_STEPS`, `SOLUTION_MAX_ATTEMPTS` | Default steps per lesson, repair attempts per failing solution |
| `SANDBOX_DRIVER` | `piston` (default) or `judge0` |
| `PISTON_URL`, `PISTON_LANG_VERSIONS` | Piston endpoint and runtime versions |
| `JUDGE0_URL`, `JUDGE0_AUTH_TOKEN` | Judge0 endpoint and optional `X-Auth-Token` |
| `SANDBOX_TIMEOUT_MS` | Per-test wall clock limit (default 6s) |
| `SANDBOX_REQUIRED` | `true` (default) refuses to save lessons with unverified solutions |
| `GITHUB_TOKEN` | Optional; raises GitHub API limits |
| `RESEND_API_KEY`, `RESEND_FROM` | Streak emails |
| `APP_URL`, `CRON_SECRET`, `STREAK_EMAIL_MIN` | Email links, cron auth, minimum streak |
| `DEVELOPER_EMAILS` | Comma-separated emails granted the developer role (admin console and content CLI) |
| `NEXT_PUBLIC_APP_VERSION` | Build version shown in Settings and compared with the server (default `0.4.0`) |
| `MIN_SUPPORTED_VERSION` | Builds below this get the blocking required-update screen (default `0.1.0`) |
| `NEXT_PUBLIC_ENABLE_SW` | Set `false` to disable service-worker registration |
| `FEATURE_FLAGS` | JSON overrides, e.g. `{"githubImport":false,"pwaUpdates":false}` |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Server- and browser-side error reporting; leave empty to disable |
| `PORT` | Port for `npm start` (Render injects it) |

## How a lesson is built

1. **Normalize the source.** Pasted code is fenced and labeled, PDF text is
   extracted (scanned PDFs are rejected), GitHub repos are reduced to a bounded
   set of source files, and goals are passed through directly.
2. **Draft the lesson.** One JSON call returns a title, summary, objectives,
   and 1–4 steps. Every step carries a starter scaffold, a complete solution,
   stdin/stdout test cases, and three ladder hints. The response is validated
   against a Zod schema; invalid JSON gets one repair call, then the next
   provider in the chain tries.
3. **Verify every solution.** Each step's solution is executed against its own
   tests in Piston/Judge0, sequentially. Output is compared after normalizing
   line endings and trailing whitespace. Mismatches trigger up to
   `SOLUTION_MAX_ATTEMPTS` corrected programs; if none pass, the step is
   discarded. With `SANDBOX_REQUIRED=true`, a lesson with zero surviving steps
   is never saved (HTTP 422).
4. **Persist and seed hints.** Only verified steps are stored in the lesson
   JSON. Reference solutions and draft hints stay server-side; the API returns
   a redacted view.
5. **Practice.** Running code calls the sandbox again, records the attempt, and
   marks the day active for the streak.

## Sandbox backends

`docker-compose.yml` runs both options:

```bash
docker compose up -d                     # Piston (:2000), privileged for nsjail
docker compose --profile judge0 up -d    # Judge0 CE (:2358) + Postgres + Redis
```

Point the app at one with `SANDBOX_DRIVER` and the matching URL. Health check:

```bash
curl -s localhost:3000/api/health | jq
```

Piston is the lighter default for a single learner; Judge0 CE is the better fit
if you need its submission queue, auth token, or wider language matrix.
Version ids live in `.env.example` and `lib/sandbox/judge0.ts`.

## Plugin system

Each plugin lives in its own directory under `plugins/` with a `manifest.json` and a handler module:

```json
{
  "id": "socratic-hints",
  "name": "Socratic Hints",
  "version": "1.0.0",
  "description": "Adds a targeted nudge after a test run.",
  "hooks": ["attempt.evaluated"],
  "enabled": true
}
```

Manifests are validated when the registry loads: id, semver, hook names, and the
presence of a handler for every declared hook. Invalid plugins are listed in
`/admin` and skipped. Available hooks:

| Hook | Payload | Result |
| --- | --- | --- |
| `lesson.afterDraft` | generated draft + source | `{ patch }` merged into the draft, then re-validated |
| `attempt.evaluated` | pass/fail, test outcomes, language, step title | `{ messages }` shown in the workspace |
| `content.beforePublish` | pack + draft version | `{ ok, errors }`; `ok: false` blocks publishing |

`lib/plugins/registry.ts` runs every handler with a 750 ms timeout, catches
throws, and isolates a plugin after three consecutive failures so a bad plugin
cannot break lesson generation or publishing. Every run is written to
`plugin_events`; **Admin → Plugins** shows health, recent events, and a reset
control. A thrown plugin error is a warning; only an explicit `{ok:false}` from
the publish hook blocks a release.

Bundled samples:

- **socratic-hints** turns failing test output into a targeted nudge (timeout vs.
  runtime error vs. wrong output) and acknowledges passing runs.
- **publish-checklist** blocks a publish when theme contrast falls below WCAG
  4.5:1, branding copy is blank, or no featured lesson is present.

## Developer console and content packs

Set `DEVELOPER_EMAILS=you@example.com` (comma separated), sign in with that
address, and the header exposes **Admin**. The role lives on `users.role` and is
synced at login.

- **Content** edits copy, theme tokens, inline SVG assets, and featured lessons
  with an updating live preview and contrast warnings.
- **Save draft** validates the whole pack with Zod. **Publish** runs the
  `content.beforePublish` plugins, archives the current release, and marks the
  draft published.
- **History & audit** lists versions with one-click **Rollback** (restores an old
  pack as a new published version) plus the audit log: draft saves, publishes,
  blocked publishes, rollbacks, imports, exports, and plugin resets.
- **Plugins** shows manifest validity, isolation state, hook events, and reset.

### Row-level access

SQLite has no native RLS, so `lib/policy.ts` enforces the equivalent at the only
gateway to developer tables (`content_packs`, `audit_log`, `plugin_events`).
Every repository call needs a `DeveloperContext`, which can only be minted by
`authorizeDeveloper()` from a `developer` role, and the scope is re-asserted per
operation. Admin routes call `requireDeveloper()`; learners receive 403 and the
page renders an access notice instead.

### Bundled fallback

`loadActiveContent()` serves the newest published pack only if it still
validates. If the row is missing, corrupt, or fails validation, the app serves
`content/bundled/pack.json` and `/admin` reports the exact reason. A broken
draft can never reach learners until it is published, and a broken published
pack degrades to the bundled experience rather than a blank page.

## Content CLI

```bash
npm run content:export -- --out content/export.json
npm run content:import -- --file content/export.json --publish
```

Both commands need `DATABASE_PATH` and `DEVELOPER_EMAILS`. The CLI resolves the
allowlisted email to a developer identity, validates imports, writes the draft,
and records the action in the audit log. Without `--publish` the import stays a
draft.

## In-app updates

CodeQuest runs on the Next.js App Router, so **`vite-plugin-pwa` is not
applicable** (it is a Vite build plugin). The equivalent prompt-mode behavior is
implemented directly: `public/sw.js` is a hand-written service worker registered
by `AppUpdatesProvider`, with the same UX the request describes. The PWA
manifest, offline page, icons, and service worker live under `public/`.

### App shell (prompt mode)

- The worker precaches the offline shell and app icons. Navigations are
  network-first with an offline fallback; hashed Next.js assets are
  stale-while-revalidate; API requests are never cached.
- A build is only offered after a **new worker is installed and waiting** — the
  app never swaps the shell underneath a running page.
- Version checks run on launch, whenever the tab becomes visible or comes back
  online, and every 30 minutes. **Settings → App updates** has a manual
  **Check for updates** button with the current version, latest server version,
  minimum supported version, service-worker state, and last check time.
- When an update is ready, the mascot banner says **New version ready!** with up
to three changelog entries and **Update now** / **Later**. Update now posts
  `SKIP_WAITING`, waits for `controllerchange`, and reloads. **Later** is
  per-version: the next build brings the banner back.
- Editor drafts are written to `localStorage` on every keystroke
  (`cq_draft_<lessonId>`), so the reload keeps in-progress code. Hints and
  attempts are already server-side.
- **Required update:** if `/api/version` reports a `minSupportedVersion` above
  this build, a blocking screen offers a reload. It cannot be dismissed.

Set `NEXT_PUBLIC_ENABLE_SW=false` or `FEATURE_FLAGS={"pwaUpdates":false}` to
disable registration entirely (useful for previews behind auth proxies).

### Content updates (no reload)

`GET /api/version` returns:

```json
{
  "appVersion": "0.4.0",
  "contentVersion": 12,
  "minSupportedVersion": "0.1.0",
  "changelog": ["Group lessons by topic", "..."],
  "contentSource": "remote",
  "publishedAt": "2026-05-01T10:00:00.000Z",
  "generatedAt": "2026-05-05T12:00:00.000Z"
}
```

When `contentVersion` is newer than the applied version, the client downloads
`/api/content/active` in the background. Before anything is stored it verifies
that the advertised version matches and that the **entire pack still validates**
against the Zod schema. Only then is it written as one staged value; a dropped
connection or malformed pack leaves the current content untouched. Once the
learner leaves the active lesson, the staged pack is marked applied, the
previous version is recorded for rollback, and `router.refresh()` re-renders the
server components with the published pack — no full page reload and no lost
editor state. The server-side published pack remains authoritative; content
updates never ship code.

## Hint ladder

Three rungs per step, unlocked in order:

1. Conceptual nudge.
2. Concrete approach or pseudocode.
3. Near-complete prose guidance — never the full solution.

Requesting rung 3 before rung 2 returns `409`; rungs are stored in SQLite so the
same rung is stable across reloads and costs nothing to re-read.

## Translation

Tagalog and Bisaya translations cover the title, summary, goals, explanations,
and hints. Code, identifiers, tests, and command names are never translated, and
the prompt excludes reference solutions. Translations are cached per
`(lesson, locale)` in SQLite. If the model returns a different number of steps,
the result is rejected instead of showing misaligned content.

## Streak emails

```bash
curl -X POST http://localhost:3000/api/cron/streak \
  -H "Authorization: Bearer $CRON_SECRET"
```

The job selects learners active today or yesterday, computes consecutive UTC
days, and emails anyone at or above `STREAK_EMAIL_MIN` (default 2). The
`email_log` unique `(user, kind, day)` row prevents duplicates when the cron is
retried, and failed sends are recorded so they are visible.

## API

| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/login` | `{ email, name? }`, sets an httpOnly session cookie |
| `POST` | `/api/auth/logout` | Revokes the session |
| `GET` | `/api/me` | Profile, streak, quota, configured providers |
| `GET` | `/api/lessons` | Lesson summaries for the current user |
| `POST` | `/api/lessons` | JSON (`goal`/`code`/`github`) or multipart (`pdf`) |
| `GET` | `/api/lessons/:id` | Redacted lesson + unlocked hints |
| `POST` | `/api/lessons/:id/attempt` | Runs code against the step's tests |
| `POST` | `/api/lessons/:id/hints` | `{ stepIndex, level }`, sequential |
| `POST` | `/api/lessons/:id/translate` | `{ locale: "tl" \| "ceb" }` |
| `POST` | `/api/import/github` | Preview the files an import will use |
| `GET/POST` | `/api/cron/streak` | Requires `Authorization: Bearer $CRON_SECRET` |
| `GET/PUT` | `/api/admin/content` | Developer: read admin state / save a validated draft |
| `POST` | `/api/admin/content/publish` | Runs publish hooks, then releases the draft |
| `POST` | `/api/admin/content/rollback` | `{ version }` — republishes an old release |
| `GET/POST` | `/api/admin/plugins` | Plugin health / reset isolation |
| `GET` | `/api/health` | Database, provider, sandbox, and email status |
| `GET` | `/api/ready` | Readiness probe for the deploy platform (503 when not ready) |
| `GET` | `/api/version` | App/content/minimum versions and changelog |
| `GET` | `/api/content/active` | Full active pack with an ETag for conditional downloads |
| `GET` | `/api/features` | Effective feature flags for this deployment |

## Data model

SQLite lives at `DATABASE_PATH` (default `.data/codequest.db`) and is created
with `CREATE TABLE IF NOT EXISTS` on first open:

`users`, `sessions`, `lessons`, `hints`, `translations`, `attempts`,
`usage_events`, `ai_cache`, `daily_activity`, `email_log`, `content_packs`,
`audit_log`, `plugin_events`.

Existing databases are migrated in place: `createDb()` adds the `users.role`
column when it is missing.

## Deploy

The included blueprint targets **Render**, which can attach the persistent disk
SQLite needs. Any Node 22 host with a writable volume works if you set the same
environment variables.

### Render blueprint

1. Push the repository to GitHub.
2. In Render, choose **New → Blueprint** and select `render.yaml`.
3. Fill the `sync: false` secrets (provider keys, `DEVELOPER_EMAILS`,
   `NEXT_PUBLIC_APP_VERSION`, sandbox URL, Resend, `APP_URL`, Sentry DSNs).
   `CRON_SECRET` is generated by Render.
4. Deploy. The service mounts a 1 GB disk at `/var/data`, sets
   `DATABASE_PATH=/var/data/codequest.db`, runs `npm ci --include=dev &&
   npm run build`, starts with `npm run start` (honors `PORT`), and uses
   `GET /api/ready` as its health check.
5. Set `APP_URL` to the public origin so streak emails link correctly, and
   schedule a daily job against `/api/cron/streak` with the generated
   `CRON_SECRET` as a Bearer token.

`autoDeploy` is off: production rolls forward through CI. Add the Render deploy
hook URL as the GitHub **Actions secret** `RENDER_DEPLOY_HOOK_URL`.

### GitHub Actions

`.github/workflows/ci.yml` runs on every push and pull request:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test` (with an isolated `DATABASE_PATH`)
5. `npm run build`

On `main`, a deploy job then `POST`s `RENDER_DEPLOY_HOOK_URL`. If the secret is
missing the job logs a skip instead of failing every pull request; set the
secret to enable deploys.

### Health and readiness

- `GET /api/health` — liveness plus configuration detail: database, providers,
  sandbox driver/URL, email.
- `GET /api/ready` — 200 only when the database opens and content resolves;
  503 otherwise. Use this for platform health checks and uptime monitors.

### Feature flags

`FEATURE_FLAGS` is a JSON object; malformed JSON falls back to defaults, and
unknown keys are ignored. Flags apply to both UI and API behavior.

| Flag | Default | Controls |
| --- | --- | --- |
| `githubImport` | `true` | GitHub tab on the builder and `/api/import/github` |
| `streakEmails` | `true` | `/api/cron/streak` (returns 503 when off) |
| `plugins` | `true` | Plugin surface in the admin console |
| `contentUpdates` | `true` | Background content download and swap |
| `pwaUpdates` | `true` | Service-worker registration and the update banner |
| `translations` | `true` | Tagalog/Bisaya translation controls |

### Error reporting

Set `SENTRY_DSN` (server) and/or `NEXT_PUBLIC_SENTRY_DSN` (browser). Unhandled
route-handler errors, the Next.js `onRequestError` hook, and the global error
boundary report through a small Store-API client in `lib/sentry.ts`; the SDK is
not required. Capture is fire-and-forget with a 2.5 s timeout, so a Sentry
outage cannot delay or fail a request. Leave both variables empty to disable
reporting entirely.

### Release checklist

1. Bump `NEXT_PUBLIC_APP_VERSION` (and `package.json` if the build changed).
2. Update `APP_CHANGELOG` or the pack's `meta.changelog` so the banner explains
   the change.
3. Raise `MIN_SUPPORTED_VERSION` only for breaking changes; older builds then
   get the required-update screen.
4. Publish content from **Admin → Content** when only lessons/copy changed — no
   deploy or reload required for learners.

## Tests

```bash
npm run typecheck
npm test
npm run lint
```

The suite covers provider fallback/repair/caching/quota, Piston and Judge0
request shapes, verification semantics (including timeouts and sandbox
outages), GitHub import filtering, lesson discard behavior, solution
redaction, the hint ladder, translation caching/shape checks, streak math,
email gating/deduplication, and the Resend client. It also covers manifest
validation, hook timeouts and failure isolation, sample-plugin behavior,
content draft/publish/rollback/audit, export/import, invalid-pack fallback,
and developer-role policy. Release coverage adds semver comparison and the
minimum-version gate, changelog merging, feature-flag parsing and defaults,
readiness reporting, staged-content validation (version mismatch, partial pack,
invalid payload), and the Sentry client (endpoint building, payload shape,
no-op without a DSN, and failure isolation).

## Notes and limitations

- **Authentication is demo-level.** Any email creates a session; there is no
  password or email verification. Put a real identity provider in front before
  exposing this to the internet.
- **Untrusted code execution** depends on the sandbox. Piston isolates jobs with
  nsjail in a privileged container; Judge0 CE similarly. Never point
  `SANDBOX_*` at an unisolated interpreter.
- **PDFs must contain selectable text.** Scans are rejected with a clear error
  instead of generating from empty text.
- **SQLite has no row-level security.** The developer role is enforced by a
  policy gateway plus route guards, not by database grants; run the app with a
  dedicated SQLite file and keep `DEVELOPER_EMAILS` short.
- **Model cost** is controlled by the rolling quota, the response cache, and by
  capping exports (12 GitHub files, 5 tests per step, 4 steps per lesson).
- **Deployment needs a persistent disk.** SQLite is a file; a stateless
  container without a mounted volume loses accounts, lessons, and content on
  every deploy. The Render blueprint mounts one at `/var/data`. For multiple
  instances, move to a networked database first.
- **Prompt-mode updates are shell-level, not data migrations.** A new build may
  need schema changes; `createDb()` migrates additively, so avoid destructive
  migrations that would break an older tab mid-session.
- **Service-worker updates are not browser-tested here.** The worker, staging
  gate, and APIs are covered by builds/tests, but the prompt banner and reload
  flow require a real browser session to observe.
