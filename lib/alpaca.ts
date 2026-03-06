import type { PortfolioData } from "@/types/alpaca";

export async function fetchPortfolio(): Promise<PortfolioData> {
  const res = await fetch("/api/alpaca", { cache: "no-store" });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch portfolio (${res.status})`);
  }

  return res.json();
}
