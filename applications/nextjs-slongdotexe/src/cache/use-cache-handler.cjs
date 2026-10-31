/* eslint-disable @typescript-eslint/no-require-imports */
const { serialize, deserialize } = require("node:v8");

const runtime = require("./runtime.cjs");

const pendingSets = new Map();
const memory = new Map();
const expiredTags = new Map();
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
  // Keep streaming entries separate from the incremental handler's opaque payloads.
  return { ...config, namespace: `${config.namespace}/use-cache` };
}

function remember(cacheKey, entry) {
  if (memory.has(cacheKey)) {
    memoryBytes -= memory.get(cacheKey).value.byteLength;
    memory.delete(cacheKey);
  }
  if (entry.value.byteLength > maxMemoryBytes) return;
  memory.set(cacheKey, entry);
  memoryBytes += entry.value.byteLength;
  while (memoryBytes > maxMemoryBytes || memory.size > 100) {
    const oldestKey = memory.keys().next().value;
    memoryBytes -= memory.get(oldestKey).value.byteLength;
    memory.delete(oldestKey);
  }
}

// Next.js 16 CacheHandler. Export an object, not the incremental handler class.
module.exports = {
  async get(cacheKey, softTags = []) {
    await pendingSets.get(cacheKey);
    try {
      const config = configuration();
      let entry;
      if (config) {
        const response = await runtime.s3.send(
          new runtime.GetObjectCommand({
            Bucket: config.bucket,
            Key: runtime.objectKey(config, cacheKey),
          }),
        );
        entry = deserialize(
          Buffer.from(await response.Body.transformToByteArray()),
        );
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

      return {
        ...entry,
        value: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(entry.value));
            controller.close();
          },
        }),
      };
    } catch (error) {
      if (
        error.name !== "NoSuchKey" &&
        error.$metadata?.httpStatusCode !== 404
      ) {
        console.error("use cache read failed", { error: error.name });
      }
      return undefined;
    }
  },

  async set(cacheKey, pendingEntry) {
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    pendingSets.set(cacheKey, pending);
    try {
      const entry = await pendingEntry;
      // Only report tags supplied with this entry. No route is inferred from
      // earlier reads: Next normally supplies soft tags to get(), not set().

      const value = Buffer.from(await new Response(entry.value).arrayBuffer());
      const stored = { ...entry, value };
      const config = configuration();
      if (config) {
        // Consume the entire stream before the atomic PutObject. Never persist a
        // partial render, or retain the request's stream/promise in a local cache.
        await runtime.s3.send(
          new runtime.PutObjectCommand({
            Bucket: config.bucket,
            Key: runtime.objectKey(config, cacheKey),
            Body: serialize(stored),
            ContentType: "application/octet-stream",
          }),
        );
      } else {
        // Local development without AWS resources still exercises this adapter.
        remember(cacheKey, stored);
      }
    } catch (error) {
      console.error("use cache write failed", { error: error.name });
    } finally {
      finish();
      if (pendingSets.get(cacheKey) === pending) pendingSets.delete(cacheKey);
    }
  },

  async refreshTags() {
    // No stale local replica: get() reads shared timestamps consistently on demand.
  },

  async getExpiration(tags) {
    // The public contract uses Infinity to pass soft tags through to get().
    return Infinity;
  },

  async updateTags(tags, _durations) {
    if (!tags.length) return;
    const config = configuration();
    if (config) await runtime.enqueue(config, tags);
    // The calling process sees its own invalidation immediately; other instances
    // see it once the FIFO worker updates shared DynamoDB timestamps.
    const timestamp = Date.now();
    for (const tag of tags) expiredTags.set(tag, timestamp);
  },
};
