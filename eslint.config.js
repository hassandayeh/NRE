// eslint.config.js — Flat config for ESLint v9+ (Next.js + TypeScript)

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/** Ignore build artifacts and vendor dirs */
export const ignores = [
  "node_modules",
  ".next",
  ".vercel",
  "dist",
  "build",
  "coverage",
  "out",
];

/** Base JS rules (applies to .js/.mjs/.cjs) */
const baseJs = {
  files: ["**/*.{js,mjs,cjs}"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: {
      ...globals.browser,
      ...globals.node,
    },
  },
  ...js.configs.recommended,
  rules: {
    ...js.configs.recommended.rules,
    "no-console": "off",
    "no-unused-vars": "warn",
  },
};

/** TS rules (applies to .ts/.tsx) — no parserOptions.project required */
const baseTs = {
  files: ["**/*.{ts,tsx}"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
    globals: {
      ...globals.browser,
      ...globals.node,
    },
  },
  plugins: {
    "@typescript-eslint": tseslint.plugin,
    "react-hooks": reactHooks,
  },
  rules: {
    // Typescript ESLint recommended (non-type-checked)
    ...tseslint.configs.recommended.rules,

    // React hooks sanity — important for Next.js app router
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",

    // Mild defaults
    "no-console": "off",
    "no-unused-vars": "off", // let TS handle unused vars warnings instead
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
};

export default [{ ignores }, baseJs, baseTs];
