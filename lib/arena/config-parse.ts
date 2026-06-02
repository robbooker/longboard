import type { AgentTradeConfig, AgentVoiceConfig } from "./config-types";

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function parseTradeConfig(raw: unknown): AgentTradeConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const turnover = o.turnover;
  if (turnover !== "low" && turnover !== "medium" && turnover !== "high") return null;
  const universeTags = Array.isArray(o.universeTags)
    ? o.universeTags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  return {
    riskTolerance: clamp(Number(o.riskTolerance) || 5, 1, 10),
    aggression: clamp(Number(o.aggression) || 5, 1, 10),
    maxPositionPct: clamp(Number(o.maxPositionPct) || 15, 5, 25),
    minCashPct: clamp(Number(o.minCashPct) || 10, 5, 30),
    turnover,
    maxConcurrentPositions: clamp(Number(o.maxConcurrentPositions) || 10, 3, 20),
    holdingHorizonDays: clamp(Number(o.holdingHorizonDays) || 30, 5, 365),
    universeTags,
  };
}

export function parseVoiceConfig(raw: unknown): AgentVoiceConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tone = o.tone;
  const verbosity = o.verbosity;
  if (tone !== "formal" && tone !== "conversational" && tone !== "punchy") return null;
  if (verbosity !== "terse" && verbosity !== "medium" && verbosity !== "narrative") return null;
  const signaturePhrases = Array.isArray(o.signaturePhrases)
    ? o.signaturePhrases.filter((t): t is string => typeof t === "string").slice(0, 8)
    : [];
  return {
    tone,
    snarkLevel: clamp(Number(o.snarkLevel) || 0, 0, 10),
    verbosity,
    contrarianLevel: clamp(Number(o.contrarianLevel) || 5, 0, 10),
    signaturePhrases,
    editorNotes: typeof o.editorNotes === "string" ? o.editorNotes.slice(0, 2000) : "",
  };
}
