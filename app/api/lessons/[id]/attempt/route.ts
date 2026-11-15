import { AttemptSchema } from "@/lib/api-schemas";
import { errorResponse, json, parseJson, requireUser } from "@/lib/http";
import { recordAttempt } from "@/lib/lessons";
import { lessonDeps } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await parseJson(request, AttemptSchema);

    const { report, pluginMessages, pluginFailures } = await recordAttempt(
      lessonDeps(),
      {
        userId: user.id,
        lessonId: id,
        stepIndex: body.stepIndex,
        code: body.code,
      },
    );

    return json({ report, pluginMessages, pluginFailures });
  } catch (error) {
    return errorResponse(error);
  }
}
