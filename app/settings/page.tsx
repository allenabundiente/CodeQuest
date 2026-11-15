import { redirect } from "next/navigation";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { loadActiveContent } from "@/lib/content/store";
import { getDb } from "@/lib/db";
import { getFeatureFlags } from "@/lib/flags";
import { currentUser } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const active = loadActiveContent(getDb());
  const flags = getFeatureFlags();

  return (
    <div className="stack">
      <section className="lesson-head">
        <p className="eyebrow">Settings</p>
        <h1 className="lesson-title">App, content, and rollout</h1>
        <p className="lede">
          Check for a newer build, see which content pack is live, and confirm
          which rollout flags this deployment is using.
        </p>
      </section>

      <SettingsPanel
        flags={flags}
        contentSource={active.source}
        contentVersion={active.version ?? 0}
        isDeveloper={user.role === "developer"}
      />
    </div>
  );
}
