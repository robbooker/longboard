import type { Confidence, MorningEmailStock, ResearchSource } from "./types";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_TIMEOUT_MS = 90_000;

const FORBIDDEN_NEGATIVE = ["down", "falling", "dropping", "declining", "sinking", "tumbling"];

const SYSTEM_PROMPT = `You are a market analyst writing for a stock-focused morning newsletter. The stock you analyze is a POSITIVE mover today.

Synthesize a catalyst summary, trader sentiment summary, confidence rating, and risk flags using ONLY the supplied evidence. You will receive stock metadata and a numbered list of evidence items from sources (Polygon News, Benzinga, SEC EDGAR, Exa Web, X Recent Search).

Strict rules:
1. Use ONLY the supplied evidence. Do not invent facts, prices, dates, or events.
2. If the catalyst is unclear from the evidence, say so explicitly (e.g., "Catalyst is unclear from available evidence."). Do not guess.
3. The stock is a POSITIVE mover. Do NOT use these negative direction words anywhere in your output: down, falling, dropping, declining, sinking, tumbling. Use upward-direction words like up, gaining, climbing, advancing, rising, moving higher.
4. Return JSON ONLY — no prose outside the JSON object, no Markdown fences.

Output JSON shape:
{
  "catalyst": "2-3 sentence catalyst summary",
  "sentiment": "1-2 sentence trader sentiment summary",
  "confidence": "High" | "Medium" | "Low",
  "risk_flags": ["short flag", "..."],
  "evidence_notes": "- Source: short note\\n- Source: short note"
}

Confidence guidance:
- High: clear, specific catalyst with multiple corroborating sources.
- Medium: catalyst is plausible but evidence is limited or single-source.
- Low: evidence is thin, generic, or contradictory.

Risk flags should be short (e.g., "offering risk", "going concern", "reverse split", "Nasdaq deficiency", "low float"). Empty array if none.`;

export type SynthResult = {
  catalyst: string;
  sentiment: string;
  confidence: Confidence;
  risk_flags: string[];
  evidence_notes: string;
};

function buildUserPrompt(stock: MorningEmailStock, evidence: ResearchSource[]): string {
  const lines: string[] = [];
  lines.push(`TICKER: ${stock.ticker}`);
  lines.push(`NAME: ${stock.name || "(unknown)"}`);
  lines.push(`CHANGE: ${stock.change_pct > 0 ? "+" : ""}${stock.change_pct.toFixed(2)}%`);
  lines.push(`LAST: $${stock.last.toFixed(2)}`);
  lines.push(`VOLUME: ${stock.volume.toLocaleString()}`);
  if (stock.market_cap) lines.push(`MARKET CAP: ${stock.market_cap}`);
  if (stock.float) lines.push(`FLOAT: ${stock.float}`);
  lines.push("");
  lines.push("EVIDENCE:");
  if (evidence.length === 0) {
    lines.push("(no evidence available — synthesize a catalyst-unclear response)");
  } else {
    evidence.forEach((e, i) => {
      lines.push(`[${i + 1}] ${e.source} (${e.publishedAt || "n/a"})`);
      if (e.title) lines.push(`    Title: ${e.title}`);
      if (e.text) lines.push(`    Text: ${e.text.replace(/\s+/g, " ").slice(0, 600)}`);
      if (e.url) lines.push(`    URL: ${e.url}`);
    });
  }
  return lines.join("\n");
}

function parseSynth(s: string): SynthResult | null {
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    const catalyst = typeof o.catalyst === "string" ? o.catalyst.trim() : "";
    const sentiment = typeof o.sentiment === "string" ? o.sentiment.trim() : "";
    const confRaw = typeof o.confidence === "string" ? o.confidence.trim() : "";
    const confidence: Confidence = confRaw === "High" || confRaw === "Medium" || confRaw === "Low" ? confRaw : "";
    const riskRaw = Array.isArray(o.risk_flags) ? o.risk_flags : [];
    const risk_flags = riskRaw.map((x) => String(x).trim()).filter(Boolean);
    const evidence_notes = typeof o.evidence_notes === "string" ? o.evidence_notes.trim() : "";
    if (!catalyst) return null;
    return { catalyst, sentiment, confidence, risk_flags, evidence_notes };
  } catch {
    return null;
  }
}

export async function synthesizeStock(stock: MorningEmailStock, evidence: ResearchSource[]): Promise<SynthResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const effort = process.env.OPENAI_REASONING_EFFORT;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(stock, evidence) },
    ],
    response_format: { type: "json_object" },
  };
  if (effort) body.reasoning_effort = effort;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[morning-email/openai] synthesis failed: status=${res.status} model=${model} ticker=${stock.ticker} body=${errBody.slice(0, 500)}`);
      return null;
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return parseSynth(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function deterministicSynth(stock: MorningEmailStock, evidence: ResearchSource[]): SynthResult {
  const top = evidence.slice(0, 3);
  const titleJoin = top.map((e) => e.title).filter(Boolean).join(" / ");

  let catalyst = top.length === 0
    ? "Catalyst is unclear from available evidence."
    : `Based on available evidence: ${titleJoin}.`.slice(0, 600);

  if (stock.change_pct > 0) {
    catalyst = sanitizeForPositive(catalyst);
  }

  const sentiment = evidence.some((e) => e.source === "X Recent Search")
    ? "Trader sentiment summary unavailable without OpenAI synthesis; raw X feed preserved in evidence."
    : "Trader sentiment unavailable — OpenAI synthesis disabled or feed empty.";

  const risk_flags = detectRiskFlags(evidence);

  const confidence: Confidence = evidence.length >= 3 ? "Medium" : "Low";

  const evidence_notes = evidence
    .slice(0, 8)
    .map((e) => `- ${e.source}: ${(e.title || e.text || "").slice(0, 140)}`)
    .join("\n");

  return { catalyst, sentiment, confidence, risk_flags, evidence_notes };
}

function detectRiskFlags(evidence: ResearchSource[]): string[] {
  const flags = new Set<string>();
  for (const e of evidence) {
    const t = `${e.title} ${e.text}`.toLowerCase();
    if (/\boffering\b|\bATM\b|\bdilution\b|\b424b\b|\bs-1\b|\bs-3\b/.test(t)) flags.add("offering risk");
    if (/\b(merger|acquisition|acquired|m&a)\b/.test(t)) flags.add("M&A activity");
    if (/\breverse split\b/.test(t)) flags.add("reverse split");
    if (/\bgoing concern\b/.test(t)) flags.add("going concern");
    if (/\bnasdaq\b.{0,30}\b(deficiency|notice|listing|compliance)\b/.test(t)) flags.add("Nasdaq listing risk");
  }
  return Array.from(flags);
}

function sanitizeForPositive(s: string): string {
  let out = s;
  for (const word of FORBIDDEN_NEGATIVE) {
    const re = new RegExp(`\\b${word}\\b`, "gi");
    out = out.replace(re, "moving");
  }
  return out;
}
