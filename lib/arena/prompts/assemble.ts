import type {
  AgentIdentity,
  AgentTradeConfig,
  AgentVoiceConfig,
  ConversationalTone,
  TurnoverPreference,
} from "../config-types";

const TRADE_GUARDRAILS = `You are an AI portfolio manager in a public paper-trading arena competing against other models.
Return decisions as JSON only. Never exceed configured position limits or deploy below the cash floor.
Equities only. No options, margin, or leverage. No financial advice to humans.`;

const VOICE_GUARDRAILS = `You write for a human audience watching an AI trading competition.
Be entertaining but credible. No slurs, no personal attacks, no guaranteed return language.
Financial reasoning must stay plausible even when tone is playful.`;

function riskLabel(n: number): string {
  if (n <= 3) return "conservative";
  if (n <= 6) return "moderate";
  return "aggressive";
}

function aggressionLabel(n: number): string {
  if (n <= 3) return "patient, low-churn";
  if (n <= 6) return "balanced rotation";
  return "fast rotation, willing to press winners";
}

function turnoverLine(t: TurnoverPreference): string {
  if (t === "low") return "Prefer holding through noise; trade only on high-conviction shifts.";
  if (t === "medium") return "Rotate selectively around clear catalysts.";
  return "Act quickly on catalysts; accept higher turnover when edge is fresh.";
}

function toneLine(tone: ConversationalTone, snark: number): string {
  const snarkNote =
    snark >= 8
      ? "High snark allowed in peer comments — witty, sharp, never cruel."
      : snark >= 5
        ? "Light sarcasm OK in peer comments."
        : "Keep peer comments mostly earnest.";
  if (tone === "formal") return `Formal, desk-note voice. ${snarkNote}`;
  if (tone === "punchy") return `Punchy headlines, short clauses, confident cadence. ${snarkNote}`;
  return `Conversational PM voice — plain English, human-readable. ${snarkNote}`;
}

function verbosityLine(v: AgentVoiceConfig["verbosity"]): string {
  if (v === "terse") return "Keep headlines under 12 words; reasoning under 80 words.";
  if (v === "narrative") return "Headlines can run longer; reasoning may use 2–3 short paragraphs.";
  return "Headlines ~12–18 words; reasoning ~80–120 words.";
}

export function buildTradeMandate(
  identity: AgentIdentity,
  trade: AgentTradeConfig,
): string {
  const universe =
    trade.universeTags.length > 0 ? trade.universeTags.join(", ") : "US equities";
  return [
    `Agent: ${identity.displayName} (${identity.provider}).`,
    `Risk posture: ${riskLabel(trade.riskTolerance)} (${trade.riskTolerance}/10).`,
    `Aggression: ${aggressionLabel(trade.aggression)} (${trade.aggression}/10).`,
    `Max single position: ${trade.maxPositionPct}%. Minimum cash: ${trade.minCashPct}%.`,
    `Max concurrent positions: ${trade.maxConcurrentPositions}. Typical hold: ~${trade.holdingHorizonDays} days.`,
    turnoverLine(trade.turnover),
    `Universe bias: ${universe}. Benchmark: ${identity.benchmarkSymbol}.`,
  ].join("\n");
}

export function buildVoicePersonality(
  identity: AgentIdentity,
  voice: AgentVoiceConfig,
): string {
  const phrases =
    voice.signaturePhrases.length > 0
      ? `Signature phrases (use sparingly): ${voice.signaturePhrases.join("; ")}.`
      : "";
  const notes = voice.editorNotes.trim()
    ? `Editor notes from Rob: ${voice.editorNotes.trim()}`
    : "";
  return [
    `Agent voice: ${identity.displayName}.`,
    toneLine(voice.tone, voice.snarkLevel),
    verbosityLine(voice.verbosity),
    `Contrarian tendency in peer comments: ${voice.contrarianLevel}/10.`,
    phrases,
    notes,
  ]
    .filter(Boolean)
    .join("\n");
}

export function assembleTradeSystemPrompt(
  identity: AgentIdentity,
  trade: AgentTradeConfig,
): string {
  return [TRADE_GUARDRAILS, buildTradeMandate(identity, trade)].join("\n\n");
}

export function assembleVoiceSystemPrompt(
  identity: AgentIdentity,
  voice: AgentVoiceConfig,
): string {
  return [VOICE_GUARDRAILS, buildVoicePersonality(identity, voice)].join("\n\n");
}

export function deriveStyleLabel(trade: AgentTradeConfig, voice: AgentVoiceConfig): string {
  const risk = riskLabel(trade.riskTolerance);
  const tone = voice.tone === "punchy" ? "punchy" : voice.tone;
  return `${risk} · ${tone} · ${trade.turnover} turnover`;
}
