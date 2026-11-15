import { aiProviderIds, getAi } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { errorResponse, json, requireUser } from "@/lib/http";
import { streakSummary } from "@/lib/streaks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const db = getDb();
    return json({
      user: { id: user.id, email: user.email, name: user.name },
      streak: streakSummary(db, user.id),
      quota: getAi().quota.snapshot(user.id),
      providers: aiProviderIds(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
