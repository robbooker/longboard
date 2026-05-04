export type LogLevel = "debug" | "info" | "warn" | "error";

export type Config = {
  env: string;
  port: number;
  logLevel: LogLevel;
  serviceName: string;
  serviceVersion: string;
};

const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

function parsePort(value: string | undefined): number {
  const raw = value ?? "8080";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`MARKET_DATA_PORT must be an integer from 1 to 65535, got "${raw}"`);
  }
  return port;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const level = (value ?? "info").toLowerCase();
  if (!LOG_LEVELS.has(level as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of debug, info, warn, error, got "${value}"`);
  }
  return level as LogLevel;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    env: env.NODE_ENV ?? "development",
    port: parsePort(env.MARKET_DATA_PORT ?? env.PORT),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    serviceName: "longboard-market-data",
    serviceVersion: env.SERVICE_VERSION ?? "dev",
  };
}
