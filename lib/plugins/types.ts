import type {
  ContentPack,
  ContentTheme,
  FeaturedLesson,
} from "../content/schema";
import type { LessonDraft, SourceKind, TestOutcome, Language } from "../types";

export const HOOK_NAMES = [
  "lesson.afterDraft",
  "attempt.evaluated",
  "content.beforePublish",
] as const;

export type HookName = (typeof HOOK_NAMES)[number];

export interface HookPayloads {
  "lesson.afterDraft": {
    draft: LessonDraft;
    source: SourceKind;
  };
  "attempt.evaluated": {
    passed: boolean;
    outcomes: TestOutcome[];
    language: Language;
    stepTitle: string;
  };
  "content.beforePublish": {
    pack: ContentPack;
    version: number | null;
  };
}

export interface HookResult {
  /** Only `content.beforePublish` consumes this; false blocks publishing. */
  ok?: boolean;
  messages?: string[];
  errors?: string[];
  /** Patch merged into the hook's target (currently the lesson draft). */
  patch?: Record<string, unknown>;
}

export type HookHandler<K extends HookName> = (
  payload: HookPayloads[K],
) => HookResult | void | Promise<HookResult | void>;

export interface PluginDefinition {
  manifest: PluginManifest;
  handlers: Partial<{ [K in HookName]: HookHandler<K> }>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  hooks: HookName[];
  enabled: boolean;
  author?: string;
}

export interface HookFailure {
  pluginId: string;
  message: string;
}

export interface HookRunResult {
  ok: boolean;
  messages: string[];
  errors: string[];
  patch: Record<string, unknown>;
  failures: HookFailure[];
}

export interface PluginStatus {
  id: string;
  name: string;
  version: string;
  hooks: string[];
  enabled: boolean;
  disabled: boolean;
  failures: number;
  lastError: string | null;
  valid: boolean;
  error?: string;
}

export interface PluginEvent {
  pluginId: string;
  hook: HookName | "manifest";
  ok: boolean;
  message?: string;
}

export type { ContentPack, ContentTheme, FeaturedLesson };
