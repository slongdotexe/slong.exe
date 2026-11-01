import { copyFile, mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { build, type BuildOptions } from "esbuild";

const bundleOptions: BuildOptions = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};

export async function buildCacheArtifact(outputDirectory: URL) {
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(
    new URL("./template.yaml", import.meta.url),
    new URL("template.yaml", outputDirectory),
  );
  await build({
    ...bundleOptions,
    entryPoints: [new URL("./src/worker.ts", import.meta.url).pathname],
    outfile: new URL("worker/index.mjs", outputDirectory).pathname,
  });
}

export async function buildPreviewHandler(outputDirectory: URL) {
  await build({
    ...bundleOptions,
    entryPoints: [new URL("./src/routing/index.ts", import.meta.url).pathname],
    outfile: new URL("index.mjs", outputDirectory).pathname,
  });
}

export async function buildCacheRuntime(
  outputDirectory = new URL("./dist/cache/", import.meta.url),
) {
  await build({
    ...bundleOptions,
    entryPoints: [new URL("./src/tags.ts", import.meta.url).pathname],
    outfile: new URL("tags.mjs", outputDirectory).pathname,
    packages: "external",
  });
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const mode = process.argv[2];
  if (
    process.argv.length > 4 ||
    !["cache", "routing", "runtime"].includes(mode)
  ) {
    throw new Error(
      "Usage: node build.ts cache|routing|runtime [OUTPUT_DIRECTORY]",
    );
  }
  const outputDirectory = process.argv[3]
    ? pathToFileURL(resolve(process.argv[3]) + sep)
    : new URL(
        mode === "runtime" ? "./dist/cache/" : `./out/${mode}/`,
        import.meta.url,
      );
  if (mode === "cache") await buildCacheArtifact(outputDirectory);
  else if (mode === "routing") await buildPreviewHandler(outputDirectory);
  else await buildCacheRuntime(outputDirectory);
}
