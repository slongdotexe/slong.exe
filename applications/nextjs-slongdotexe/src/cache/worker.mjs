import { invalidateTags } from "./runtime.mts";

export async function handler(event) {
  const failures = [];
  for (const record of event.Records) {
    if (failures.length) {
      failures.push({ itemIdentifier: record.messageId });
      continue;
    }
    try {
      const message = JSON.parse(record.body);
      if (!message || typeof message !== "object")
        throw new Error("Invalid queue message");
      const {
        tag,
        invalidatedAt,
        prefix = process.env.CACHE_KEY_PREFIX,
      } = message;
      const previewPrefix = process.env.CACHE_PREVIEW_PREFIX;
      if (
        typeof tag !== "string" ||
        !tag ||
        typeof invalidatedAt !== "number" ||
        !Number.isSafeInteger(invalidatedAt) ||
        invalidatedAt < 0 ||
        typeof prefix !== "string" ||
        (prefix !== process.env.CACHE_KEY_PREFIX &&
          !(
            previewPrefix &&
            prefix.startsWith(previewPrefix) &&
            /^[0-9]+$/.test(prefix.slice(previewPrefix.length))
          ))
      ) {
        throw new Error("Invalid queue message");
      }
      const table = process.env.CACHE_TABLE_NAME;
      if (!table || !prefix) throw new Error("Missing tag store configuration");
      await invalidateTags({ table, prefix }, [tag], invalidatedAt);
    } catch (error) {
      console.error("Queued revalidation failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : "UnknownError",
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}
