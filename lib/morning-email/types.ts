export type ResearchSource = {
  source: "Polygon News" | "Benzinga" | "SEC EDGAR" | "Exa Web" | "X Recent Search";
  title: string;
  text: string;
  url?: string;
  publishedAt?: string;
};

export type Confidence = "High" | "Medium" | "Low" | "";

export type QaLevel = "ok" | "warning" | "error";

export type QaMessage = { level: QaLevel; message: string };

export type PriceTarget = { price: number; pct: number; rationale: string };

export type PriceTargets = {
  upside: PriceTarget | null;
  stretch: PriceTarget | null;
  downside: PriceTarget | null;
  generated_at: string | null;
  generated_by: "ai" | "manual" | null;
};

export function emptyPriceTargets(): PriceTargets {
  return {
    upside: null,
    stretch: null,
    downside: null,
    generated_at: null,
    generated_by: null,
  };
}

export type MorningEmailStock = {
  ticker: string;
  name: string;
  change_pct: number;
  last: number;
  volume: number;
  market_cap: string;
  float: string;
  catalyst: string;
  catalyst_headline?: string;
  sentiment: string;
  evidence_notes: string;
  confidence: Confidence;
  risk_flags: string[];
  source_urls: string[];
  evidence?: ResearchSource[];
  price_targets: PriceTargets;
};

export type MorningEmailDraft = {
  id?: string;
  date: string;
  subject: string;
  stocks: MorningEmailStock[];
  closing1: string;
  closing2: string;
  html?: string;
  qa: QaMessage[];
  createdAt?: string;
  updatedAt?: string;
};

export const DEFAULT_SUBJECT = "Morning Brief — Five names on the radar";

export const DEFAULT_CLOSING_1 =
  "These are the five names we're watching at the open. Trade your plan. Size for survival.";

export const DEFAULT_CLOSING_2 =
  "— Buddy";

export function emptyStock(): MorningEmailStock {
  return {
    ticker: "",
    name: "",
    change_pct: 0,
    last: 0,
    volume: 0,
    market_cap: "",
    float: "",
    catalyst: "",
    sentiment: "",
    evidence_notes: "",
    confidence: "",
    risk_flags: [],
    source_urls: [],
    evidence: [],
    price_targets: emptyPriceTargets(),
  };
}
