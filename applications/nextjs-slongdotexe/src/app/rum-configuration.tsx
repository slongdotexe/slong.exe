import "server-only";
import { connection } from "next/server";
import type { RumConfiguration } from "../utils/rum";
import RumClient from "./rum-client";

export default async function RumConfigurationProvider() {
  await connection();
  const configuration: RumConfiguration = {
    appMonitorId: process.env.RUM_APP_MONITOR_ID || "",
    identityPoolId: process.env.RUM_IDENTITY_POOL_ID || "",
    region: process.env.RUM_REGION || process.env.AWS_REGION || "",
    sessionSampleRate: Number(process.env.RUM_SESSION_SAMPLE_RATE ?? "0.1"),
    environment: process.env.RUM_ENVIRONMENT || process.env.ENVIRONMENT || "local",
    version: process.env.RUM_APPLICATION_VERSION || "0.1.0",
  };

  return <RumClient configuration={configuration} />;
}
