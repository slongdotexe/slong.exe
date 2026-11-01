import {
  DeleteParameterCommand,
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";

import type {
  ParameterProperties,
  PreviewProperties,
  ResourceEvent,
  RouteProperties,
} from "./types.ts";

function isMissing(error: unknown) {
  return error instanceof Error && error.name === "ParameterNotFound";
}

async function parameterValue(
  client: SSMClient,
  name: string,
): Promise<string | undefined> {
  try {
    const result = await client.send(new GetParameterCommand({ Name: name }));
    return result.Parameter?.Value;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function publishParameters(
  event: ResourceEvent<ParameterProperties>,
  client = new SSMClient({ region: event.ResourceProperties.TargetRegion }),
) {
  const properties = event.ResourceProperties;
  const prefix = properties.ParameterPrefix;
  const ownerId = event.StackId + "/" + event.LogicalResourceId;
  const ownerName = prefix + "/owner";
  const values = {
    "distribution-id": properties.DistributionId,
    "routing-store-arn": properties.StoreArn,
    "preview-domain": properties.DomainName,
  };
  if (
    event.RequestType === "Update" &&
    (event.OldResourceProperties.TargetRegion !== properties.TargetRegion ||
      event.OldResourceProperties.ParameterPrefix !== prefix)
  )
    throw new Error(
      "Parameter publication region and prefix cannot change in place",
    );
  const owner = await parameterValue(client, ownerName);
  if (owner !== undefined && owner !== ownerId) {
    if (event.RequestType === "Delete") return ownerId;
    throw new Error("Preview parameter namespace is owned by another stack");
  }
  if (event.RequestType === "Delete") {
    if (owner !== ownerId) return ownerId;
    for (const name of [
      ...Object.keys(values).map((key) => prefix + "/" + key),
      ownerName,
    ]) {
      try {
        await client.send(new DeleteParameterCommand({ Name: name }));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    return ownerId;
  }
  if (!owner) {
    for (const key of Object.keys(values)) {
      if ((await parameterValue(client, prefix + "/" + key)) !== undefined) {
        throw new Error("Refusing to overwrite an unowned preview parameter");
      }
    }
    await client.send(
      new PutParameterCommand({
        Name: ownerName,
        Value: ownerId,
        Type: "String",
        Overwrite: false,
      }),
    );
  }
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string" || !value)
      throw new Error("Missing preview publication value: " + key);
    await client.send(
      new PutParameterCommand({
        Name: prefix + "/" + key,
        Value: value,
        Type: "String",
        Overwrite: true,
      }),
    );
  }
  return ownerId;
}

export async function resolveRouteProperties(
  properties: RouteProperties | PreviewProperties,
  client = new SSMClient({}),
): Promise<RouteProperties> {
  if (!("ParameterPrefix" in properties)) return properties;
  const storeArn = await parameterValue(
    client,
    properties.ParameterPrefix + "/routing-store-arn",
  );
  const domain = await parameterValue(
    client,
    properties.ParameterPrefix + "/preview-domain",
  );
  if (!storeArn || !domain)
    throw new Error(
      "Deploy the ephemeral CDN to publish preview parameters first",
    );
  return {
    StoreArn: storeArn,
    Hostname: properties.PreviewName + "." + domain,
    DomainName: properties.DomainName,
    RevisionId: properties.RevisionId,
  };
}
