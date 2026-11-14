import { buildPreviewHandler } from "@slongdotexe/application-runtime/build";

await buildPreviewHandler(
  new URL("../out/preview-routing-resource/", import.meta.url),
);
