import { defineConfig } from "@eslint/config-helpers";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

import baseConfig from "./eslint.base.config.mjs";

export default defineConfig([
  ...baseConfig,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs["recommended-latest"],
  {
    rules: {
      "react/jsx-filename-extension": [1, { extensions: [".tsx"] }],
      "react/require-default-props": 0,
      "react/prop-types": 0,
      "@shopify/jsx-prefer-fragment-wrappers": 1,
      "react/jsx-props-no-spreading": 0,
      "react/function-component-definition": [
        0,
        { namedComponents: "arrow-function" },
      ],
      "react/style-prop-object": 0,
    },
  },
]);
