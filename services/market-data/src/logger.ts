import type { Config, LogLevel } from "./config.js";

type Fields = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type Logger = {
  debug: (message: string, fields?: Fields) => void;
  info: (message: string, fields?: Fields) => void;
  warn: (message: string, fields?: Fields) => void;
  error: (message: string, fields?: Fields) => void;
};

export function createLogger(config: Config): Logger {
  function write(level: LogLevel, message: string, fields: Fields = {}) {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[config.logLevel]) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      service: config.serviceName,
      env: config.env,
      message,
      ...fields,
    };

    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
