import { TranslateRequestSchema } from "@/lib/api-schemas";
import { getAi } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { errorResponse, json, parseJson, requireUser } from "@/lib/http";
import { translateLesson } from "@/lib/translate";

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
    const body = await parseJson(request, TranslateRequestSchema);

    const translation = await translateLesson(
      { db: getDb(), generate: getAi().generate },
      { userId: user.id, lessonId: id, locale: body.locale },
    );

    return json({ translation });
  } catch (error) {
    return errorResponse(error);
  }
}
