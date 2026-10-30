/* eslint-disable @typescript-eslint/no-require-imports */
const { serialize, deserialize } = require("node:v8");

const runtime = require("./runtime.cjs");

class SharedCacheHandler {
  constructor() {
    const configured =
      process.env.CACHE_BUCKET_NAME ||
      process.env.CACHE_TABLE_NAME ||
      process.env.CACHE_KEY_PREFIX;
    // Web Function builds without AWS resources deliberately bypass this cache.
    // Other builds do not configure this handler and retain Next's default cache.
    this.config = configured ? runtime.configuration() : null;
  }

  async get(key, { tags = [], softTags = [] } = {}) {
    if (!this.config) return null;
    let entry;
    try {
      const response = await runtime.s3.send(
        new runtime.GetObjectCommand({
          Bucket: this.config.bucket,
          Key: runtime.objectKey(this.config, key),
        }),
      );
      entry = deserialize(
        Buffer.from(await response.Body.transformToByteArray()),
      );
    } catch (error) {
      if (
        error.name !== "NoSuchKey" &&
        error.$metadata?.httpStatusCode !== 404
      ) {
        console.error("Shared cache read failed", { error: error.name });
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

  async set(key, value, { tags = [] } = {}) {
    if (!this.config) return;
    const entry = { value, lastModified: Date.now(), tags: entryTags };
    await runtime.s3.send(
      new runtime.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: runtime.objectKey(this.config, key),
        Body: serialize(entry),
        ContentType: "application/octet-stream",
      }),
    );
  }

  async revalidateTag(tags) {
    if (!this.config) return;
    await runtime.enqueue(
      this.config,
      typeof tags === "string" ? [tags] : tags,
    );
  }

  // There is no request-local cache to reset.
  resetRequestCache() {}
}

module.exports = SharedCacheHandler;
