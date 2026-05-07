// Types for the briefing API surface.
//
// BriefingPayload mirrors the JSON shape Buddy writes to stock_briefings.payload.
// Money values are raw numbers; formatting is the UI's job.

export type BriefingSession =
  | "premarket"
  | "regular"
  | "afterhours"
  | "closed";

export type BriefingCompany = {
  description: string;
  sector: string;
  employees: number;
  shares_out: number;
  market_cap: number;
  structure_note: string;
};

export type BriefingCatalyst = {
  headline: string;
  bullets: string[];
};

export type BriefingPriceAction = {
  prev_close: number;
  current_price: number;
  pct_change: number;
  volume_today: number;
  volume_prev: number;
  range_90d_low: number;
  range_90d_high: number;
  session: BriefingSession;
};

export type BriefingFinancials = {
  period: string;
  reported_date: string;
  revenue: number;
  revenue_yoy_pct: number;
  eps: number | null;
  eps_prior: number | null;
  free_cash_flow: number | null;
  cash_on_hand: number | null;
  going_concern: boolean;
  notes: string | null;
};

export type BriefingRisk = {
  category: string;
  text: string;
};

export type BriefingTradingSide = {
  trigger: string;
  target: number;
  stop: number;
  note: string;
};

export type BriefingTradingAngle = {
  long: BriefingTradingSide;
  short: BriefingTradingSide;
};

export type BriefingSentiment = {
  source: string;
  post_count: number;
  lookback_days: number;
  summary: string;
};

export type BriefingSource = {
  label: string;
  url: string | null;
};

export type BriefingPayload = {
  ticker: string;
  company_name: string;
  exchange: string;
  generated_at: string;
  editorial_headline?: string;
  company: BriefingCompany;
  catalyst: BriefingCatalyst;
  price_action: BriefingPriceAction;
  financials: BriefingFinancials;
  risks: BriefingRisk[];
  trading_angle: BriefingTradingAngle;
  bottom_line: string;
  sentiment: BriefingSentiment;
  sources: BriefingSource[];
};

// DB rows.

export type BriefingRequestStatus = "pending" | "running" | "done" | "error";

export type BriefingRequestRow = {
  id: string;
  ticker: string;
  briefing_date: string;
  status: BriefingRequestStatus;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  requested_by: string | null;
};

export type StockBriefingRow = {
  id: string;
  ticker: string;
  briefing_date: string;
  generated_at: string;
  payload: BriefingPayload;
  generated_by: string | null;
};

// API response shapes.

export type BriefingReadyResponse = {
  status: "ready";
  briefing: StockBriefingRow;
};

export type BriefingPendingResponse = {
  status: "pending";
  request_id: string;
  queued_at: string;
};

export type BriefingQueuedResponse = {
  status: "queued";
  request_id: string;
};

export type BriefingErrorResponse = {
  status: "error";
  request_id: string;
  error_message: string;
};

export type BriefingNotRequestedResponse = {
  status: "not_requested";
};

export type BriefingApiResponse =
  | BriefingReadyResponse
  | BriefingPendingResponse
  | BriefingQueuedResponse
  | BriefingErrorResponse
  | BriefingNotRequestedResponse;
