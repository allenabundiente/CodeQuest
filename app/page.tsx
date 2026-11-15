import Link from "next/link";
import { redirect } from "next/navigation";
import { aiProviderIds, getAi } from "@/lib/ai";
import { loadActiveContent } from "@/lib/content/store";
import { svgToDataUri } from "@/lib/content/svg";
import { getDb, todayKey } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { listLessons } from "@/lib/lessons";
import { streakSummary } from "@/lib/streaks";

export const dynamic = "force-dynamic";

function lastSevenDays(today: string): string[] {
  const days: string[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const db = getDb();
  const content = loadActiveContent(db);
  const pack = content.pack;
  const lessons = listLessons(db, user.id);
  const streak = streakSummary(db, user.id);
  const quota = getAi().quota.snapshot(user.id);
  const providers = aiProviderIds();
  const week = lastSevenDays(todayKey());
  const quotaPercent = Math.min(
    100,
    Math.round((quota.usedCalls / Math.max(1, quota.limitCalls)) * 100),
  );
  const firstName = user.name?.split(" ")[0] || user.email.split("@")[0];

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-main">
          <p className="eyebrow">{pack.copy.dashboardEyebrow}</p>
          <h1>
            {pack.copy.dashboardTitle}, {firstName}.
          </h1>
          <p className="lede">{pack.copy.dashboardSubtitle}</p>
          <div className="hero-actions">
            <Link className="btn btn-primary" href="/new">
              Build a lesson
            </Link>
            {lessons.length > 0 ? (
              <Link className="btn btn-ghost" href={`/lessons/${lessons[0].id}`}>
                Resume “{lessons[0].title}”
              </Link>
            ) : null}
          </div>
        </div>

        <div className="streak-card">
          <div className="streak-num">{streak.current}</div>
          <p className="streak-label">day streak</p>
          <div className="streak-days" aria-label="Last seven days">
            {week.map((day) => (
              <span
                key={day}
                className={streak.days.includes(day) ? "day-dot on" : "day-dot"}
                title={day}
              />
            ))}
          </div>
          <p className="small muted">Longest streak: {streak.longest}</p>
          {streak.activeToday ? (
            <p className="small accent">Today counts. Nice.</p>
          ) : (
            <p className="small muted">Run one test today to keep it alive.</p>
          )}
        </div>
      </section>

      <section className="meters">
        <div className="meter">
          <div className="meter-head">
            <span>AI quota · rolling 24h</span>
            <span>
              {quota.usedCalls} / {quota.limitCalls} generations
            </span>
          </div>
          <div className="meter-bar">
            <div className="meter-fill" style={{ width: `${quotaPercent}%` }} />
          </div>
          <p className="small muted">
            {quota.remainingCalls} left · resets{" "}
            {new Date(quota.resetAt).toLocaleString()}
          </p>
        </div>

        <div className="meter">
          <div className="meter-head">
            <span>Model chain</span>
            <span>
              {providers.length > 0 ? providers.join(" → ") : "not configured"}
            </span>
          </div>
          <p className="small muted">
            Gemini and DeepSeek run through OpenRouter; Groq is the last
            provider in the fallback chain. Responses are JSON-schema
            validated and cached.
          </p>
        </div>
      </section>

      {providers.length === 0 ? (
        <div className="alert alert-warn">
          No model providers are configured, so lesson generation is disabled.
          Add <code>OPENROUTER_API_KEY</code> and/or <code>GROQ_API_KEY</code>{" "}
          to <code>.env</code>, then restart the dev server.
        </div>
      ) : null}

      <section id="lessons">
        <div className="section-head">
          <h2>Your lessons</h2>
          <span className="small muted">
            {lessons.length} saved · {streak.days.length} active days
          </span>
        </div>

        {lessons.length === 0 ? (
          <div className="empty">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="empty-art"
              src={svgToDataUri(pack.assets.emptyStateArt)}
              alt=""
            />
            <h3>{pack.copy.emptyStateTitle}</h3>
            <p className="muted">{pack.copy.emptyStateBody}</p>
            <Link className="btn btn-primary" href="/new">
              Build your first lesson
            </Link>
          </div>
        ) : (
          <div className="lesson-grid">
            {lessons.map((lesson) => (
              <Link
                key={lesson.id}
                href={`/lessons/${lesson.id}`}
                className="card"
              >
                <div className="card-top">
                  <span className="badge">{lesson.difficulty}</span>
                  <span className="badge badge-lang">{lesson.language}</span>
                  {lesson.verified ? (
                    <span className="badge badge-ok">sandbox verified</span>
                  ) : null}
                </div>
                <h3>{lesson.title}</h3>
                <p className="muted small clamp-3">{lesson.summary}</p>
                <div className="card-foot">
                  <span>
                    {lesson.stepCount} step{lesson.stepCount === 1 ? "" : "s"} ·{" "}
                    {lesson.source}
                  </span>
                  <span>
                    {new Date(lesson.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>From the content pack</h2>
          <span className="small muted">
            {content.source === "remote"
              ? `remote v${content.version}`
              : "bundled pack"}
          </span>
        </div>
        <div className="lesson-grid">
          {pack.lessons.map((lesson) => (
            <div className="card" key={lesson.slug}>
              <div className="card-top">
                <span className="badge">{lesson.difficulty}</span>
                <span className="badge badge-lang">{lesson.language}</span>
                <span className="badge">{lesson.minutes} min</span>
              </div>
              <h3>{lesson.title}</h3>
              <p className="muted small clamp-3">{lesson.summary}</p>
              <div className="card-foot">
                <span>{lesson.tags.slice(0, 2).join(" · ") || "curated"}</span>
                <Link
                  className="featured-link"
                  href={`/new?goal=${encodeURIComponent(`${lesson.title}: ${lesson.summary}`)}`}
                >
                  Use as goal →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
