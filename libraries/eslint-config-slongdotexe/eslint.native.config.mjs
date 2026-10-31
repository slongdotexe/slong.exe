import { defineConfig } from "@eslint/config-helpers";

import reactConfig from "./eslint.react.config.mjs";

export default defineConfig([
  ...reactConfig,
  {
    languageOptions: {
      globals: {
        __DEV__: "readonly",
        FormData: "readonly",
        fetch: "readonly",
        navigator: "readonly",
        requestAnimationFrame: "readonly",
      },
    },
  },
]);
