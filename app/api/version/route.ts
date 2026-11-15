import { loadActiveContent } from "@/lib/content/store";
import { getDb } from "@/lib/db";
import {
  APP_VERSION,
  DEFAULT_MIN_SUPPORTED_VERSION,
  buildVersionInfo,
} from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const active = loadActiveContent(getDb());
  const info = buildVersionInfo({
    appVersion: APP_VERSION,
    contentVersion: active.version ?? 0,
    minSupportedVersion:
      (process.env.MIN_SUPPORTED_VERSION ?? "").trim() ||
      DEFAULT_MIN_SUPPORTED_VERSION,
    contentChangelog: active.pack.meta.changelog ?? [],
    contentSource: active.source,
    publishedAt: active.publishedAt,
  });

  return Response.json(info, {
    headers: { "cache-control": "no-store" },
  });
}
