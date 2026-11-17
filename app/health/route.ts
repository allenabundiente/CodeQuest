import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Render health probe and keep-alive target. Deliberately does not build the
 * whole readiness report: it only needs to prove the process and database
 * handle are alive.
 */
export async function GET() {
  try {
    getDb().prepare("SELECT 1 AS ok").get();
    return Response.json(
      { status: "ok", service: "codequest", time: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "error", service: "codequest" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
