import { z } from "zod";
import { logAdminAction } from "@/lib/content/store";
import { getDb } from "@/lib/db";
import { errorResponse, json, parseJson, requireDeveloper } from "@/lib/http";
import {
  getPluginRegistry,
  listPluginEvents,
} from "@/lib/plugins/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PluginActionSchema = z.object({
  action: z.literal("reset"),
  pluginId: z.string().min(1).max(60),
});

export async function GET() {
  try {
    await requireDeveloper();
    return json({
      plugins: getPluginRegistry().status(),
      events: listPluginEvents(30),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireDeveloper();
    const body = await parseJson(request, PluginActionSchema);
    const reset = getPluginRegistry().reset(body.pluginId);

    if (reset) {
      logAdminAction(context, getDb(), {
        action: "plugin.reset",
        target: body.pluginId,
        details: "Cleared failure counter and isolation flag.",
      });
    }

    return json({
      reset,
      plugins: getPluginRegistry().status(),
      events: listPluginEvents(30),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
