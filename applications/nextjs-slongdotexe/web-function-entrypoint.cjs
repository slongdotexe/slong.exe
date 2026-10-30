// Node --require preload, included in the standalone package by Next's tracing.
// Set the listener address before Next's generated standalone server reads it.
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
if (endpoint) {
  const address = new URL(`http://${endpoint}`);
  process.env.HOSTNAME = address.hostname.replace(/^\[|\]$/g, "");
  process.env.PORT = address.port || "80";
} else if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  throw new Error(
    "AWS_LAMBDA_HTTP_ENDPOINT is required for the Web Function listener",
  );
}
