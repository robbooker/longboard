export type ResearchStatus = "pending" | "processing" | "complete" | "error";

export interface TickerResearch {
  id: string;
  ticker: string;
  status: ResearchStatus;
  result: string | null;
  created_at: string;
  updated_at: string;
}
