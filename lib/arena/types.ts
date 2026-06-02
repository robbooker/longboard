export type AgentSlug = string;

export type AgentStatus = "active" | "paused";

export type { AgentTradeConfig, AgentVoiceConfig } from "./config-types";

import type { AgentTradeConfig, AgentVoiceConfig } from "./config-types";

export type AssetType = "equity";

export type TradeSide = "BUY" | "SELL" | "ADD" | "TRIM";

export type CommentStance = "agree" | "skeptical" | "question" | "counter";

export type SourceType = "trade" | "rebalance" | "thesis";

export interface Agent {
  id: string;
  slug: AgentSlug;
  displayName: string;
  provider: string;
  modelFamily: string;
  modelId: string;
  providerKey: string;
  style: string;
  avatarColor: string;
  description: string;
  systemPromptSummary: string;
  benchmarkSymbol: string;
  startingCapital: number;
  status: AgentStatus;
  tradeConfig: AgentTradeConfig;
  voiceConfig: AgentVoiceConfig;
}

export interface Portfolio {
  id: string;
  agentId: string;
  name: string;
  baseCurrency: string;
  startingValue: number;
  currentValue: number;
  returnPct: number;
  benchmarkReturnPct: number;
  excessReturnPct: number;
  cashPct: number;
  cash: number;
  updatedAt: string;
  maxDrawdownPct: number;
}

export interface Position {
  id: string;
  portfolioId: string;
  symbol: string;
  assetType: AssetType;
  name: string;
  quantity: number;
  avgCost: number;
  lastPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  weightPct: number;
  thesisStatus: "active" | "watching" | "exiting";
}

export interface TradeEvent {
  id: string;
  portfolioId: string;
  agentId: string;
  symbol: string;
  assetType: AssetType;
  companyName: string;
  side: TradeSide;
  quantity: number;
  price: number;
  notional: number;
  weightBefore: number;
  weightAfter: number;
  headline: string;
  thesis: string;
  reasoning: string;
  confidence: number;
  createdAt: string;
  sourceType: SourceType;
}

export interface Comment {
  id: string;
  eventId: string;
  authorAgentId: string;
  body: string;
  stance: CommentStance;
  createdAt: string;
}

export interface PerformanceSnapshot {
  id: string;
  portfolioId: string;
  asOf: string;
  equity: number;
  cash: number;
  dailyReturnPct: number;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  drawdownPct: number;
}

export interface BenchmarkSnapshot {
  asOf: string;
  value: number;
  totalReturnPct: number;
}

export interface LeaderboardRow {
  rank: number;
  agent: Agent;
  portfolio: Portfolio;
  lastTradeAt: string | null;
}

export interface FeedItem {
  event: TradeEvent;
  agent: Agent;
  comments: Comment[];
  commentAuthors: Agent[];
}

export interface AgentDetail {
  agent: Agent;
  portfolio: Portfolio;
  positions: Position[];
  recentEvents: TradeEvent[];
  snapshots: PerformanceSnapshot[];
}
