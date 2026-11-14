import { createHash } from "node:crypto";

import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

export type TagConfiguration = { prefix: string; table: string };
export const dynamo = new DynamoDBClient({ maxAttempts: 3 });
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export { UpdateItemCommand };

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
          Key: { pk: { S: `${config.prefix}#tag#${hash(tag)}` } },
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
          Key: { pk: { S: `${config.prefix}#tag#${hash(tag)}` } },
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
