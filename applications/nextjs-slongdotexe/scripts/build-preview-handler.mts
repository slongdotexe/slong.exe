import { buildPreviewHandler } from "./build-routing-handler.mts";

await buildPreviewHandler(
  new URL(
    "../infra/application/out/preview-routing-resource/",
    import.meta.url,
  ),
);
