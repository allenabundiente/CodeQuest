import { aiProviderIds } from "@/lib/ai";
import { loadActiveContent } from "@/lib/content/store";
import type { ContentSnapshot } from "@/lib/content/types";
import { getDb } from "@/lib/db";
import { getPluginRegistry } from "@/lib/plugins/runtime";
import { buildReadiness } from "@/lib/ready";
import { sandboxConfigFromEnv } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  let databaseOk = true;
  let content: ContentSnapshot | null = null;

  try {
    db.prepare("SELECT 1 AS ok").get();
  } catch {
    databaseOk = false;
  }

  if (databaseOk) {
    try {
      content = loadActiveContent(db);
    } catch {
      content = null;
    }
  }

  const plugins = getPluginRegistry().status();
  const providers = aiProviderIds();
  const sandbox = sandboxConfigFromEnv();

  const report = buildReadiness({
    databaseOk,
    content,
    plugins: {
      total: plugins.length,
      valid: plugins.filter((plugin) => plugin.valid).length,
    },
    providers,
    sandbox: {
      driver: sandbox.driver,
      url: sandbox.driver === "judge0" ? sandbox.judge0Url : sandbox.pistonUrl,
    },
  });

  return Response.json(report, {
    status: report.ready ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
