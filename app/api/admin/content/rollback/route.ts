import { z } from "zod";
import {
  loadAdminState,
  rollbackToVersion,
} from "@/lib/content/store";
import { getDb } from "@/lib/db";
import { errorResponse, json, parseJson, requireDeveloper } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RollbackSchema = z.object({
  version: z.number().int().min(1),
});

export async function POST(request: Request) {
  try {
    const context = await requireDeveloper();
    const body = await parseJson(request, RollbackSchema);
    const db = getDb();
    const published = rollbackToVersion(context, db, body.version);

    return json({
      published,
      state: loadAdminState(context, db),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
