import { serialize, deserialize } from "node:v8";
import { S3ServiceException } from "@aws-sdk/client-s3";
import type {
  CacheHandler,
  CacheHandlerValue,
} from "next/dist/server/lib/incremental-cache/index.js";
import * as runtime from "./runtime.mts";

type StoredEntry = CacheHandlerValue & { tags: string[] };

export default class SharedCacheHandler implements CacheHandler {
  private config: runtime.CacheConfiguration | null;

  constructor() {
    const configured =
      process.env.CACHE_BUCKET_NAME ||
      process.env.CACHE_TABLE_NAME ||
      process.env.CACHE_KEY_PREFIX;
    this.config = configured ? runtime.configuration() : null;
  }

  async get(
    key: string,
    context?: Parameters<CacheHandler["get"]>[1],
  ): Promise<StoredEntry | null> {
    if (!this.config) return null;
    const tags = context && "tags" in context ? (context.tags ?? []) : [];
    const softTags =
      context && "softTags" in context ? (context.softTags ?? []) : [];
    let entry: StoredEntry;
    try {
      const response = await runtime.s3.send(
        new runtime.GetObjectCommand({
          Bucket: this.config.bucket,
          Key: runtime.objectKey(this.config, key),
        }),
      );
      if (!response.Body) return null;
      entry = deserialize(
        Buffer.from(await response.Body.transformToByteArray()),
      ) as StoredEntry;
    } catch (error) {
      if (
        !(error instanceof S3ServiceException) ||
        (error.name !== "NoSuchKey" && error.$metadata.httpStatusCode !== 404)
      ) {
        console.error("Shared cache read failed", {
          error: error instanceof Error ? error.name : "UnknownError",
        });
      }
      return null;
    }
    if (
      await runtime.invalidated(
        this.config,
        [...entry.tags, ...tags, ...softTags],
        entry.lastModified,
      )
    )
      return null;
    return entry;
  }

  async set(
    key: string,
    value: CacheHandlerValue["value"],
    context?: Parameters<CacheHandler["set"]>[2],
  ) {
    if (!this.config) return;
    const tags = context && "tags" in context ? (context.tags ?? []) : [];
    const entry: StoredEntry = { value, lastModified: Date.now(), tags };
    await runtime.s3.send(
      new runtime.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: runtime.objectKey(this.config, key),
        Body: serialize(entry),
        ContentType: "application/octet-stream",
      }),
    );
  }

  async revalidateTag(tags: string | string[]) {
    if (!this.config) return;
    await runtime.enqueue(
      this.config,
      typeof tags === "string" ? [tags] : tags,
    );
  }

  resetRequestCache() {}
}
