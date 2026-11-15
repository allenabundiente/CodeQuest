import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { authorizeDeveloper } from "@/lib/authz";
import { loadAdminState } from "@/lib/content/store";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";
import {
  getPluginRegistry,
  listPluginEvents,
} from "@/lib/plugins/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  if (user.role !== "developer") {
    return (
      <div className="panel">
        <p className="eyebrow">Restricted</p>
        <h1 className="login-title">Developer access required</h1>
        <p className="muted" style={{ marginBottom: 18 }}>
          You are signed in as <strong>{user.email}</strong>. Add that address to
          the <code>DEVELOPER_EMAILS</code> allowlist and sign in again to open
          the content console.
        </p>
        <div className="workspace-actions">
          <Link className="btn btn-ghost" href="/">
            Back to dashboard
          </Link>
          <Link className="btn btn-primary" href="/login">
            Sign in with a developer email
          </Link>
        </div>
      </div>
    );
  }

  const db = getDb();
  let context;
  try {
    context = authorizeDeveloper(user);
  } catch {
    notFound();
  }

  const state = loadAdminState(context, db);
  const registry = getPluginRegistry();

  return (
    <AdminConsole
      initialState={state}
      initialPlugins={registry.status()}
      initialEvents={listPluginEvents(20)}
    />
  );
}
