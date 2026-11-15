import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { loadActiveContent } from "@/lib/content/store";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect("/");

  const pack = loadActiveContent(getDb()).pack;

  return (
    <div className="login-wrap">
      <div className="panel">
        <p className="eyebrow">{pack.copy.brandName}</p>
        <h1 className="login-title">{pack.copy.loginTitle}</h1>
        <p className="login-sub">{pack.copy.loginSubtitle}</p>
        <LoginForm />
        <p className="login-note">
          No password in local mode — this demo creates a session for any email
          you enter. Developer emails listed in <code>DEVELOPER_EMAILS</code>{" "}
          also get the admin console. Put a real auth provider in front before
          deploying.
        </p>
      </div>
    </div>
  );
}
