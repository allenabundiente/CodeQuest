import type { PluginDefinition } from "../lib/plugins/types";
import { socraticHints } from "./socratic-hints/plugin";
import { publishChecklist } from "./publish-checklist/plugin";

/** Bundled sample plugins. Add a directory here to ship another one. */
export const samplePlugins: PluginDefinition[] = [
  socraticHints,
  publishChecklist,
];
