import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { captureAWSv3Client } from "../utils/observability.mts";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
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
export const s3 = captureAWSv3Client(new S3Client(clientOptions));
export const dynamo = captureAWSv3Client(new DynamoDBClient(clientOptions));
export const sqs = captureAWSv3Client(new SQSClient(clientOptions));
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export { GetObjectCommand, PutObjectCommand, UpdateItemCommand };

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

function tagKey(config: TagConfiguration, tag: string) {
  return `${config.prefix}#tag#${hash(tag)}`;
}

export async function invalidated(
  config: TagConfiguration,
  tags: string[],
  lastModified: number,
) {
  const results = await Promise.all(
    [...new Set(tags)].map(async (tag) => {
      const result = await dynamo.send(
        new GetItemCommand({
          TableName: config.table,
          Key: { pk: { S: tagKey(config, tag) } },
          ConsistentRead: true,
          ProjectionExpression: "invalidatedAt",
        }),
      );
      return Number(result.Item?.invalidatedAt?.N || 0) >= lastModified;
    }),
  );
  return results.some(Boolean);
}

export async function invalidateTags(
  config: TagConfiguration,
  tags: string[],
  timestamp = Date.now(),
) {
  for (const tag of new Set(tags)) {
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: config.table,
          Key: { pk: { S: tagKey(config, tag) } },
          UpdateExpression: "SET invalidatedAt = :timestamp",
          ConditionExpression:
            "attribute_not_exists(invalidatedAt) OR invalidatedAt < :timestamp",
          ExpressionAttributeValues: { ":timestamp": { N: String(timestamp) } },
        }),
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== "ConditionalCheckFailedException"
      )
        throw error;
    }
  }
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
