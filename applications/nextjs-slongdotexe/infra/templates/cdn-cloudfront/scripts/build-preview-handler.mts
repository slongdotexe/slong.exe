import { buildPreviewHandler } from "../../../../scripts/build-routing-handler.mts";

await buildPreviewHandler(
  new URL("../out/preview-routing-resource/", import.meta.url),
);
