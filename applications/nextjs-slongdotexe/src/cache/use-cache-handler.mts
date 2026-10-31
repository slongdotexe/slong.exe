import { serialize, deserialize } from "node:v8";
import { S3ServiceException } from "@aws-sdk/client-s3";
import type {
  CacheEntry,
  CacheHandler,
} from "next/dist/server/lib/cache-handlers/types.js";
import * as runtime from "./runtime.mts";

type StoredEntry = Omit<CacheEntry, "value"> & { value: Buffer };
const pendingSets = new Map<string, Promise<void>>();
const memory = new Map<string, StoredEntry>();
const expiredTags = new Map<string, number>();
const maxMemoryBytes = 50 * 1024 * 1024;
let memoryBytes = 0;

function configuration() {
  if (
    !process.env.CACHE_BUCKET_NAME &&
    !process.env.CACHE_TABLE_NAME &&
    !process.env.CACHE_KEY_PREFIX
  )
    return null;
  const config = runtime.configuration();
  return { ...config, namespace: `${config.namespace}/use-cache` };
}

function remember(cacheKey: string, entry: StoredEntry) {
  const previous = memory.get(cacheKey);
  if (previous) {
    memoryBytes -= previous.value.byteLength;
    memory.delete(cacheKey);
  }
  if (entry.value.byteLength > maxMemoryBytes) return;
  memory.set(cacheKey, entry);
  memoryBytes += entry.value.byteLength;
  while (memoryBytes > maxMemoryBytes || memory.size > 100) {
    const oldest = memory.entries().next().value;
    if (!oldest) break;
    memoryBytes -= oldest[1].value.byteLength;
    memory.delete(oldest[0]);
  }
}

const handler: CacheHandler = {
  async get(cacheKey, softTags = []) {
    await pendingSets.get(cacheKey);
    try {
      const config = configuration();
      let entry: StoredEntry | undefined;
      if (config) {
        const response = await runtime.s3.send(
          new runtime.GetObjectCommand({
            Bucket: config.bucket,
            Key: runtime.objectKey(config, cacheKey),
          }),
        );
        if (!response.Body) return undefined;
        entry = deserialize(
          Buffer.from(await response.Body.transformToByteArray()),
        ) as StoredEntry;
      } else {
        entry = memory.get(cacheKey);
      }
      if (!entry) return undefined;
      const tags = [...entry.tags, ...softTags];
      if (
        tags.some(
          (tag) => (expiredTags.get(tag) ?? -Infinity) >= entry.timestamp,
        )
      )
        return undefined;
      if (config && (await runtime.invalidated(config, tags, entry.timestamp)))
        return undefined;
      const value = entry.value;
      return {
        ...entry,
        value: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(value));
            controller.close();
          },
        }),
      };
    } catch (error) {
      if (
        !(error instanceof S3ServiceException) ||
        (error.name !== "NoSuchKey" && error.$metadata.httpStatusCode !== 404)
      ) {
        console.error("use cache read failed", {
          error: error instanceof Error ? error.name : "UnknownError",
        });
      }
      return undefined;
    }
  },

  async set(cacheKey, pendingEntry) {
    const { promise: pending, resolve: finish } = Promise.withResolvers<void>();
    pendingSets.set(cacheKey, pending);
    try {
      const entry = await pendingEntry;
      const value = Buffer.from(await new Response(entry.value).arrayBuffer());
      const stored = { ...entry, value };
      const config = configuration();
      if (config) {
        await runtime.s3.send(
          new runtime.PutObjectCommand({
            Bucket: config.bucket,
            Key: runtime.objectKey(config, cacheKey),
            Body: serialize(stored),
            ContentType: "application/octet-stream",
          }),
        );
      } else {
        remember(cacheKey, stored);
      }
    } catch (error) {
      console.error("use cache write failed", {
        error: error instanceof Error ? error.name : "UnknownError",
      });
    } finally {
      finish();
      if (pendingSets.get(cacheKey) === pending) pendingSets.delete(cacheKey);
    }
  },

  async refreshTags() {},
  async getExpiration() {
    return Infinity;
  },
  async updateTags(tags) {
    if (!tags.length) return;
    const config = configuration();
    if (config) await runtime.enqueue(config, tags);
    const timestamp = Date.now();
    for (const tag of tags) expiredTags.set(tag, timestamp);
  },
};

export default handler;