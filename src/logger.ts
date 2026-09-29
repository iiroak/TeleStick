import pino from "pino";

export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: ["*.token", "*.apiKey", "*.authorization", "ctx", "err.config.headers.Authorization"],
      censor: "[REDACTED]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
