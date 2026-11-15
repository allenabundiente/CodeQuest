import { z } from "zod";
import { HOOK_NAMES } from "./types";

export const PluginManifestSchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]{2,40}$/,
      "Plugin id must be lowercase letters, numbers, and dashes.",
    ),
  name: z.string().min(2).max(60),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Version must look like 1.0.0."),
  description: z.string().min(10).max(300),
  hooks: z.array(z.enum(HOOK_NAMES)).min(1),
  enabled: z.boolean().default(true),
  author: z.string().max(80).optional(),
});

export type ValidatedManifest = z.infer<typeof PluginManifestSchema>;
