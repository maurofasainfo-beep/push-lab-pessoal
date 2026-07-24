import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "apps/web/dist/**",
      "supabase/functions/**"
    ]
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "tests/**/*.ts", "scripts/**/*.mjs"],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { "allow": ["warn", "error"] }]
    }
  },
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-console": "off"
    }
  }
);
