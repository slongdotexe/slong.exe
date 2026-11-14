import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export async function buildPreviewHandler(
  outputDirectory = new URL("./out/routing/", import.meta.url),
) {
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    entryPoints: [new URL("./src/routing/index.ts", import.meta.url).pathname],
    outfile: new URL("index.mjs", outputDirectory).pathname,
  });
}

export async function buildCacheRuntime(
  outputDirectory = new URL("./dist/cache/", import.meta.url),
) {
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    entryPoints: [new URL("./src/tags.ts", import.meta.url).pathname],
    outfile: new URL("tags.mjs", outputDirectory).pathname,
    packages: "external",
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const mode = process.argv[2];
  if (process.argv.length > 4 || !["cache", "routing"].includes(mode))
    throw new Error("Usage: node build.ts cache|routing [OUTPUT_DIRECTORY]");
  const outputDirectory = process.argv[3]
    ? pathToFileURL(resolve(process.argv[3]) + sep)
    : undefined;
  if (mode === "cache") await buildCacheRuntime(outputDirectory);
  else await buildPreviewHandler(outputDirectory);
}