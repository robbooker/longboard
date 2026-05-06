export type NormalizedBar = {
  type: "bar";
  symbol: string;
  resolution: "1m";
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: "massive";
  status?: "final";
  receivedAt: string;
};

export type NormalizedFormingBarUpdate = {
  type: "forming_bar";
  symbol: string;
  resolution: "1m";
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: "massive_second";
  status: "forming";
  receivedAt: string;
};

export function chartChannelName(symbol: string, resolution: NormalizedBar["resolution"]) {
  return `private:chart:${symbol.toUpperCase()}:${resolution}`;
}
