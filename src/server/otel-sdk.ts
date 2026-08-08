import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { loggerFor } from "./logger";
import { SERVICE_NAME } from "./telemetry";

/**
 * Starts the OpenTelemetry SDK with a Prometheus scrape endpoint.
 *
 * The exporter runs its own HTTP server rather than a Next route, which is what
 * lets it bind to the loopback or container network only. Metrics carry no
 * secrets, but they do expose usage patterns and cost, and there is no reason
 * for them to be reachable from the public tunnel.
 *
 * Kept separate from `telemetry.ts` so that importing an instrument never has
 * the side effect of starting an HTTP listener.
 */

let sdk: NodeSDK | undefined;

export function startTelemetry(): void {
  if (sdk) return;

  const log = loggerFor("telemetry");
  const port = Number(process.env.METRICS_PORT ?? 9464);
  const host = process.env.METRICS_HOST ?? "127.0.0.1";

  const exporter = new PrometheusExporter({ port, host, endpoint: "/metrics" }, () => {
    log.info({ host, port, endpoint: "/metrics" }, "prometheus exporter listening");
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.0",
    }),
    metricReader: exporter,
  });

  try {
    sdk.start();
  } catch (error) {
    // Observability failing is not a reason for the app to fail.
    log.error({ err: error }, "failed to start OpenTelemetry SDK");
    sdk = undefined;
    return;
  }

  const shutdown = () => {
    void sdk?.shutdown().catch((error: unknown) => {
      log.error({ err: error }, "error during telemetry shutdown");
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
