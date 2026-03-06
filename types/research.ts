export interface MarketData {
  companyName: string | null;
  hqLocation: string | null;
  sicDescription: string | null;
  marketCap: number | null;
  float: number | null;
  sharesOutstanding: number | null;
  todayChange: number | null;
  todayChangePct: number | null;
  price: number | null;
  volume: number | null;
  prevClose: number | null;
  high52w: number | null;
  low52w: number | null;
}

export interface Fundamentals {
  form: string | null;
  filingDate: string | null;
  goingConcern: boolean | null;
  liquidityExcerpt: string | null;
  cashOnHand: number | null;
  revenue: number | null;
  netIncome: number | null;
  hasShelfRegistration: boolean;
  shelfFilingDate: string | null;
}

export interface ExaResult {
  title: string;
  url: string;
  highlights: string[];
}

export interface NewsData {
  exaResults: ExaResult[];
  perplexitySummary: string | null;
}

export interface ResearchBrief {
  ticker: string;
  market: MarketData | null;
  fundamentals: Fundamentals | null;
  news: NewsData | null;
  status: "complete" | "partial" | "error";
  errors: string[];
  researchedAt: string;
}

// ── Claude Analysis Types ───────────────────────────────────────

export interface StockAnalysis {
  ticker: string;
  signal: "buy" | "hold" | "avoid";
  targetPrice: number | null;
  stopPrice: number | null;
  reasoning: string;
}

export interface AnalysisResult {
  topPick: string | null;
  analyses: StockAnalysis[];
  summary: string;
  analyzedAt: string;
}
