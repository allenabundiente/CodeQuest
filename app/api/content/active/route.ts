import { loadActiveContent } from "@/lib/content/store";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const active = loadActiveContent(getDb());
  const version = active.version ?? 0;
  const etag = `W/"cq-${active.source}-${version}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "no-store" },
    });
  }

  return Response.json(
    {
      version,
      source: active.source,
      publishedAt: active.publishedAt,
      pack: active.pack,
    },
    {
      headers: { etag, "cache-control": "no-store" },
    },
  );
}
