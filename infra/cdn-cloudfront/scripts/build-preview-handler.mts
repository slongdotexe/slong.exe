import { buildPreviewHandler } from "@slongdotexe/application-infrastructure/build";

await buildPreviewHandler(
  new URL("../out/preview-routing-resource/", import.meta.url),
);
