import baseConfig from "@slongdotexe/eslint-config/base";

export default [
  {
    ignores: ["node_modules", "out", "dist"],
  },
  ...baseConfig,
];
