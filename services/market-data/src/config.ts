export type LogLevel = "debug" | "info" | "warn" | "error";

export type Config = {
  env: string;
  port: number;
  logLevel: LogLevel;
  serviceName: string;
  serviceVersion: string;
  polygonApiKey: string | null;
  massiveWsUrl: string;
  streamMode: "disabled" | "log";
  symbols: string[];
  reconnectInitialMs: number;
  reconnectMaxMs: number;
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

function parseStreamMode(value: string | undefined): Config["streamMode"] {
  const mode = (value ?? "disabled").toLowerCase();
  if (mode === "disabled" || mode === "log") return mode;
  throw new Error(`MARKET_DATA_STREAM_MODE must be disabled or log, got "${value}"`);
}

function parseSymbols(value: string | undefined): string[] {
  if (!value) return [];
  const symbols = value
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const invalid = symbols.find((s) => !/^[A-Z][A-Z0-9.]{0,9}$/.test(s));
  if (invalid) {
    throw new Error(`MARKET_DATA_SYMBOLS contains invalid symbol "${invalid}"`);
  }

  return Array.from(new Set(symbols));
}

function parseDelay(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100) {
    throw new Error(`${name} must be an integer >= 100, got "${value}"`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const streamMode = parseStreamMode(env.MARKET_DATA_STREAM_MODE);
  const polygonApiKey = env.POLYGON_API_KEY?.trim() || null;
  const symbols = parseSymbols(env.MARKET_DATA_SYMBOLS);

  if (streamMode === "log") {
    if (!polygonApiKey) {
      throw new Error("POLYGON_API_KEY is required when MARKET_DATA_STREAM_MODE=log");
    }
    if (symbols.length === 0) {
      throw new Error("MARKET_DATA_SYMBOLS is required when MARKET_DATA_STREAM_MODE=log");
    }
  }

  return {
    env: env.NODE_ENV ?? "development",
    port: parsePort(env.MARKET_DATA_PORT ?? env.PORT),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    serviceName: "longboard-market-data",
    serviceVersion: env.SERVICE_VERSION ?? "dev",
    polygonApiKey,
    massiveWsUrl: env.MASSIVE_STOCKS_WS_URL ?? "wss://business.massive.com/stocks",
    streamMode,
    symbols,
    reconnectInitialMs: parseDelay(
      "MARKET_DATA_RECONNECT_INITIAL_MS",
      env.MARKET_DATA_RECONNECT_INITIAL_MS,
      1_000,
    ),
    reconnectMaxMs: parseDelay(
      "MARKET_DATA_RECONNECT_MAX_MS",
      env.MARKET_DATA_RECONNECT_MAX_MS,
      30_000,
    ),
  };
}
