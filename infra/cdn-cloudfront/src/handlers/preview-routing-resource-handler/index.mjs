import {
  CloudFrontKeyValueStoreClient,
  DeleteKeyCommand,
  DescribeKeyValueStoreCommand,
  GetKeyCommand,
  PutKeyCommand,
} from "@aws-sdk/client-cloudfront-keyvaluestore";

/** @typedef {{ StoreArn: string, Hostname: string, DomainName: string, RevisionId: string }} RouteProperties */
/** @typedef {(Omit<import('aws-lambda').CloudFormationCustomResourceCreateEvent, 'ResourceProperties'> | Omit<import('aws-lambda').CloudFormationCustomResourceUpdateEvent, 'ResourceProperties' | 'OldResourceProperties'> & { OldResourceProperties: RouteProperties } | Omit<import('aws-lambda').CloudFormationCustomResourceDeleteEvent, 'ResourceProperties'>) & { ResourceProperties: RouteProperties }} ResourceEvent */
/** @typedef {{ domainName: string, revisionId: string, ownerId: string }} PreviewRoute */

const client = new CloudFrontKeyValueStoreClient({ region: "us-east-1" });

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissing(error) {
  return error instanceof Error && error.name === "ResourceNotFoundException";
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isConflict(error) {
  return (
    error instanceof Error &&
    (error.name === "ConflictException" ||
      error.name === "PreconditionFailedException")
  );
}

/**
 * Write or remove one owned entry using the store-wide ETag as a concurrency guard.
 * @param {CloudFrontKeyValueStoreClient} storeClient
 * @param {RouteProperties} properties
 * @param {string} ownerId
 * @param {boolean} remove
 * @returns {Promise<void>}
 */
export async function mutateRoute(storeClient, properties, ownerId, remove) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const { ETag } = await storeClient.send(
        new DescribeKeyValueStoreCommand({ KvsARN: properties.StoreArn }),
      );
      if (!ETag) {
        throw new Error("Routing store did not return an ETag");
      }
      /** @type {PreviewRoute | undefined} */
      let existing;
      try {
        const { Value } = await storeClient.send(
          new GetKeyCommand({
            KvsARN: properties.StoreArn,
            Key: properties.Hostname,
          }),
        );
        existing = JSON.parse(Value ?? "null");
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }
      if (remove) {
        if (!existing || existing.ownerId !== ownerId) {
          return;
        }
        await storeClient.send(
          new DeleteKeyCommand({
            KvsARN: properties.StoreArn,
            Key: properties.Hostname,
            IfMatch: ETag,
          }),
        );
      } else {
        if (existing && existing.ownerId !== ownerId) {
          throw new Error("Preview hostname is already owned by another stack");
        }
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
      if (remove && isMissing(error)) {
        return;
      }
      if (!isConflict(error) || attempt === 9) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(100 * 2 ** attempt, 2000) + Math.random() * 100,
        ),
      );
    }
  }
}

/**
 * @param {ResourceEvent} event
 * @param {CloudFrontKeyValueStoreClient} [storeClient]
 * @returns {Promise<string>}
 */
export async function synchronizeRoute(event, storeClient = client) {
  const ownerId = event.StackId + "/" + event.LogicalResourceId;
  const properties = event.ResourceProperties;
  if (event.RequestType === "Delete") {
    await mutateRoute(storeClient, properties, ownerId, true);
    return ownerId;
  }
  const isConfiguration = properties.Hostname === "config:development-domain";
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

/**
 * Register, update or remove a preview and acknowledge the CloudFormation callback.
 * @param {ResourceEvent} event
 * @param {import('aws-lambda').Context} context
 * @returns {Promise<void>}
 */
export async function handler(event, context) {
  let status = "SUCCESS";
  let reason = "Preview route synchronized";
  let physicalResourceId = event.StackId + "/" + event.LogicalResourceId;
  try {
    physicalResourceId = await synchronizeRoute(event);
  } catch (error) {
    status = "FAILED";
    reason = error instanceof Error ? error.message : "Preview routing failed";
    console.error("Preview routing failed", {
      requestId: context.awsRequestId,
      reason,
    });
  }
  const response = await fetch(event.ResponseURL, {
    method: "PUT",
    headers: { "content-type": "" },
    body: JSON.stringify({
      Status: status,
      Reason: reason.slice(0, 1000),
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      NoEcho: false,
      Data: {},
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error("CloudFormation response failed: " + response.status);
  }
}
