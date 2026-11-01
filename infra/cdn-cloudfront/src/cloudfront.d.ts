declare module "cloudfront" {
  interface KeyValueStore {
    exists(key: string): Promise<boolean>;
    get(key: string): Promise<string>;
  }

  interface OriginUpdate {
    domainName: string;
    customHeaders?: Record<string, string>;
  }

  const cloudfront: {
    kvs(id?: string): KeyValueStore;
    updateRequestOrigin(origin: OriginUpdate): void;
  };

  export default cloudfront;
}
