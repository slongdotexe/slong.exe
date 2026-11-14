import type { SQSEvent, SQSBatchResponse } from "aws-lambda";

import { invalidateTags } from "./tags.ts";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures = await event.Records.reduce<
    Promise<SQSBatchResponse["batchItemFailures"]>
  >(async (pendingFailures, record) => {
    const accumulatedFailures = await pendingFailures;
    if (accumulatedFailures.length) {
      return [...accumulatedFailures, { itemIdentifier: record.messageId }];
    }
    try {
      const message: unknown = JSON.parse(record.body);
      const hasMessageFields =
        message !== null &&
        typeof message === "object" &&
        "tag" in message &&
        "invalidatedAt" in message;
      if (!hasMessageFields) throw new Error("Invalid queue message");
      const { tag, invalidatedAt } = message;
      const prefix =
        "prefix" in message && message.prefix !== undefined
          ? message.prefix
          : process.env.CACHE_KEY_PREFIX;
      const isValidTag = typeof tag === "string" && tag.length > 0;
      const isValidTimestamp =
        typeof invalidatedAt === "number" &&
        Number.isSafeInteger(invalidatedAt) &&
        invalidatedAt >= 0;
      const isStringPrefix = typeof prefix === "string";
      if (!isValidTag || !isValidTimestamp || !isStringPrefix)
        throw new Error("Invalid queue message");

      const isMainlinePrefix = prefix === process.env.CACHE_KEY_PREFIX;
      const previewPrefix = process.env.CACHE_PREVIEW_PREFIX;
      const previewNumber =
        previewPrefix && prefix.startsWith(previewPrefix)
          ? prefix.slice(previewPrefix.length)
          : "";
      const isValidPreviewPrefix = /^[0-9]+$/.test(previewNumber);
      const isAllowedPrefix = isMainlinePrefix || isValidPreviewPrefix;
      if (!isAllowedPrefix) throw new Error("Invalid queue message");

      const table = process.env.CACHE_TABLE_NAME;
      if (!table || !prefix) throw new Error("Missing tag store configuration");
      await invalidateTags({ table, prefix }, [tag], invalidatedAt);
      return accumulatedFailures;
    } catch (error) {
      console.error("Queued revalidation failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : "UnknownError",
      });
      return [...accumulatedFailures, { itemIdentifier: record.messageId }];
    }
  }, Promise.resolve([]));
  return { batchItemFailures: failures };
}
