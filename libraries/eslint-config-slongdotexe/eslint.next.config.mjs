import { defineConfig } from "@eslint/config-helpers";
import nextPlugin from "@next/eslint-plugin-next";

import reactConfig from "./eslint.react.config.mjs";

export default defineConfig([
  ...reactConfig,
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: nextPlugin.configs.recommended.rules,
  },
]);
