import {
  CloudFrontKeyValueStoreClient,
  DeleteKeyCommand,
  DescribeKeyValueStoreCommand,
  GetKeyCommand,
  PutKeyCommand,
} from "@aws-sdk/client-cloudfront-keyvaluestore";
import "@aws-sdk/signature-v4a";
import type { SSMClient } from "@aws-sdk/client-ssm";
import type { CloudFormationCustomResourceEvent, Context } from "aws-lambda";

import { publishParameters, resolveRouteProperties } from "./parameters.ts";
import { parseParameterProperties, parseRouteProperties } from "./types.ts";
import type { PreviewRoute, ResourceEvent, RouteProperties } from "./types.ts";

const client = new CloudFrontKeyValueStoreClient({ region: "us-east-1" });

function isMissing(error: unknown) {
  return error instanceof Error && error.name === "ResourceNotFoundException";
}

function isConflict(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "ConflictException" ||
      error.name === "PreconditionFailedException")
  );
}

async function existingRoute(
  storeClient: CloudFrontKeyValueStoreClient,
  properties: RouteProperties,
): Promise<PreviewRoute | undefined> {
  try {
    const { Value } = await storeClient.send(
      new GetKeyCommand({
        KvsARN: properties.StoreArn,
        Key: properties.Hostname,
      }),
    );
    const parsed: unknown = JSON.parse(Value ?? "null");
    if (parsed === null) return undefined;
    if (
      typeof parsed !== "object" ||
      !("domainName" in parsed) ||
      typeof parsed.domainName !== "string" ||
      !("revisionId" in parsed) ||
      typeof parsed.revisionId !== "string" ||
      !("ownerId" in parsed) ||
      typeof parsed.ownerId !== "string"
    )
      throw new Error("Invalid stored preview route");
    return {
      domainName: parsed.domainName,
      revisionId: parsed.revisionId,
      ownerId: parsed.ownerId,
    };
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function attemptRouteMutation(
  storeClient: CloudFrontKeyValueStoreClient,
  properties: RouteProperties,
  ownerId: string,
  remove: boolean,
  attempt: number,
): Promise<void> {
  try {
    const { ETag } = await storeClient.send(
      new DescribeKeyValueStoreCommand({ KvsARN: properties.StoreArn }),
    );
    if (!ETag) throw new Error("Routing store did not return an ETag");
    const existing = await existingRoute(storeClient, properties);
    if (remove) {
      if (!existing || existing.ownerId !== ownerId) return;
      await storeClient.send(
        new DeleteKeyCommand({
          KvsARN: properties.StoreArn,
          Key: properties.Hostname,
          IfMatch: ETag,
        }),
      );
    } else {
      if (existing && existing.ownerId !== ownerId)
        throw new Error("Preview hostname is already owned by another stack");
      await storeClient.send(
        new PutKeyCommand({
          KvsARN: properties.StoreArn,
          Key: properties.Hostname,
          IfMatch: ETag,
          Value: JSON.stringify({
            domainName: properties.DomainName,
            revisionId: properties.RevisionId,
            ownerId,
          }),
        }),
      );
    }
    return;
  } catch (error) {
    if (remove && isMissing(error)) return;
    if (!isConflict(error) || attempt === 9) throw error;
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(100 * 2 ** attempt, 2000) + Math.random() * 100,
      ),
    );
    return attemptRouteMutation(
      storeClient,
      properties,
      ownerId,
      remove,
      attempt + 1,
    );
  }
}

export async function mutateRoute(
  storeClient: CloudFrontKeyValueStoreClient,
  properties: RouteProperties,
  ownerId: string,
  remove: boolean,
): Promise<void> {
  return attemptRouteMutation(storeClient, properties, ownerId, remove, 0);
}

export async function synchronizeRoute(
  event: ResourceEvent,
  storeClient = client,
) {
  const ownerId = event.StackId + "/" + event.LogicalResourceId;
  const properties = event.ResourceProperties;
  if (event.RequestType === "Delete") {
    await mutateRoute(storeClient, properties, ownerId, true);
    return ownerId;
  }
  const isConfiguration = properties.Hostname === "config:preview-domain";
  const validDestination = isConfiguration
    ? /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(properties.DomainName)
    : /^[a-zA-Z0-9.-]+\.lambda-web\.[a-z0-9-]+\.on\.aws$/.test(
        properties.DomainName,
      );
  if (
    (!isConfiguration &&
      !/^pr-[0-9]+\.[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(properties.Hostname)) ||
    !validDestination ||
    typeof properties.RevisionId !== "string" ||
    !properties.RevisionId
  ) {
    throw new Error("Invalid preview route properties");
  }
  await mutateRoute(storeClient, properties, ownerId, false);
  if (event.RequestType === "Update") {
    const previous = event.OldResourceProperties;
    if (
      previous.StoreArn !== properties.StoreArn ||
      previous.Hostname !== properties.Hostname
    ) {
      await mutateRoute(storeClient, previous, ownerId, true);
    }
  }
  return ownerId;
}

async function resolveEvent<Properties>(
  event: CloudFormationCustomResourceEvent,
  resolveProperties: (properties: unknown) => Promise<Properties>,
): Promise<ResourceEvent<Properties>> {
  const properties = await resolveProperties(event.ResourceProperties);
  if (event.RequestType === "Update") {
    return {
      ...event,
      ResourceProperties: properties,
      OldResourceProperties: await resolveProperties(
        event.OldResourceProperties,
      ),
    };
  }
  return { ...event, ResourceProperties: properties };
}

export async function synchronizeResource(
  event: CloudFormationCustomResourceEvent,
  storeClient = client,
  parameterClient?: SSMClient,
): Promise<{ physicalResourceId: string; data: Record<string, string> }> {
  if (event.ResourceType === "Custom::PreviewParameters") {
    const normalized = await resolveEvent(event, async (properties) =>
      parseParameterProperties(properties),
    );
    return {
      physicalResourceId: await publishParameters(normalized, parameterClient),
      data: {},
    };
  }
  const normalized = await resolveEvent(event, (properties) =>
    resolveRouteProperties(parseRouteProperties(properties), parameterClient),
  );
  return {
    physicalResourceId: await synchronizeRoute(normalized, storeClient),
    data: { PreviewUrl: "https://" + normalized.ResourceProperties.Hostname },
  };
}

async function resourceResponse(
  event: CloudFormationCustomResourceEvent,
  context: Context,
) {
  try {
    const result = await synchronizeResource(event);
    return {
      Status: "SUCCESS",
      Reason: "Preview route synchronized",
      PhysicalResourceId: result.physicalResourceId,
      Data: result.data,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Preview routing failed";
    console.error("Preview routing failed", {
      requestId: context.awsRequestId,
      reason,
    });
    return {
      Status: "FAILED",
      Reason: reason.slice(0, 1000),
      PhysicalResourceId: event.StackId + "/" + event.LogicalResourceId,
      Data: {},
    };
  }
}

export async function handler(
  event: CloudFormationCustomResourceEvent,
  context: Context,
) {
  const result = await resourceResponse(event, context);
  const response = await fetch(event.ResponseURL, {
    method: "PUT",
    headers: { "content-type": "" },
    body: JSON.stringify({
      ...result,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      NoEcho: false,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error("CloudFormation response failed: " + response.status);
}
