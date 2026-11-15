import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Learner-facing prose uses typographic apostrophes intentionally.
      "react/no-unescaped-entities": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".data/**",
    "node_modules/**",
    "next-env.d.ts",
    "public/sw.js",
    "public/offline.html",
  ]),
]);
