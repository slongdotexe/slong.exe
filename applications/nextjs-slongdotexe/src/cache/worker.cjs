/* eslint-disable @typescript-eslint/no-require-imports */
const runtime = require("./runtime.cjs");

exports.handler = async (event) => {
  const failures = [];
  // Stop after a failure to preserve FIFO ordering, including unprocessed records.
  for (const record of event.Records) {
    if (failures.length) {
      failures.push({ itemIdentifier: record.messageId });
      continue;
    }
    try {
      const { tag, invalidatedAt, prefix = process.env.CACHE_KEY_PREFIX } = JSON.parse(record.body);
      const previewPrefix = process.env.CACHE_PREVIEW_PREFIX;
      if (
        typeof tag !== "string" ||
        !tag ||
        !Number.isSafeInteger(invalidatedAt) ||
        invalidatedAt < 0 ||
        typeof prefix !== "string" ||
        (prefix !== process.env.CACHE_KEY_PREFIX &&
          !(previewPrefix && prefix.startsWith(previewPrefix) &&
            /^[0-9]+$/.test(prefix.slice(previewPrefix.length))))
      ) {
        throw new Error("Invalid queue message");
      }
      const config = {
        table: process.env.CACHE_TABLE_NAME,
        prefix,
      };
      if (!config.table || !config.prefix)
        throw new Error("Missing tag store configuration");
      // Use the producer's timestamp so delayed/retried messages cannot invalidate
      // fresh data written after the original request or move tombstones backward.
      await runtime.invalidateTags(config, [tag], invalidatedAt);
    } catch (error) {
      console.error("Queued revalidation failed", {
        messageId: record.messageId,
        error: error.message,
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};
