import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";

type RuntimeState = {
  startedAt: Date;
  ready: boolean;
  publishMode: Config["publishMode"];
  streamConnected: boolean;
  streamMode: Config["streamMode"];
  streamStatus: string;
};

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function notFound(res: ServerResponse) {
  json(res, 404, { ok: false, error: "not_found" });
}

function uptimeSeconds(startedAt: Date): number {
  return Math.round((Date.now() - startedAt.getTime()) / 1000);
}

export function createHealthServer(config: Config, logger: Logger) {
  const state: RuntimeState = {
    startedAt: new Date(),
    ready: config.streamMode === "disabled",
    publishMode: config.publishMode,
    streamConnected: false,
    streamMode: config.streamMode,
    streamStatus: config.streamMode === "disabled" ? "disabled" : "starting",
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    if (url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        service: config.serviceName,
        version: config.serviceVersion,
        env: config.env,
        uptimeSeconds: uptimeSeconds(state.startedAt),
        streamMode: state.streamMode,
        publishMode: state.publishMode,
        streamConnected: state.streamConnected,
        streamStatus: state.streamStatus,
      });
      return;
    }

    if (url.pathname === "/ready") {
      json(res, state.ready ? 200 : 503, {
        ok: state.ready,
        service: config.serviceName,
        version: config.serviceVersion,
        streamMode: state.streamMode,
        publishMode: state.publishMode,
        streamConnected: state.streamConnected,
        streamStatus: state.streamStatus,
      });
      return;
    }

    notFound(res);
  });

  server.on("clientError", (err, socket) => {
    logger.warn("http_client_error", { error: err.message });
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return {
    server,
    state,
  };
}
