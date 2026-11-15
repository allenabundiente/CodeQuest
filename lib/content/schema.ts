import { z } from "zod";
import { DifficultySchema, LanguageSchema } from "../schemas";
import { SvgAssetSchema } from "./assets";

export const CONTENT_SCHEMA_VERSION = 1;

const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color such as #7cf29c.");

export const ContentCopySchema = z.object({
  brandName: z.string().min(1).max(40),
  tagline: z.string().min(1).max(120),
  dashboardEyebrow: z.string().min(1).max(40),
  dashboardTitle: z.string().min(1).max(80),
  dashboardSubtitle: z.string().min(20).max(600),
  emptyStateTitle: z.string().min(3).max(120),
  emptyStateBody: z.string().min(20).max(600),
  loginTitle: z.string().min(3).max(80),
  loginSubtitle: z.string().min(10).max(400),
  newLessonTitle: z.string().min(3).max(120),
  newLessonSubtitle: z.string().min(20).max(600),
  footer: z.string().min(1).max(300),
});

export const ContentThemeSchema = z.object({
  bg: HexColor,
  panel: HexColor,
  text: HexColor,
  muted: HexColor,
  accent: HexColor,
  accentInk: HexColor,
  blue: HexColor,
  border: HexColor,
  danger: HexColor,
  warn: HexColor,
  radius: z.string().regex(/^\d{1,3}px$/, "Radius must look like 16px."),
});

export const ContentAssetsSchema = z.object({
  logoMark: SvgAssetSchema,
  emptyStateArt: SvgAssetSchema,
});

export const FeaturedLessonSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{2,59}$/, "Use a lowercase slug."),
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(400),
  language: LanguageSchema,
  difficulty: DifficultySchema,
  minutes: z.number().int().min(5).max(240),
  objectives: z.array(z.string().min(3).max(160)).min(1).max(5),
  tags: z.array(z.string().min(1).max(24)).max(6).default([]),
});

export const ContentPackSchema = z.object({
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  meta: z.object({
    name: z.string().min(1).max(60),
    description: z.string().max(300),
    author: z.string().max(80).optional(),
    updatedAt: z.string().max(40).optional(),
    changelog: z.array(z.string().min(3).max(200)).max(10).default([]),
  }),
  copy: ContentCopySchema,
  theme: ContentThemeSchema,
  assets: ContentAssetsSchema,
  lessons: z.array(FeaturedLessonSchema).min(1).max(12),
});

export type ContentCopy = z.infer<typeof ContentCopySchema>;
export type ContentTheme = z.infer<typeof ContentThemeSchema>;
export type ContentAssets = z.infer<typeof ContentAssetsSchema>;
export type FeaturedLesson = z.infer<typeof FeaturedLessonSchema>;
export type ContentPack = z.infer<typeof ContentPackSchema>;

export interface PackValidation {
  ok: boolean;
  pack?: ContentPack;
  errors: string[];
}

export function validatePack(input: unknown): PackValidation {
  const parsed = ContentPackSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 12).map((issue) => {
        const path = issue.path.length ? issue.path.map(String).join(".") : "(root)";
        return `${path}: ${issue.message}`;
      }),
    };
  }
  return { ok: true, pack: parsed.data, errors: [] };
}
