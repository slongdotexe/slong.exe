// Node --require preload, copied to the deployment package root.
// Set the listener address before Next's generated standalone server reads it.
// Application initialization stays in src/instrumentation.ts, not here.
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
if (!endpoint)
  throw new Error(
    "AWS_LAMBDA_HTTP_ENDPOINT is required for the Web Function listener",
  );

const address = new URL(`http://${endpoint}`);
process.env.HOSTNAME = address.hostname.replace(/^\[|\]$/g, "");
process.env.PORT = address.port || "80";
