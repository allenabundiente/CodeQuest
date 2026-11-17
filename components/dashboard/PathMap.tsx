import Link from "next/link";
import type { LessonSummary } from "@/lib/types";

/**
 * The learner's lessons as a journey. The layout is one column on phones and a
 * centered alternating path once the content area is wide enough.
 */
export function PathMap({ lessons }: { lessons: LessonSummary[] }) {
  return (
    <ol className="path-map" aria-label="Your lesson path">
      {lessons.map((lesson, index) => (
        <li className="path-step" key={lesson.id}>
          <span className="path-marker" aria-hidden="true">
            {index + 1}
          </span>
          <Link className="path-card" href={`/lessons/${lesson.id}`}>
            <div className="path-card-top">
              <span className="badge">{lesson.difficulty}</span>
              <span className="badge badge-lang">{lesson.language}</span>
              {index === 0 ? (
                <span className="badge badge-ok">next up</span>
              ) : null}
              {lesson.verified ? (
                <span className="badge" title="Every solution passed its tests">
                  verified
                </span>
              ) : null}
            </div>
            <h3>{lesson.title}</h3>
            <p className="small muted clamp-3">{lesson.summary}</p>
            <span className="path-meta">
              {lesson.stepCount} step{lesson.stepCount === 1 ? "" : "s"} ·{" "}
              {lesson.source} ·{" "}
              {new Date(lesson.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
