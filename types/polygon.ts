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
}

export interface GainersData {
  tickers: PolygonTickerSnapshot[];
  fetchedAt: string;
  mode?: "pre-market" | "market";
}
