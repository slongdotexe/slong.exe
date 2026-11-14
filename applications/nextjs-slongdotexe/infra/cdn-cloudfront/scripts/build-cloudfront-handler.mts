import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { transform } from "esbuild";

/**
 * Strip TypeScript without bundling or wrapping the CloudFront entry point.
 * @returns {Promise<string>} JavaScript for the cloudfront-js-2.0 runtime.
 */
export async function buildCloudFrontHandler() {
  const source = await fs.readFile(
    new URL(
      "../src/handlers/origin-request-routing-handler/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const result = await transform(source, {
    loader: "ts",
    target: "es2017",
    format: "esm",
    treeShaking: false,
    minify: false,
    sourcemap: false,
    legalComments: "none",
  });
  if (Buffer.byteLength(result.code, "utf8") > 10240) {
    throw new Error("CloudFront Functions code must not exceed 10 KB");
  }
  return result.code;
}

/** Build the JSON property fragment consumed by CloudFormation's AWS::Include transform. */
export async function buildCloudFrontArtifact(
  directory = new URL("../out/cloudfront-function/", import.meta.url),
) {
  const code = await buildCloudFrontHandler();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(new URL("index.js", directory), code);
  await fs.writeFile(
    new URL("code.json", directory),
    JSON.stringify({ FunctionCode: code }),
  );
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await buildCloudFrontArtifact();
}
