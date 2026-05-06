import * as Ably from "ably";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import {
  chartChannelName,
  type NormalizedBar,
  type NormalizedFormingBarUpdate,
} from "./marketTypes.js";

export type BarPublisher = {
  publishBar: (bar: NormalizedBar) => void;
  publishFormingBar: (update: NormalizedFormingBarUpdate) => void;
  close: () => void;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createBarPublisher(config: Config, logger: Logger): BarPublisher {
  if (config.publishMode === "disabled") {
    logger.info("bar_publisher_disabled");
    return {
      publishBar: () => {},
      publishFormingBar: () => {},
      close: () => {},
    };
  }

  if (!config.ablyApiKey) {
    throw new Error("ABLY_API_KEY is required when MARKET_DATA_PUBLISH_MODE=ably");
  }

  const client = new Ably.Realtime({
    key: config.ablyApiKey,
    clientId: "longboard-market-data",
  });

  client.connection.on("connected", () => {
    logger.info("ably_connected");
  });

  client.connection.on("disconnected", (change) => {
    logger.warn("ably_disconnected", {
      reason: change.reason?.message,
    });
  });

  client.connection.on("suspended", (change) => {
    logger.warn("ably_suspended", {
      reason: change.reason?.message,
    });
  });

  client.connection.on("failed", (change) => {
    logger.error("ably_failed", {
      reason: change.reason?.message,
    });
  });

  return {
    publishBar: (bar) => {
      const channelName = chartChannelName(bar.symbol, bar.resolution);
      const channel = client.channels.get(channelName);

      void channel
        .publish("bar", bar)
        .then(() => {
          logger.info("ably_bar_published", {
            channel: channelName,
            symbol: bar.symbol,
            resolution: bar.resolution,
            time: bar.time,
          });
        })
        .catch((err: unknown) => {
          logger.error("ably_publish_failed", {
            channel: channelName,
            symbol: bar.symbol,
            resolution: bar.resolution,
            time: bar.time,
            error: errorMessage(err),
          });
        });
    },
    publishFormingBar: (update) => {
      const channelName = chartChannelName(update.symbol, update.resolution);
      const channel = client.channels.get(channelName);

      void channel
        .publish("forming_bar", update)
        .then(() => {
          logger.info("ably_forming_bar_published", {
            channel: channelName,
            symbol: update.symbol,
            resolution: update.resolution,
            time: update.time,
            close: update.close,
            volume: update.volume,
          });
        })
        .catch((err: unknown) => {
          logger.error("ably_forming_bar_publish_failed", {
            channel: channelName,
            symbol: update.symbol,
            resolution: update.resolution,
            time: update.time,
            error: errorMessage(err),
          });
        });
    },
    close: () => {
      client.close();
    },
  };
}
