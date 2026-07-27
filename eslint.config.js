import eslint from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      ".svelte-kit/**",
      "artifacts/**",
      "build/**",
      "contracts/marzban/openapi.v0.8.4.json",
      "drizzle/**",
      "node_modules/**",
      "vpn-mini-app.html",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.ts"],
    languageOptions: {
      ecmaVersion: 2024,
      globals: globals.node,
      sourceType: "module",
    },
  },
];
