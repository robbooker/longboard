export interface PolygonSnapshotDay {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw: number;
}

export interface PolygonTickerSnapshot {
  ticker: string;
  todaysChange: number;
  todaysChangePerc: number;
  updated: number;
  day: PolygonSnapshotDay;
  prevDay: PolygonSnapshotDay;
  /** Populated by /api/gainers after cap-filter enrichment. Optional
   *  because consumers existed before the filter and the Polygon reference
   *  endpoint occasionally returns null for thinly-followed tickers. */
  marketCap?: number | null;
}

export interface GainersData {
  tickers: PolygonTickerSnapshot[];
  fetchedAt: string;
  mode?: "pre-market" | "market";
}

export interface PolygonQuote {
  bid_price: number;
  bid_size: number;
  bid_exchange: number;
  ask_price: number;
  ask_size: number;
  ask_exchange: number;
  participant_timestamp: number;
}

export interface PolygonTrade {
  price: number;
  size: number;
  exchange: number;
  conditions: number[];
  participant_timestamp: number;
  sip_timestamp: number;
}
