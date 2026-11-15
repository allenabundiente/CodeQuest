import { redirect } from "next/navigation";
import { aiProviderIds } from "@/lib/ai";
import { loadActiveContent } from "@/lib/content/store";
import { getDb } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/flags";
import { currentUser } from "@/lib/http";
import { sandboxConfigFromEnv } from "@/lib/sandbox";
import { NewLessonForm } from "@/components/NewLessonForm";

export const dynamic = "force-dynamic";

export default async function NewLessonPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const providers = aiProviderIds();
  const sandbox = sandboxConfigFromEnv();
  const pack = loadActiveContent(getDb()).pack;
  const defaultSteps = Math.min(
    4,
    Math.max(1, Number(process.env.LESSON_STEPS ?? 3) || 3),
  );

  return (
    <div className="stack">
      <section className="lesson-head">
        <p className="eyebrow">Build a lesson</p>
        <h1 className="lesson-title">{pack.copy.newLessonTitle}</h1>
        <p className="lede">{pack.copy.newLessonSubtitle}</p>
        <div className="lesson-meta">
          <span className="badge badge-lang">
            {sandbox.driver} ·{" "}
            {sandbox.driver === "judge0" ? sandbox.judge0Url : sandbox.pistonUrl}
          </span>
          <span className="badge">
            {providers.length > 0
              ? `${providers.length} provider${providers.length === 1 ? "" : "s"} ready`
              : "no providers configured"}
          </span>
        </div>
      </section>

      <NewLessonForm
        defaultSteps={defaultSteps}
        aiConfigured={providers.length > 0}
        providerChain={providers}
        githubImportEnabled={isFeatureEnabled("githubImport")}
      />
    </div>
  );
}
