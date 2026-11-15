import { z } from "zod";
import {
  loadAdminState,
  logAdminAction,
  publishDraft,
} from "@/lib/content/store";
import { getDb } from "@/lib/db";
import { BadRequestError } from "@/lib/errors";
import { errorResponse, json, parseJson, requireDeveloper } from "@/lib/http";
import { getPluginRegistry } from "@/lib/plugins/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PublishSchema = z.object({
  notes: z.string().max(300).nullish(),
});

export async function POST(request: Request) {
  try {
    const context = await requireDeveloper();
    const body = await parseJson(request, PublishSchema);
    const db = getDb();
    const state = loadAdminState(context, db);

    if (!state.draft) {
      throw new BadRequestError(
        "There is no draft to publish. Save your edits first.",
      );
    }

    const pluginRun = await getPluginRegistry().runHook(
      "content.beforePublish",
      {
        pack: state.draft.pack,
        version: state.draft.version,
      },
    );

    if (!pluginRun.ok) {
      logAdminAction(context, db, {
        action: "content.publish.blocked",
        target: `v${state.draft.version}`,
        details: pluginRun.errors.join("; "),
      });
      return json(
        {
          error: {
            code: "publish_blocked",
            message:
              "Publishing was blocked by a content check. Fix the issues below and try again.",
            details: pluginRun.errors,
          },
        },
        422,
      );
    }

    const published = publishDraft(context, db, {
      notes: body.notes ?? null,
    });

    return json({
      published,
      warnings: pluginRun.failures.map(
        (failure) => `${failure.pluginId}: ${failure.message}`,
      ),
      state: loadAdminState(context, db),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
