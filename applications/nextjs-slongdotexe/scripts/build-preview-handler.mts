import { buildPreviewHandler } from "@slongdotexe/application-runtime/build";

await buildPreviewHandler(
  new URL(
    "../infra/templates/application/out/preview-routing-resource/",
    import.meta.url,
  ),
);
