import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Plain Node.js scripts / bridges — not part of the Next.js app.
    "scripts/**",
  ]),
  {
    rules: {
      // Pre-dates the React Compiler rules that ship with Next 16. Warn until
      // the effects that seed state on mount are reworked.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
