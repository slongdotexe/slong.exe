import { defineConfig } from "@eslint/config-helpers";
import js from "@eslint/js";
import Shopify from "@shopify/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintComments from "eslint-plugin-eslint-comments";
import Import from "eslint-plugin-import";
import globals from "globals";
import typescriptEslint from "typescript-eslint";

const shopifyTypescript = {
  ...Shopify,
  rules: Object.fromEntries(
    Object.entries(Shopify.rules)
      .filter(([name]) => name.startsWith("typescript/"))
      .map(([name, rule]) => [name.replace(/^typescript\//, ""), rule]),
  ),
};

const typescriptFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

const typescriptConfig = typescriptEslint.configs.recommended.map((config) => ({
  ...config,
  files: config.files ?? typescriptFiles,
}));

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
      "@shopify/typescript": shopifyTypescript,
    },
    languageOptions: {
      globals: {
        Atomics: "readonly",
        SharedArrayBuffer: "readonly",
        ...globals.browser,
        ...globals.es6,
        ...globals.node,
      },
      sourceType: "module",
      parserOptions: {
        ecmaVersion: 2020,
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
      "@shopify/typescript/prefer-pascal-case-enums": 2,
      "@shopify/typescript/prefer-singular-enums": 2,
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
  ...typescriptConfig,
  {
    files: typescriptFiles,
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
