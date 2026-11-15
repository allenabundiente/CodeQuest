import { z } from "zod";
import { loadAdminState, saveDraft } from "@/lib/content/store";
import { getDb } from "@/lib/db";
import { errorResponse, json, parseJson, requireDeveloper } from "@/lib/http";
import {
  getPluginRegistry,
  listPluginEvents,
} from "@/lib/plugins/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SaveDraftSchema = z.object({
  pack: z.unknown(),
  notes: z.string().max(300).nullish(),
});

export async function GET() {
  try {
    const context = await requireDeveloper();
    const db = getDb();
    return json({
      state: loadAdminState(context, db),
      plugins: getPluginRegistry().status(),
      events: listPluginEvents(20),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireDeveloper();
    const body = await parseJson(request, SaveDraftSchema);
    const draft = saveDraft(context, getDb(), {
      pack: body.pack,
      notes: body.notes ?? null,
    });
    return json({ draft });
  } catch (error) {
    return errorResponse(error);
  }
}
