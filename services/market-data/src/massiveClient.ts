import WebSocket from "ws";
import type { BarPublisher } from "./barPublisher.js";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { NormalizedBar } from "./marketTypes.js";

type StreamState = {
  ready: boolean;
  streamConnected: boolean;
  streamStatus: string;
};

type StatusMessage = {
  ev?: "status";
  status?: string;
  message?: string;
};

type AggregateMinuteMessage = {
  ev?: "AM";
  sym?: string;
  v?: number;
  o?: number;
  c?: number;
  h?: number;
  l?: number;
  s?: number;
};

type MassiveMessage = StatusMessage | AggregateMinuteMessage | Record<string, unknown>;

export type MassiveLogClient = {
  start: () => void;
  stop: () => void;
};

function isAggregateMinute(msg: MassiveMessage): msg is AggregateMinuteMessage {
  return msg.ev === "AM";
}

function isStatusMessage(msg: MassiveMessage): msg is StatusMessage {
  return msg.ev === "status";
}

function normalizeAggregate(msg: AggregateMinuteMessage): NormalizedBar | null {
  if (
    typeof msg.sym !== "string" ||
    typeof msg.s !== "number" ||
    typeof msg.o !== "number" ||
    typeof msg.h !== "number" ||
    typeof msg.l !== "number" ||
    typeof msg.c !== "number"
  ) {
    return null;
  }

  return {
    type: "bar",
    symbol: msg.sym.toUpperCase(),
    resolution: "1m",
    time: Math.floor(msg.s / 1000),
    open: msg.o,
    high: msg.h,
    low: msg.l,
    close: msg.c,
    volume: typeof msg.v === "number" ? msg.v : 0,
    source: "massive",
    receivedAt: new Date().toISOString(),
  };
}

function parseMessages(raw: WebSocket.RawData): MassiveMessage[] {
  const text = raw.toString("utf8");
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed as MassiveMessage[];
  if (parsed && typeof parsed === "object") return [parsed as MassiveMessage];
  return [];
}

function jitter(ms: number): number {
  const spread = Math.floor(ms * 0.2);
  return ms + Math.floor(Math.random() * spread);
}

export function createMassiveLogClient(
  config: Config,
  logger: Logger,
  state: StreamState,
  barPublisher: BarPublisher,
): MassiveLogClient {
  let socket: WebSocket | null = null;
  let stopped = true;
  let reconnectDelayMs = config.reconnectInitialMs;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const subscription = config.symbols.map((symbol) => `AM.${symbol}`).join(",");

  function setStatus(status: string, connected: boolean, ready = false) {
    state.streamStatus = status;
    state.streamConnected = connected;
    state.ready = config.streamMode === "disabled" || ready;
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect(reason: string) {
    if (stopped) return;
    const delay = jitter(reconnectDelayMs);
    logger.warn("massive_reconnect_scheduled", { reason, delayMs: delay });
    setStatus("reconnecting", false);
    clearReconnectTimer();
    reconnectTimer = setTimeout(connect, delay);
    reconnectDelayMs = Math.min(
      reconnectDelayMs * 2,
      config.reconnectMaxMs,
    );
  }

  function authenticate() {
    if (!socket || !config.polygonApiKey) return;
    socket.send(
      JSON.stringify({ action: "auth", params: config.polygonApiKey }),
    );
  }

  function subscribe() {
    if (!socket || subscription.length === 0) return;
    socket.send(JSON.stringify({ action: "subscribe", params: subscription }));
    logger.info("massive_subscribe_sent", {
      symbols: config.symbols,
      channels: subscription,
    });
  }

  function handleStatus(msg: StatusMessage) {
    const status = msg.status ?? "unknown";
    logger.info("massive_status", {
      status,
      upstreamMessage: msg.message,
    });

    if (status === "auth_success") {
      subscribe();
    } else if (status === "success") {
      setStatus("subscribed", true, true);
    } else if (status === "error") {
      setStatus("upstream_error", socket?.readyState === WebSocket.OPEN);
    }
  }

  function handleMessage(raw: WebSocket.RawData) {
    let messages: MassiveMessage[];
    try {
      messages = parseMessages(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("massive_message_parse_failed", { error: message });
      return;
    }

    for (const msg of messages) {
      if (isStatusMessage(msg)) {
        handleStatus(msg);
        continue;
      }

      if (isAggregateMinute(msg)) {
        const bar = normalizeAggregate(msg);
        if (bar) {
          logger.info("massive_bar", bar);
          barPublisher.publishBar(bar);
        } else {
          logger.warn("massive_bar_invalid", { message: msg });
        }
      }
    }
  }

  function connect() {
    if (stopped) return;

    logger.info("massive_connecting", {
      url: config.massiveWsUrl,
      symbols: config.symbols,
    });
    setStatus("connecting", false);

    socket = new WebSocket(config.massiveWsUrl);

    socket.on("open", () => {
      reconnectDelayMs = config.reconnectInitialMs;
      logger.info("massive_connected");
      setStatus("connected", true);
      authenticate();
    });

    socket.on("message", handleMessage);

    socket.on("close", (code, reason) => {
      logger.warn("massive_closed", {
        code,
        reason: reason.toString("utf8"),
      });
      socket = null;
      setStatus("closed", false);
      scheduleReconnect(`closed_${code}`);
    });

    socket.on("error", (err) => {
      logger.error("massive_error", { error: err.message });
      setStatus("error", false);
    });
  }

  function start() {
    if (config.streamMode === "disabled") {
      logger.info("massive_stream_disabled");
      setStatus("disabled", false);
      return;
    }

    stopped = false;
    connect();
  }

  function stop() {
    stopped = true;
    clearReconnectTimer();
    if (socket) {
      socket.close(1000, "service shutdown");
      socket = null;
    }
    setStatus("stopped", false);
  }

  return { start, stop };
}
