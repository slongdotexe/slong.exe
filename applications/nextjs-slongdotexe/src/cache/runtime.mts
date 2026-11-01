import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hash } from "@slongdotexe/application-infrastructure/cache";
export {
  dynamo,
  hash,
  invalidated,
  invalidateTags,
  UpdateItemCommand,
} from "@slongdotexe/application-infrastructure/cache";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

export type TagConfiguration = { prefix: string; table: string };
export type CacheConfiguration = TagConfiguration & {
  bucket: string;
  buildId: string;
  namespace: string;
};

const clientOptions = { maxAttempts: 3 };
export const s3 = new S3Client(clientOptions);
export const sqs = new SQSClient(clientOptions);
export { GetObjectCommand, PutObjectCommand };

export function configuration(
  serverDistDir = join(process.cwd(), ".next/server"),
): CacheConfiguration {
  const prefix = process.env.CACHE_KEY_PREFIX;
  const bucket = process.env.CACHE_BUCKET_NAME;
  const table = process.env.CACHE_TABLE_NAME;
  if (!prefix || !bucket || !table)
    throw new Error("Shared cache configuration is incomplete");
  const buildId =
    process.env.CACHE_BUILD_ID ||
    (process.env.NODE_ENV === "development"
      ? "development"
      : readFileSync(join(serverDistDir, "../BUILD_ID"), "utf8").trim());
  return { prefix, bucket, table, buildId, namespace: `${prefix}/${buildId}` };
}

export function objectKey(config: CacheConfiguration, key: string) {
  return `${config.namespace}/${hash(key)}.cache`;
}

export async function enqueue(config: TagConfiguration, tags: string[]) {
  if (!process.env.CACHE_REVALIDATION_QUEUE_URL)
    throw new Error("Missing revalidation queue URL");
  const invalidatedAt = Date.now();
  for (const tag of new Set(tags)) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.CACHE_REVALIDATION_QUEUE_URL,
        MessageBody: JSON.stringify({
          tag,
          invalidatedAt,
          prefix: config.prefix,
        }),
        MessageGroupId: hash(`${config.prefix}:${tag}`),
        MessageDeduplicationId: randomUUID(),
      }),
    );
  }
}
