import { aiProviderIds } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { persistenceStatus } from "@/lib/persistence";
import { sandboxConfigFromEnv, sandboxRequired } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "error" = "ok";
  try {
    getDb().prepare("SELECT 1 AS ok").get();
  } catch {
    database = "error";
  }

  const sandbox = sandboxConfigFromEnv();
  const providers = aiProviderIds();

  return json(
    {
      ok: database === "ok",
      database,
      persistence: persistenceStatus(),
      ai: {
        configured: providers.length > 0,
        providers,
        quota: {
          dailyCalls: Number(process.env.QUOTA_DAILY_CALLS ?? 40),
        },
      },
      sandbox: {
        driver: sandbox.driver,
        url:
          sandbox.driver === "judge0" ? sandbox.judge0Url : sandbox.pistonUrl,
        required: sandboxRequired(),
      },
      email: {
        configured: Boolean(
          process.env.RESEND_API_KEY && process.env.RESEND_FROM,
        ),
        cronSecret: Boolean(process.env.CRON_SECRET),
      },
    },
    database === "ok" ? 200 : 503,
  );
}
