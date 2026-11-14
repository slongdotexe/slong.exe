import { copyFile, mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export async function buildCacheArtifact(
  outputDirectory = new URL("./out/cache/", import.meta.url),
) {
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(
    new URL("./templates/cache/template.yaml", import.meta.url),
    new URL("template.yaml", outputDirectory),
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] !== "cache" || process.argv.length > 4)
    throw new Error("Usage: node build.mts cache [OUTPUT_DIRECTORY]");
  await buildCacheArtifact(process.argv[3]
    ? pathToFileURL(resolve(process.argv[3]) + sep)
    : undefined);
}