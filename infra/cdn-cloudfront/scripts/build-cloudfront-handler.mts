import fs from "node:fs/promises";
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
