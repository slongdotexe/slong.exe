import type { AwsRum } from "aws-rum-web";

export type RumConfiguration = {
  appMonitorId: string;
  identityPoolId: string;
  region: string;
  sessionSampleRate: number;
  environment: string;
  version: string;
};

type RumWindow = Window & {
  slongdotexeRum?: Promise<AwsRum | undefined>;
};

export function initializeRum(
  configuration?: RumConfiguration,
  loadClient: () => Promise<{ AwsRum: typeof AwsRum }> = () =>
    import("aws-rum-web"),
): Promise<AwsRum | undefined> {
  if (typeof window === "undefined" || !configuration) {
    return Promise.resolve(undefined);
  }
  const browser = window as RumWindow;
  if (browser.slongdotexeRum) return browser.slongdotexeRum;
  const { appMonitorId, identityPoolId, region, sessionSampleRate } =
    configuration;
  if (
    !appMonitorId ||
    !identityPoolId ||
    !region ||
    !Number.isFinite(sessionSampleRate) ||
    sessionSampleRate <= 0 ||
    sessionSampleRate > 1 ||
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl
  ) {
    return Promise.resolve(undefined);
  }
  browser.slongdotexeRum = loadClient()
    .then(
      ({ AwsRum: Client }) =>
        new Client(appMonitorId, configuration.version, region, {
          identityPoolId,
          sessionSampleRate,
          allowCookies: false,
          enableXRay: false,
          recordResourceUrl: false,
          telemetries: ["errors", "performance", "http"],
          sessionAttributes: { environment: configuration.environment },
        }),
    )
    .catch(() => {
      console.warn("CloudWatch RUM initialization failed");
      return undefined;
    });
  return browser.slongdotexeRum;
}
