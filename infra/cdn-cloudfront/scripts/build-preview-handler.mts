import { build } from "esbuild";

await build({
  entryPoints: [
    new URL(
      "../src/handlers/preview-routing-resource-handler/index.mjs",
      import.meta.url,
    ).pathname,
  ],
  outfile: new URL("../out/preview-routing-resource/index.mjs", import.meta.url)
    .pathname,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
