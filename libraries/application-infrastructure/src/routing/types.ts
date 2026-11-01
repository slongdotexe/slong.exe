import type {
  CloudFormationCustomResourceCreateEvent,
  CloudFormationCustomResourceDeleteEvent,
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceUpdateEvent,
} from "aws-lambda";

export interface RouteProperties {
  StoreArn: string;
  Hostname: string;
  DomainName: string;
  RevisionId: string;
}

export interface PreviewProperties {
  ParameterPrefix: string;
  PreviewName: string;
  DomainName: string;
  RevisionId: string;
}

export interface ParameterProperties {
  TargetRegion: string;
  ParameterPrefix: string;
  DistributionId: string;
  StoreArn: string;
  DomainName: string;
}

type PropertiesEvent<
  Event extends CloudFormationCustomResourceEvent,
  Properties,
> = Omit<Event, "ResourceProperties" | "OldResourceProperties"> & {
  ResourceProperties: Properties;
};

export type ResourceEvent<Properties = RouteProperties> =
  | PropertiesEvent<CloudFormationCustomResourceCreateEvent, Properties>
  | (PropertiesEvent<CloudFormationCustomResourceUpdateEvent, Properties> & {
      OldResourceProperties: Properties;
    })
  | PropertiesEvent<CloudFormationCustomResourceDeleteEvent, Properties>;

export interface PreviewRoute {
  domainName: string;
  revisionId: string;
  ownerId: string;
}

export function parseRouteProperties(
  value: unknown,
): RouteProperties | PreviewProperties {
  if (
    typeof value !== "object" ||
    value === null ||
    !("DomainName" in value) ||
    typeof value.DomainName !== "string" ||
    !("RevisionId" in value) ||
    typeof value.RevisionId !== "string"
  )
    throw new Error("Invalid preview route properties");
  if ("ParameterPrefix" in value) {
    if (
      typeof value.ParameterPrefix !== "string" ||
      !("PreviewName" in value) ||
      typeof value.PreviewName !== "string"
    ) {
      throw new Error("Invalid preview route properties");
    }
    return {
      ParameterPrefix: value.ParameterPrefix,
      PreviewName: value.PreviewName,
      DomainName: value.DomainName,
      RevisionId: value.RevisionId,
    };
  }
  if (
    !("StoreArn" in value) ||
    typeof value.StoreArn !== "string" ||
    !("Hostname" in value) ||
    typeof value.Hostname !== "string"
  ) {
    throw new Error("Invalid preview route properties");
  }
  return {
    StoreArn: value.StoreArn,
    Hostname: value.Hostname,
    DomainName: value.DomainName,
    RevisionId: value.RevisionId,
  };
}

export function parseParameterProperties(value: unknown): ParameterProperties {
  if (
    typeof value !== "object" ||
    value === null ||
    !("TargetRegion" in value) ||
    typeof value.TargetRegion !== "string" ||
    !("ParameterPrefix" in value) ||
    typeof value.ParameterPrefix !== "string" ||
    !("DistributionId" in value) ||
    typeof value.DistributionId !== "string" ||
    !("StoreArn" in value) ||
    typeof value.StoreArn !== "string" ||
    !("DomainName" in value) ||
    typeof value.DomainName !== "string"
  )
    throw new Error("Invalid preview parameter properties");
  return {
    TargetRegion: value.TargetRegion,
    ParameterPrefix: value.ParameterPrefix,
    DistributionId: value.DistributionId,
    StoreArn: value.StoreArn,
    DomainName: value.DomainName,
  };
}
