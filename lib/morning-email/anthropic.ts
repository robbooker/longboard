import type { PriceTarget, PriceTargets } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.4;

const SYSTEM_PROMPT = `You are a trading research analyst writing for an experienced retail trader audience. Given the stock data below, produce three price targets: upside (realistic next 5-10 trading days), stretch (best-case 30 days assuming the setup plays out), and downside (where the trade is wrong, stop-out level).

For each tier, provide a price (in dollars), percent move from current, and one sentence of reasoning grounded in the catalyst, structure (float, market cap), volume, or recent price action. Do not hedge with "it depends" or "could go either way" — pick a number.

Be specific. Reference the catalyst, float, volume, or sentiment if it informs the level. Avoid generic platitudes like "if momentum continues" — say what specifically would or wouldn't drive the move.

Return JSON only, no preamble, no markdown fences:
{
  "upside": { "price": <number>, "pct": <number>, "rationale": "<one sentence>" },
  "stretch": { "price": <number>, "pct": <number>, "rationale": "<one sentence>" },
  "downside": { "price": <number>, "pct": <number>, "rationale": "<one sentence>" }
}`;

export type TargetInputStock = {
  ticker: string;
  name?: string;
  last: number;
  change_pct: number;
  float?: string;
  volume?: number;
  market_cap?: string;
  catalyst: string;
  source_urls?: string[];
};

export type TargetGenResult =
  | { ok: true; targets: PriceTargets }
  | { ok: false; error: string };

function buildUserPrompt(s: TargetInputStock): string {
  const lines: string[] = [];
  lines.push(`Ticker: ${s.ticker}`);
  if (s.name) lines.push(`Name: ${s.name}`);
  lines.push(`Current price: $${s.last.toFixed(2)}`);
  lines.push(`Today's move: ${s.change_pct >= 0 ? "+" : ""}${s.change_pct.toFixed(2)}%`);
  if (s.float) lines.push(`Float: ${s.float}`);
  if (s.volume != null) lines.push(`Volume today: ${s.volume.toLocaleString()}`);
  if (s.market_cap) lines.push(`Market cap: ${s.market_cap}`);
  lines.push(`Catalyst: ${(s.catalyst || "(no catalyst text provided)").trim()}`);
  if (s.source_urls && s.source_urls.length > 0) {
    lines.push(`Sources cited: ${s.source_urls.length} URL${s.source_urls.length === 1 ? "" : "s"}`);
  }
  return lines.join("\n");
}

function parseTier(v: unknown): PriceTarget | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const price = typeof o.price === "number" && Number.isFinite(o.price) ? o.price : null;
  const pct = typeof o.pct === "number" && Number.isFinite(o.pct) ? o.pct : null;
  const rationale = typeof o.rationale === "string" ? o.rationale.trim() : null;
  if (price == null || pct == null || !rationale) return null;
  return { price, pct, rationale };
}

function parseTargets(text: string): PriceTargets | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    const upside = parseTier(o.upside);
    const stretch = parseTier(o.stretch);
    const downside = parseTier(o.downside);
    if (!upside || !stretch || !downside) return null;
    return {
      upside,
      stretch,
      downside,
      generated_at: new Date().toISOString(),
      generated_by: "ai",
    };
  } catch {
    return null;
  }
}

export async function generateTargetsForStock(stock: TargetInputStock): Promise<TargetGenResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not configured" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(stock) }],
      }),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Anthropic ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const textBlock = data.content?.find((b) => b.type === "text");
    const text = textBlock?.text;
    if (typeof text !== "string") return { ok: false, error: "no text content in response" };
    const targets = parseTargets(text);
    if (!targets) return { ok: false, error: "model returned malformed JSON targets" };
    return { ok: true, targets };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Anthropic request timed out" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "unknown error" };
  } finally {
    clearTimeout(timer);
  }
}
