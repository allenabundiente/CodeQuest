import type { PluginDefinition } from "../../lib/plugins/types";
import manifest from "./manifest.json";
import { handlers } from "./index";

export const socraticHints: PluginDefinition = {
  manifest: manifest as PluginDefinition["manifest"],
  handlers,
};
