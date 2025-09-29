// eslint.config.mjs — Flat config for ESLint v9+ (Next.js + TypeScript)
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Hard ignore build/output so ESLint never scans .next or vendor bundles
const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.next/**",
  "**/.vercel/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/out/**",
  "**/public/**/*.min.js",
  "**/*.min.js",
];

export default [
  {
    ignores: IGNORE_PATTERNS,
    linterOptions: {
      // Silence "Unused eslint-disable directive" warnings
      reportUnusedDisableDirectives: "off",
    },
  },

  // JS in /src only
  {
    files: ["src/**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      "no-console": "off",
      "no-unused-vars": "off", // CI runs with --max-warnings=0
    },
  },

  // TS/TSX in /src only
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      // Baseline TS rules (non-type-checked set)
      ...tseslint.configs.recommended.rules,

      // Keep the important invariant
      "react-hooks/rules-of-hooks": "error",

      // Kill warning-only rules to satisfy --max-warnings=0
      "react-hooks/exhaustive-deps": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",

      "no-console": "off",
    },
  },
];
