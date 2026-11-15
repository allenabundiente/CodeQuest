import { getFeatureFlags } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { flags: getFeatureFlags() },
    { headers: { "cache-control": "no-store" } },
  );
}
