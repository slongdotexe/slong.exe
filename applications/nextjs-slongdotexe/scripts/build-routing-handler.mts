import { build } from "esbuild";

export async function buildPreviewHandler(outputDirectory: URL) {
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    entryPoints: [new URL("../src/routing/index.ts", import.meta.url).pathname],
    outfile: new URL("index.mjs", outputDirectory).pathname,
  });
}