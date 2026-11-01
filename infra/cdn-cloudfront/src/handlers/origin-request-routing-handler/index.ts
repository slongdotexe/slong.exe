import cf from "cloudfront";

type Header = { value: string };
type Request = {
  headers: Record<string, Header>;
  uri: string;
  method: string;
  querystring: Record<string, unknown>;
  cookies: Record<string, unknown>;
};
type ViewerRequestEvent = { request: Request };
type Response = { statusCode: number; statusDescription: string };
type PreviewRoute = { domainName: string; revisionId: string };
type RoutingConfiguration = { domainName: string };

const store = cf.kvs();

/**
 * Select a registered preview origin before CloudFront performs its cache lookup.
 * @param event CloudFront viewer-request event.
 * @returns The routed request or an error response for an unavailable preview.
 */
async function handler(event: ViewerRequestEvent): Promise<Request | Response> {
  const request = event.request;
  const host = request.headers.host.value.toLowerCase();
  delete request.headers["x-forwarded-host"];
  try {
    const configurationValue = await store.get("config:preview-domain");
    const configuration: RoutingConfiguration = JSON.parse(configurationValue);
    const domainName = configuration.domainName;
    if (
      !configuration ||
      typeof domainName !== "string" ||
      !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domainName)
    ) {
      throw new Error("Invalid routing configuration");
    }
    const previewDomain = domainName;
    if (
      !/^pr-[0-9]+$/.test(host.slice(0, -(1 + previewDomain.length))) ||
      !host.endsWith("." + previewDomain)
    ) {
      return { statusCode: 404, statusDescription: "Not Found" };
    }
    if (!(await store.exists(host))) {
      return { statusCode: 404, statusDescription: "Not Found" };
    }
    const routeValue = await store.get(host);
    const route: PreviewRoute = JSON.parse(routeValue);
    if (
      !/^[a-zA-Z0-9.-]+\.lambda-web\.[a-z0-9-]+\.on\.aws$/.test(
        route.domainName,
      ) ||
      typeof route.revisionId !== "string" ||
      !route.revisionId
    ) {
      throw new Error("Invalid preview route");
    }
    request.headers["x-preview-cache-key"] = {
      value: host + ":" + route.revisionId,
    };
    cf.updateRequestOrigin({
      domainName: route.domainName,
      customHeaders: { "x-forwarded-host": host },
      originAccessControlConfig: {
        enabled: true,
        signingBehavior: "always-amz-auth",
        signingProtocol: "sigv4",
        originType: "lambda",
      },
    });
    return request;
  } catch {
    return { statusCode: 503, statusDescription: "Service Unavailable" };
  }
}
