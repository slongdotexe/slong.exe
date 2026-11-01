import { defineConfig } from "@eslint/config-helpers";
import js from "@eslint/js";
import Shopify from "@shopify/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintComments from "eslint-plugin-eslint-comments";
import Import from "eslint-plugin-import";
import globals from "globals";
import typescriptEslint from "typescript-eslint";

const typescriptFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

export default defineConfig([
  js.configs.recommended,
  Import.flatConfigs.recommended,
  {
    plugins: {
      "eslint-comments": eslintComments,
    },
    rules: eslintComments.configs.recommended.rules,
  },
  {
    plugins: {
      "@shopify": Shopify,
    },
    languageOptions: {
      globals: {
        Atomics: "readonly",
        SharedArrayBuffer: "readonly",
        ...globals.browser,
        ...globals.es6,
        ...globals.node,
      },
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "import/extensions": 0,
      "import/no-unresolved": 0,
      "no-use-before-define": "error",
      "no-shadow": "error",
      "no-unused-vars": ["error", { caughtErrors: "none" }],
      "import/order": [
        2,
        {
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "arrow-body-style": 2,
      quotes: [2, "single"],
      "@shopify/prefer-early-return": 1,
      "import/prefer-default-export": "off",
      "eslint-comments/require-description": [
        "error",
        { ignore: ["eslint-env"] },
      ],
      "import/no-extraneous-dependencies": [
        "off",
        {
          devDependencies: false,
          optionalDependencies: false,
          peerDependencies: false,
        },
      ],
      "no-plusplus": [
        "error",
        {
          allowForLoopAfterthoughts: true,
        },
      ],
      "eslint-comments/disable-enable-pair": "off",
      "react/function-component-definition": "off",
      "react/no-unescaped-entities": "off",
      "no-underscore-dangle": "error",
      "no-constant-binary-expression": "off",
      "no-empty-static-block": "off",
      "no-new-native-nonconstructor": "off",
      "no-unused-private-class-members": "off",
    },
  },
  {
    files: typescriptFiles,
    extends: typescriptEslint.configs.recommended,
    languageOptions: {
      globals: {
        Atomics: "readonly",
        SharedArrayBuffer: "readonly",
        ...globals.browser,
        ...globals.es6,
        ...globals.node,
      },
    },
    rules: {
      "@shopify/typescript-prefer-pascal-case-enums": "error",
      "@shopify/typescript-prefer-singular-enums": "error",
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": ["error"],
      "import/extensions": "off",
      "import/no-unresolved": "off",
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": "error",
      "no-undef": "off",
      "no-unused-vars": ["off", { caughtErrors: "none" }],
      "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }],
      "no-constant-binary-expression": "off",
      "no-empty-static-block": "off",
      "no-new-native-nonconstructor": "off",
      "no-unused-private-class-members": "off",
    },
  },
  eslintConfigPrettier,
]);

const _something = "";
