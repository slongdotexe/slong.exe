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

type TypedResourceEvent<Event extends CloudFormationCustomResourceEvent> = Omit<
  Event,
  "ResourceProperties" | "OldResourceProperties"
> & {
  ResourceProperties: RouteProperties;
};

export type ResourceEvent =
  | TypedResourceEvent<CloudFormationCustomResourceCreateEvent>
  | (TypedResourceEvent<CloudFormationCustomResourceUpdateEvent> & {
      OldResourceProperties: RouteProperties;
    })
  | TypedResourceEvent<CloudFormationCustomResourceDeleteEvent>;

export interface PreviewRoute {
  domainName: string;
  revisionId: string;
  ownerId: string;
}
