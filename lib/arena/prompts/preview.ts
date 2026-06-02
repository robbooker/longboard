import type { AgentIdentity, AgentPreviewSample, AgentTradeConfig, AgentVoiceConfig } from "../config-types";
import type { AgentSlug } from "../types";
import { assembleTradeSystemPrompt, assembleVoiceSystemPrompt } from "./assemble";

const SAMPLE_SYMBOL = "NVDA";
const SAMPLE_SIDE = "ADD";

function snarkPrefix(level: number, author: string): string {
  if (level >= 8) return "Look — ";
  if (level >= 5) return "Honestly, ";
  if (level >= 3) return "Worth noting: ";
  return "";
}

function headlineFor(
  identity: AgentIdentity,
  trade: AgentTradeConfig,
  voice: AgentVoiceConfig,
): string {
  const punchy = voice.tone === "punchy";
  if (identity.slug === "grok") {
    return punchy
      ? `Adding ${SAMPLE_SYMBOL} — crowd still arguing while the tape moves`
      : `Adding ${SAMPLE_SYMBOL} on dislocation, not on hype`;
  }
  if (identity.slug === "claude") {
    return `Adding ${SAMPLE_SYMBOL} on durable cash flow — sizing stays disciplined`;
  }
  if (identity.slug === "deepseek") {
    return `${SAMPLE_SIDE} ${SAMPLE_SYMBOL}. Valuation OK. Size moderate.`;
  }
  if (identity.slug === "gemini") {
    return `Adding ${SAMPLE_SYMBOL} post-catalyst — KPIs beat the whisper`;
  }
  return `Initiating ${SAMPLE_SYMBOL} ${SAMPLE_SIDE.toLowerCase()} — balanced sizing at ${Math.min(trade.maxPositionPct, 12)}% weight`;
}

function reasoningFor(
  identity: AgentIdentity,
  trade: AgentTradeConfig,
  voice: AgentVoiceConfig,
): string {
  const maxWords = voice.verbosity === "terse" ? 55 : voice.verbosity === "medium" ? 90 : 130;
  const base = `${identity.displayName} frames ${SAMPLE_SYMBOL} as a ${trade.universeTags[0] ?? "core"} name with ${trade.holdingHorizonDays}-day horizon. ` +
    `Risk tolerance ${trade.riskTolerance}/10 keeps sizing below ${trade.maxPositionPct}%. ` +
    `Cash floor stays at ${trade.minCashPct}%. Thesis: demand visibility is improving without forcing a max-weight bet.`;
  const words = base.split(/\s+/);
  return words.slice(0, maxWords).join(" ") + (words.length > maxWords ? "…" : "");
}

function peerCommentFor(
  trader: AgentIdentity,
  commenter: AgentIdentity,
  commenterVoice: AgentVoiceConfig,
): string {
  const prefix = snarkPrefix(commenterVoice.snarkLevel, commenter.displayName);
  if (commenter.slug === "deepseek") {
    return `${prefix}${trader.displayName}'s ${SAMPLE_SYMBOL} add is fine, but ${trader.displayName} is paying up. I'd want a better entry.`;
  }
  if (commenter.slug === "grok") {
    return `${prefix}Classic ${trader.displayName} — ${SAMPLE_SIDE.toLowerCase()}ing the name everyone already likes. Where's the edge?`;
  }
  if (commenterVoice.contrarianLevel >= 7) {
    return `${prefix}Not sure ${SAMPLE_SYMBOL} needs another ${SAMPLE_SIDE.toLowerCase()} here. Crowded quality trades mean smaller edge.`;
  }
  return `${prefix}Reasonable ${SAMPLE_SIDE.toLowerCase()} if ${trader.displayName} keeps size inside the stated cap.`;
}

/** Deterministic preview — no LLM call. Shows how knobs affect copy + prompts. */
export function buildAgentPreview(
  identity: AgentIdentity,
  trade: AgentTradeConfig,
  voice: AgentVoiceConfig,
  peerIdentity: AgentIdentity,
  peerVoice: AgentVoiceConfig,
): AgentPreviewSample {
  return {
    headline: headlineFor(identity, trade, voice),
    reasoning: reasoningFor(identity, trade, voice),
    peerComment: peerCommentFor(identity, peerIdentity, peerVoice),
    peerAuthor: peerIdentity.displayName,
    tradeSystemPrompt: assembleTradeSystemPrompt(identity, trade),
    voiceSystemPrompt: assembleVoiceSystemPrompt(identity, voice),
  };
}

export function defaultPeerForSlug(slug: string): AgentSlug {
  if (slug === "grok" || slug === "deepseek") return "claude";
  return "deepseek";
}
