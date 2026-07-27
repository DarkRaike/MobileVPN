import eslint from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "artifacts/**",
      "contracts/marzban/openapi.v0.8.4.json",
      "node_modules/**",
      "vpn-mini-app.html",
    ],
  },
  eslint.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      globals: globals.node,
      sourceType: "module",
    },
  },
];
