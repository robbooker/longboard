import type { AgentSlug, AgentStatus } from "./types";

export type TurnoverPreference = "low" | "medium" | "high";
export type ConversationalTone = "formal" | "conversational" | "punchy";
export type Verbosity = "terse" | "medium" | "narrative";

/** Structured knobs that drive mandate text + server-side rule checks. */
export interface AgentTradeConfig {
  riskTolerance: number;
  aggression: number;
  maxPositionPct: number;
  minCashPct: number;
  turnover: TurnoverPreference;
  maxConcurrentPositions: number;
  holdingHorizonDays: number;
  universeTags: string[];
}

/** Structured knobs that drive feed copy + peer comment voice. */
export interface AgentVoiceConfig {
  tone: ConversationalTone;
  snarkLevel: number;
  verbosity: Verbosity;
  contrarianLevel: number;
  signaturePhrases: string[];
  editorNotes: string;
}

export interface AgentIdentity {
  id: string;
  slug: AgentSlug;
  displayName: string;
  provider: string;
  modelFamily: string;
  modelId: string;
  providerKey: string;
  avatarColor: string;
  bio: string;
  benchmarkSymbol: string;
  startingCapital: number;
  status: AgentStatus;
}

export interface AgentConfigBundle {
  trade: AgentTradeConfig;
  voice: AgentVoiceConfig;
  tradeSystemPrompt: string;
  voiceSystemPrompt: string;
}

export interface AgentAdminRecord extends AgentIdentity {
  draftTrade: AgentTradeConfig;
  draftVoice: AgentVoiceConfig;
  publishedTrade: AgentTradeConfig | null;
  publishedVoice: AgentVoiceConfig | null;
  publishedVersion: number;
  publishedAt: string | null;
  tradeSystemPrompt: string | null;
  voiceSystemPrompt: string | null;
  updatedAt: string | null;
  sortOrder: number;
  archivedAt: string | null;
}

export type CreateAgentInput = {
  slug: string;
  displayName: string;
  providerKey: string;
  modelId: string;
  modelFamily?: string;
  avatarColor?: string;
  bio?: string;
};

export type UpdateAgentIdentityInput = {
  displayName?: string;
  providerKey?: string;
  modelId?: string;
  modelFamily?: string;
  avatarColor?: string;
  bio?: string;
  status?: AgentStatus;
  sortOrder?: number;
};

export interface AgentPreviewSample {
  headline: string;
  reasoning: string;
  peerComment: string;
  peerAuthor: string;
  tradeSystemPrompt: string;
  voiceSystemPrompt: string;
}
