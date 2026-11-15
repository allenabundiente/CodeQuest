import { CreateLessonSchema } from "@/lib/api-schemas";
import { getDb } from "@/lib/db";
import { BadRequestError } from "@/lib/errors";
import {
  errorResponse,
  json,
  parseJson,
  requireUser,
} from "@/lib/http";
import { extractPdfText, fetchRepoContext, isPdfUpload } from "@/lib/ingest";
import { createLesson, listLessons, toLessonView } from "@/lib/lessons";
import { lessonDeps, } from "@/lib/runtime";
import { LanguageSchema, DifficultySchema } from "@/lib/schemas";
import { DIFFICULTIES, LANGUAGES } from "@/lib/types";
import type { Difficulty, Language } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return json({ lessons: listLessons(getDb(), user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

function formString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formLanguage(form: FormData): Language | undefined {
  const raw = formString(form, "language");
  if (!raw) return undefined;
  const parsed = LanguageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError(
      `Language must be one of: ${LANGUAGES.join(", ")}.`,
    );
  }
  return parsed.data;
}

function formDifficulty(form: FormData): Difficulty | undefined {
  const raw = formString(form, "difficulty");
  if (!raw) return undefined;
  const parsed = DifficultySchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError(
      `Difficulty must be one of: ${DIFFICULTIES.join(", ")}.`,
    );
  }
  return parsed.data;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const deps = lessonDeps();
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("pdf");
      if (!(file instanceof File)) {
        throw new BadRequestError("Attach a PDF file to build a lesson from.");
      }
      if (!isPdfUpload(file.name, file.type)) {
        throw new BadRequestError("Only PDF uploads are supported.");
      }

      const extracted = await extractPdfText(
        new Uint8Array(await file.arrayBuffer()),
      );
      const stepCountRaw = Number(formString(form, "stepCount") ?? "3");

      const lesson = await createLesson(deps, {
        userId: user.id,
        source: "pdf",
        pdfText: extracted.text,
        goal: formString(form, "goal"),
        language: formLanguage(form),
        difficulty: formDifficulty(form),
        title: file.name.replace(/\.pdf$/i, ""),
        stepCount: Number.isFinite(stepCountRaw) ? stepCountRaw : 3,
      });

      return json(
        {
          lesson: toLessonView(lesson),
          meta: { pages: extracted.pages, truncated: extracted.truncated },
        },
        201,
      );
    }

    const body = await parseJson(request, CreateLessonSchema);

    if (body.source === "github") {
      if (!body.url) throw new BadRequestError("Paste a GitHub repository URL.");
      const repo = await fetchRepoContext({
        url: body.url,
        token: process.env.GITHUB_TOKEN || undefined,
      });
      const lesson = await createLesson(deps, {
        userId: user.id,
        source: "github",
        github: repo,
        goal: body.goal,
        language: body.language,
        difficulty: body.difficulty,
        title: body.title ?? `${repo.owner}/${repo.repo}`,
        stepCount: body.stepCount,
      });
      return json(
        {
          lesson: toLessonView(lesson),
          meta: {
            repo: `${repo.owner}/${repo.repo}@${repo.ref}`,
            files: repo.files.length,
            truncated: repo.truncated,
          },
        },
        201,
      );
    }

    if (body.source === "pdf") {
      throw new BadRequestError(
        "Upload the PDF as multipart/form-data instead of JSON.",
      );
    }

    const lesson = await createLesson(deps, {
      userId: user.id,
      source: body.source,
      goal: body.goal,
      code: body.code,
      errorText: body.errorText,
      language: body.language,
      difficulty: body.difficulty,
      title: body.title,
      stepCount: body.stepCount,
    });

    return json({ lesson: toLessonView(lesson) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
