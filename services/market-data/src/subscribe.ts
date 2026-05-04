import * as Ably from "ably";
import { chartChannelName, type NormalizedBar } from "./marketTypes.js";

const apiKey = process.env.ABLY_API_KEY?.trim();
const symbol = (process.env.MARKET_DATA_SUBSCRIBE_SYMBOL ?? "NVDA").trim().toUpperCase();
const channelName =
  process.env.MARKET_DATA_SUBSCRIBE_CHANNEL?.trim() ?? chartChannelName(symbol, "1m");

if (!apiKey) {
  throw new Error("ABLY_API_KEY is required");
}

const client = new Ably.Realtime({
  key: apiKey,
  clientId: "longboard-market-data-subscriber",
});

await client.connection.once("connected");
console.log(JSON.stringify({ event: "ably_connected", channel: channelName }));

const channel = client.channels.get(channelName);
await channel.subscribe("bar", (message) => {
  const bar = message.data as NormalizedBar;
  console.log(
    JSON.stringify({
      event: "bar",
      channel: channelName,
      symbol: bar.symbol,
      time: bar.time,
      close: bar.close,
      volume: bar.volume,
    }),
  );
});

function shutdown() {
  client.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
