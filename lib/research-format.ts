import type { ResearchBrief } from "@/types/research";

/** Formats a ResearchBrief into a compact multi-line string suitable for
 *  feeding into an LLM prompt. Same shape used by /api/analyze's Claude
 *  signal call and /api/research/run-daily's Claude ranking call — keeping
 *  them on one helper means both endpoints reason over identical inputs. */
export function briefToSummary(b: ResearchBrief): string {
  const lines: string[] = [`TICKER: ${b.ticker}`];

  if (b.market) {
    lines.push(`Company: ${b.market.companyName || "Unknown"}`);
    lines.push(`HQ: ${b.market.hqLocation || "Unknown"}`);
    lines.push(`Industry: ${b.market.sicDescription || "Unknown"}`);
    lines.push(`Price: $${b.market.price?.toFixed(2) ?? "?"} | Change today: ${b.market.todayChangePct?.toFixed(2) ?? "?"}%`);
    lines.push(`Market Cap: $${b.market.marketCap ? (b.market.marketCap / 1e6).toFixed(2) + "M" : "?"}`);
    lines.push(`Float: ${b.market.float ? (b.market.float / 1e6).toFixed(2) + "M shares" : "?"}`);
    lines.push(`Volume: ${b.market.volume ? (b.market.volume / 1e6).toFixed(2) + "M" : "?"}`);
    lines.push(`Prev Close: $${b.market.prevClose?.toFixed(2) ?? "?"}`);
  }

  if (b.fundamentals) {
    lines.push(`Filing: ${b.fundamentals.form || "?"} filed ${b.fundamentals.filingDate || "?"}`);
    lines.push(`Cash on hand: $${b.fundamentals.cashOnHand ? (b.fundamentals.cashOnHand / 1e6).toFixed(2) + "M" : "?"}`);
    lines.push(`Revenue: $${b.fundamentals.revenue ? (b.fundamentals.revenue / 1e6).toFixed(2) + "M" : "?"}`);
    lines.push(`Net Income: $${b.fundamentals.netIncome ? (b.fundamentals.netIncome / 1e6).toFixed(2) + "M" : "?"}`);
    lines.push(`Going Concern: ${b.fundamentals.goingConcern === null ? "Unknown" : b.fundamentals.goingConcern ? "YES" : "No"}`);
    lines.push(`Shelf Registration (S-3): ${b.fundamentals.hasShelfRegistration ? `Yes, filed ${b.fundamentals.shelfFilingDate}` : "None"}`);
  }

  if (b.news?.perplexitySummary) {
    lines.push(`News summary: ${b.news.perplexitySummary.slice(0, 500)}`);
  }

  return lines.join("\n");
}
