import { NextRequest, NextResponse } from "next/server";
import type { ResearchBrief, StockAnalysis, AnalysisResult } from "@/types/research";

function briefToSummary(b: ResearchBrief): string {
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

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  const { briefs } = (await request.json()) as { briefs: ResearchBrief[] };

  if (!briefs || briefs.length === 0) {
    return NextResponse.json(
      { error: "No research briefs provided" },
      { status: 400 }
    );
  }

  const stockSummaries = briefs.map(briefToSummary).join("\n\n---\n\n");

  const prompt = `You are a stock trading analyst assistant. You are analyzing today's top gaining stocks for a day trader who focuses on momentum plays.

Here are the research briefs for ${briefs.length} stocks:

${stockSummaries}

Based on this data, analyze each stock and provide:
1. A signal: "buy" (good momentum play with favorable risk/reward), "hold" (watch but don't enter), or "avoid" (too risky, red flags)
2. A realistic target price for today/tomorrow based on the current momentum, support/resistance, and float
3. A stop loss price (where to cut losses)
4. Brief reasoning (1-2 sentences max)

Then pick the single best stock (the "top pick") — the one with the best risk/reward for a momentum trade today.

IMPORTANT FACTORS TO CONSIDER:
- Low float + high volume = potential squeeze, good for momentum
- Going concern = major red flag, company may go bankrupt
- Shelf registration (S-3) = company can dilute at any time, be cautious
- Cash on hand vs burn rate — if cash is very low, offering risk is high
- News catalyst strength — earnings beat, FDA approval, contract win are strong; no catalyst = risky
- Current % gain — stocks up 100%+ may be extended, look for ones with room to run

Respond with ONLY valid JSON in this exact format:
{
  "topPick": "TICKER",
  "summary": "One sentence overall summary of the analysis",
  "analyses": [
    {
      "ticker": "TICKER",
      "signal": "buy",
      "targetPrice": 5.50,
      "stopPrice": 3.80,
      "reasoning": "Brief reasoning here"
    }
  ]
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API returned ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text;

    if (!text) throw new Error("No response text from Claude");

    // Parse JSON from Claude's response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse JSON from Claude response");

    const parsed = JSON.parse(jsonMatch[0]);

    const result: AnalysisResult = {
      topPick: parsed.topPick || null,
      analyses: (parsed.analyses || []).map((a: any) => ({
        ticker: a.ticker,
        signal: a.signal,
        targetPrice: a.targetPrice ?? null,
        stopPrice: a.stopPrice ?? null,
        reasoning: a.reasoning || "",
      })),
      summary: parsed.summary || "",
      analyzedAt: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    console.error("Claude analysis error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
