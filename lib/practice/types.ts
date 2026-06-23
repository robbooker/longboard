export type PracticeSession = "premarket" | "regular" | "afterhours";

export type PracticeBar = {
  index: number;
  minuteOfDay: number;
  timeLabel: string;
  session: PracticeSession;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
};

export type PracticeLevel = {
  id: string;
  label: string;
  price: number;
  tone: "pivot" | "high" | "vwap" | "premarket" | "risk";
};

export type PracticeSetup = {
  key: string;
  queueDate: string;
  slot: number;
  anonymizedName: string;
  sourceTicker: string;
  sourceCompany: string;
  sourceDate: string;
  sourceSignalTime: string;
  sourceSignalPrice: number;
  priceScale: number;
  volumeScale: number;
  bars5m: PracticeBar[];
  bars4h: PracticeBar[];
  signalIndex: number;
  levels: PracticeLevel[];
};

export type PracticeAttemptSummary = {
  id: string;
  setupKey: string;
  attemptNumber: number;
  completedAt: string | null;
  realizedPnl: number | null;
};

export type PracticeExecution = {
  id: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "auto_close";
  shares: number;
  requestedPrice: number | null;
  fillPrice: number;
  barIndex: number;
  timeLabel: string;
  createdAt: string;
};

export type PracticeMetrics = {
  realizedPnl: number;
  returnPct: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  holdBars: number;
  adds: number;
  reductions: number;
  endingEquity: number;
};
