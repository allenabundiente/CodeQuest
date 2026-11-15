import { z } from "zod";
import {
  DifficultySchema,
  LanguageSchema,
  TranslationLocaleSchema,
} from "./schemas";

export const LoginSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(80).optional(),
});

export const CreateLessonSchema = z.object({
  source: z.enum(["goal", "code", "pdf", "github"]),
  goal: z.string().max(3000).optional(),
  code: z.string().max(30_000).optional(),
  errorText: z.string().max(12_000).optional(),
  url: z.string().max(500).optional(),
  language: LanguageSchema.optional(),
  difficulty: DifficultySchema.optional(),
  title: z.string().max(120).optional(),
  stepCount: z.number().int().min(1).max(4).optional(),
});

export const AttemptSchema = z.object({
  stepIndex: z.number().int().min(0).max(9),
  code: z.string().min(1).max(30_000),
});

export const HintRequestSchema = z.object({
  stepIndex: z.number().int().min(0).max(9),
  level: z.number().int().min(1).max(3),
});

export const TranslateRequestSchema = z.object({
  locale: TranslationLocaleSchema,
});

export const ImportRepoSchema = z.object({
  url: z.string().min(5).max(500),
});
