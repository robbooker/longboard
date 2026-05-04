import { createBarPublisher } from "./barPublisher.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createMassiveLogClient } from "./massiveClient.js";
import { createHealthServer } from "./server.js";

const config = loadConfig();
const logger = createLogger(config);
const { server, state } = createHealthServer(config, logger);
const barPublisher = createBarPublisher(config, logger);
const massiveClient = createMassiveLogClient(config, logger, state, barPublisher);

function shutdown(signal: NodeJS.Signals) {
  logger.info("shutdown_requested", { signal });
  state.ready = false;
  massiveClient.stop();
  barPublisher.close();

  server.close((err) => {
    if (err) {
      logger.error("shutdown_error", { error: err.message });
      process.exit(1);
    }

    logger.info("shutdown_complete");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("shutdown_timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(config.port, () => {
  logger.info("market_data_service_started", {
    port: config.port,
    version: config.serviceVersion,
    streamMode: config.streamMode,
    publishMode: config.publishMode,
    symbols: config.symbols,
  });
  massiveClient.start();
});
