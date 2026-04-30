import { fetchPolygonNews } from "./polygon";
import { deterministicSynth } from "./openai";
import type { Confidence, MorningEmailStock, QaMessage } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";
const TIMEOUT_MS = 90_000;
const MAX_TOKENS = 4096;
const MAX_WEB_SEARCHES = 5;

const SYSTEM_PROMPT = `You are writing the daily morning email research brief for a stock-focused newsletter aimed at experienced retail traders. Your job: identify TODAY's actual catalyst from current web news (last 24-48 hours) for the stock provided. Use the web_search tool to find current information — do not rely on any pretrained knowledge of the stock or its history.

Strict rules:
1. Use ONLY information you find via web search or in the supplied stock data. Do not invent prices, dates, events, filings, or claims.
2. If today's catalyst is unclear after searching, say so explicitly. Do not pad with filler. Name what you DID find ("no fresh filings, no major news; the move appears to be a low-float technical squeeze").
3. Identify the type of move: fundamental (earnings, FDA approval, M&A, contract, guidance), technical/structural (low-float squeeze, short interest, options gamma, halt-induced volatility), or news-driven (rumor, sympathy play, sector rotation).
4. Cite real URLs from your search results. Do not fabricate URLs.
5. The stock is a POSITIVE mover today. Do NOT use these negative direction words anywhere in your output: down, falling, dropping, declining, sinking, tumbling. Use upward-direction words instead (up, gaining, climbing, advancing, rising, moving higher).
6. Voice: sharp trader briefing — concrete, specific, structural. Reference real numbers (volume, float, prior close, intraday high/low, halt points). Avoid platitudes like "if momentum continues."
7. Return JSON ONLY — no prose outside the JSON object, no markdown fences.

Output JSON shape:
{
  "catalyst": "3-5 sentences",
  "sentiment": "1-2 sentences on what traders are saying / what social and tape activity suggests",
  "confidence": "High" | "Medium" | "Low",
  "risk_flags": ["short string"],
  "evidence_notes": "- Source title — URL\\n- Source title — URL",
  "source_urls": ["https://..."]
}

Confidence guidance:
- High: clear specific catalyst, multiple corroborating sources, fresh news (today/yesterday).
- Medium: catalyst plausible but limited or single-source.
- Low: thin evidence, no fresh news, technical/squeeze move with unclear trigger.

Risk flags should be short, e.g.: "offering risk", "going concern", "reverse split", "Nasdaq deficiency", "dilution", "low float", "halted today", "M&A activity".`;

type ContentBlock = Record<string, unknown>;
type AnthropicMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };

type AnthropicResponse = {
  content?: ContentBlock[];
  stop_reason?: string;
  usage?: {
    server_tool_use?: { web_search_requests?: number };
  };
};

export type ClaudeSynth = {
  catalyst: string;
  sentiment: string;
  confidence: Confidence;
  risk_flags: string[];
  evidence_notes: string;
  source_urls: string[];
};

function buildUserPrompt(stock: MorningEmailStock): string {
  const sign = stock.change_pct >= 0 ? "+" : "";
  const mcap = stock.market_cap || "unknown";
  const fl = stock.float || "unknown";
  return `Research stock ${stock.ticker}${stock.name ? ` (${stock.name})` : ""}. Today the stock moved ${sign}${stock.change_pct.toFixed(2)}% to $${stock.last.toFixed(2)} on ${stock.volume.toLocaleString()} shares. Market cap ${mcap}, float ${fl}.

Find today's actual catalyst by searching current web news from the last 24-48 hours. Identify whether this is a fundamental catalyst, a technical/structural setup (low-float squeeze, short interest, options flow), or news-driven.

Cite sources.

Return JSON only with these fields: catalyst (3-5 sentences in the voice of a sharp trader briefing — concrete, specific, no filler), sentiment (1-2 sentences on what traders are saying / what social and tape activity suggests), confidence (High/Medium/Low based on news clarity + source quality), risk_flags (array of strings: offering, M&A, reverse split, going concern, Nasdaq deficiency, dilution, etc.), evidence_notes (bulleted list of source titles with URLs), source_urls (array of URLs).`;
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((b) => b && b.type === "text")
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .join("\n")
    .trim();
}

function parseSynth(text: string): ClaudeSynth | null {
  let obj: Record<string, unknown> | null = null;
  const trimmed = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        obj = JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  if (!obj) return null;

  const catalyst = typeof obj.catalyst === "string" ? obj.catalyst.trim() : "";
  const sentiment = typeof obj.sentiment === "string" ? obj.sentiment.trim() : "";
  const confRaw = typeof obj.confidence === "string" ? obj.confidence.trim() : "";
  const confidence: Confidence = confRaw === "High" || confRaw === "Medium" || confRaw === "Low" ? confRaw : "";
  const riskRaw = Array.isArray(obj.risk_flags) ? obj.risk_flags : [];
  const risk_flags = riskRaw.map((x) => String(x).trim()).filter(Boolean);
  const evidence_notes = typeof obj.evidence_notes === "string" ? obj.evidence_notes.trim() : "";
  const urlsRaw = Array.isArray(obj.source_urls) ? obj.source_urls : [];
  const source_urls = urlsRaw.map((x) => String(x).trim()).filter(Boolean);
  if (!catalyst) return null;
  return { catalyst, sentiment, confidence, risk_flags, evidence_notes, source_urls };
}

type CallResult =
  | { ok: true; rawContent: ContentBlock[]; text: string; webSearchCount: number }
  | { ok: false; error: string };

async function callClaudeOnce(messages: AnthropicMessage[]): Promise<CallResult> {
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
        system: SYSTEM_PROMPT,
        messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCHES }],
      }),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Anthropic ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json()) as AnthropicResponse;
    const content = data.content ?? [];
    const text = extractText(content);
    const webSearchCount = data.usage?.server_tool_use?.web_search_requests ?? 0;
    return { ok: true, rawContent: content, text, webSearchCount };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Anthropic request timed out (90s)" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "unknown error" };
  } finally {
    clearTimeout(timer);
  }
}

type ResearchResult =
  | { ok: true; synth: ClaudeSynth; webSearchCount: number }
  | { ok: false; error: string };

async function callWithRetry(stock: MorningEmailStock): Promise<ResearchResult> {
  const userPrompt = buildUserPrompt(stock);
  const messages: AnthropicMessage[] = [{ role: "user", content: userPrompt }];

  const first = await callClaudeOnce(messages);
  if (!first.ok) return { ok: false, error: first.error };

  let synth = parseSynth(first.text);
  if (synth) return { ok: true, synth, webSearchCount: first.webSearchCount };

  const retryMessages: AnthropicMessage[] = [
    ...messages,
    { role: "assistant", content: first.rawContent },
    { role: "user", content: "Return JSON only — your previous response was not parseable. Use the search results you already gathered. No preamble, no markdown fences, just the JSON object matching the requested schema." },
  ];
  const second = await callClaudeOnce(retryMessages);
  if (!second.ok) return { ok: false, error: `retry: ${second.error}` };
  synth = parseSynth(second.text);
  if (synth) return { ok: true, synth, webSearchCount: first.webSearchCount + second.webSearchCount };
  return { ok: false, error: "JSON parse failed on initial and retry" };
}

export type ClaudeResearchOutcome = {
  stock: MorningEmailStock;
  qa: QaMessage[];
};

export async function researchStockWithClaude(stock: MorningEmailStock): Promise<ClaudeResearchOutcome> {
  const qa: QaMessage[] = [];
  const result = await callWithRetry(stock);

  if (result.ok) {
    console.log(`[morning-email/claude] ${stock.ticker}: ok, web_search_requests=${result.webSearchCount}`);
    if (result.synth.confidence === "Low") {
      qa.push({ level: "warning", message: `${stock.ticker}: Claude returned Low confidence.` });
    }
    if (result.synth.source_urls.length === 0) {
      qa.push({ level: "warning", message: `${stock.ticker}: no source URLs returned by Claude.` });
    }
    return {
      stock: {
        ...stock,
        catalyst: result.synth.catalyst,
        sentiment: result.synth.sentiment,
        confidence: result.synth.confidence,
        risk_flags: result.synth.risk_flags,
        evidence_notes: result.synth.evidence_notes,
        source_urls: result.synth.source_urls,
        evidence: stock.evidence ?? [],
      },
      qa,
    };
  }

  console.error(`[morning-email/claude] ${stock.ticker}: failed — ${result.error}`);
  qa.push({ level: "warning", message: `${stock.ticker}: Claude research failed (${result.error}); using deterministic Polygon fallback.` });

  const polyNews = await fetchPolygonNews(stock.ticker);
  const synth = deterministicSynth(stock, polyNews);
  return {
    stock: {
      ...stock,
      catalyst: synth.catalyst,
      sentiment: synth.sentiment,
      confidence: synth.confidence,
      risk_flags: synth.risk_flags,
      evidence_notes: synth.evidence_notes,
      source_urls: polyNews.map((s) => s.url).filter((u): u is string => Boolean(u)),
      evidence: polyNews,
    },
    qa,
  };
}
