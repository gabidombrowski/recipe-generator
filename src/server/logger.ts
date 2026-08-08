import pino from "pino";

/**
 * Structured logging.
 *
 * JSON lines in production so a log shipper can parse them; pretty-printed in
 * development so a human can. `redact` is not decoration — this app handles an
 * API key and an email allowlist, and neither belongs in a log line.
 */
const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "apiKey",
      "ANTHROPIC_API_KEY",
      "AUTH_SECRET",
      "AUTH_GITHUB_SECRET",
      "email",
    ],
    censor: "[redacted]",
  },
  base: { service: "recipe-generator" },
  transport: isProduction
    ? undefined
    : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
});

/** A child logger tagged with a subsystem, e.g. `scheduler` or `generator`. */
export const loggerFor = (subsystem: string) => logger.child({ subsystem });
