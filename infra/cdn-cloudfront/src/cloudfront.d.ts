declare module "cloudfront" {
  interface KeyValueStore {
    exists(key: string): Promise<boolean>;
    get(key: string): Promise<string>;
  }

  interface OriginUpdate {
    domainName: string;
    customHeaders?: Record<string, string>;
    originAccessControlConfig?: {
      enabled: boolean;
      signingBehavior: "always-amz-auth";
      signingProtocol: "sigv4";
      originType: "lambda";
    };
  }

  const cloudfront: {
    kvs(id?: string): KeyValueStore;
    updateRequestOrigin(origin: OriginUpdate): void;
  };

  export default cloudfront;
}
