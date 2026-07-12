export type LongingSignalStatus = "pending" | "sent" | "skipped" | "failed";

export type LongingSignal = {
  alertKey: string;
  etDate: string;
  ticker: string;
  signalUnixSeconds: number;
  signalTimeEt: string;
  detectedAt: string;
  detectionDelayMinutes: number;
  signalRvol: number;
  signalPrice: number;
  signalDayMovePct: number;
  status: LongingSignalStatus;
  stale: boolean;
  volumeAtSignal: number;
  dayVolume: number;
  close4pm: number | null;
  close8pm: number | null;
  dayMove8pmPct: number | null;
  return4pmPct: number | null;
  return8pmPct: number | null;
  maxFavorablePct: number | null;
  maxAdversePct: number | null;
  target20Hit: boolean;
  target20TimeEt: string | null;
  pnl4pm: number | null;
  pnl8pm: number | null;
  pnlTargetOr8pm: number | null;
};

export type LongingCohortSummary = {
  signals: number;
  capitalDeployed: number;
  average4pmPct: number | null;
  median4pmPct: number | null;
  average8pmPct: number | null;
  median8pmPct: number | null;
  averageMaxFavorablePct: number | null;
  averageMaxAdversePct: number | null;
  winRate4pmPct: number | null;
  winRate8pmPct: number | null;
  target20HitRatePct: number | null;
  pnl4pm: number;
  pnl8pm: number;
  pnlTargetOr8pm: number;
  returnOnCapital4pmPct: number | null;
  returnOnCapital8pmPct: number | null;
  returnOnCapitalTargetOr8pmPct: number | null;
};

export type LongingReport = {
  generatedAt: string;
  weekStart: string;
  weekEnd: string;
  title: "This Week in Longing";
  source: string;
  methodology: {
    positionSize: number;
    volumeSession: string;
    volumeAtSignal: string;
    dayMoveBaseline: string;
    entryAssumption: string;
    targetRule: string;
    staleRule: string;
  };
  summary: {
    all: LongingCohortSummary;
    actionable: LongingCohortSummary;
    staleSignals: number;
    uniqueTickers: number;
    tradingDays: number;
  };
  signals: LongingSignal[];
};
