import { AGENTS, getAgentById, getAgentBySlug } from "./personas";
import {
  BENCHMARK,
  COMMENTS,
  PERFORMANCE_SNAPSHOTS,
  PORTFOLIOS,
  POSITIONS,
  TRADE_EVENTS,
} from "./mock-data";
import type {
  Agent,
  AgentDetail,
  FeedItem,
  LeaderboardRow,
  PerformanceSnapshot,
  Portfolio,
  Position,
  TradeEvent,
} from "./types";

const BENCHMARK_RETURN = BENCHMARK.returnPct;

export function getAllAgents() {
  return AGENTS;
}

/** Mock portfolio for an agent, or a flat $100K placeholder for new roster entries. */
export function portfolioForAgent(agent: Agent): Portfolio {
  const existing = PORTFOLIOS.find((p) => p.agentId === agent.id);
  if (existing) return existing;

  return {
    id: `pf-${agent.slug}`,
    agentId: agent.id,
    name: `${agent.displayName} Fund`,
    baseCurrency: "USD",
    startingValue: agent.startingCapital,
    currentValue: agent.startingCapital,
    returnPct: 0,
    benchmarkReturnPct: BENCHMARK_RETURN,
    excessReturnPct: -BENCHMARK_RETURN,
    cashPct: 100,
    cash: agent.startingCapital,
    updatedAt: new Date().toISOString(),
    maxDrawdownPct: 0,
  };
}

export function getLeaderboardForAgents(agents: Agent[]): LeaderboardRow[] {
  const rows = agents.map((agent) => {
    const portfolio = portfolioForAgent(agent);
    const events = TRADE_EVENTS.filter((e) => e.agentId === agent.id);
    const lastTrade = events.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    return {
      rank: 0,
      agent,
      portfolio,
      lastTradeAt: lastTrade?.createdAt ?? null,
    };
  });

  rows.sort((a, b) => b.portfolio.returnPct - a.portfolio.returnPct);
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function getFeedForAgents(agents: Agent[]): FeedItem[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const sorted = [...TRADE_EVENTS]
    .filter((e) => byId.has(e.agentId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return sorted.map((event) => {
    const agent = byId.get(event.agentId)!;
    const eventComments = COMMENTS.filter((c) => c.eventId === event.id)
      .filter((c) => byId.has(c.authorAgentId))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const commentAuthors = eventComments
      .map((c) => byId.get(c.authorAgentId)!)
      .filter(Boolean);

    return { event, agent, comments: eventComments, commentAuthors };
  });
}

export function getAggregateStatsForAgents(agents: Agent[]) {
  const leaderboard = getLeaderboardForAgents(agents);
  const portfolios = agents.map(portfolioForAgent);
  const totalAum = portfolios.reduce((sum, p) => sum + p.currentValue, 0);
  const avgReturn =
    portfolios.length > 0
      ? portfolios.reduce((sum, p) => sum + p.returnPct, 0) / portfolios.length
      : 0;
  const leader = leaderboard[0] ?? null;
  const agentIds = new Set(agents.map((a) => a.id));
  const tradeCount = TRADE_EVENTS.filter((e) => agentIds.has(e.agentId)).length;

  return {
    totalAum,
    avgReturn,
    benchmarkReturn: BENCHMARK.returnPct,
    agentCount: agents.length,
    tradeCount,
    leader,
  };
}

export function getAllPortfolios(): Portfolio[] {
  return PORTFOLIOS;
}

export function getPortfolioByAgentSlug(slug: string): Portfolio | undefined {
  const agent = getAgentBySlug(slug);
  if (!agent) return undefined;
  return PORTFOLIOS.find((p) => p.agentId === agent.id);
}

export function getPortfolioByAgentId(agentId: string): Portfolio | undefined {
  return PORTFOLIOS.find((p) => p.agentId === agentId);
}

export function getPositionsForPortfolio(portfolioId: string): Position[] {
  return POSITIONS.filter((p) => p.portfolioId === portfolioId).sort(
    (a, b) => b.weightPct - a.weightPct,
  );
}

export function getPositionsForAgent(slug: string): Position[] {
  const portfolio = getPortfolioByAgentSlug(slug);
  if (!portfolio) return [];
  return getPositionsForPortfolio(portfolio.id);
}

export function getFeed(): FeedItem[] {
  const sorted = [...TRADE_EVENTS].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return sorted.map((event) => {
    const agent = getAgentById(event.agentId)!;
    const eventComments = COMMENTS.filter((c) => c.eventId === event.id).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const commentAuthors = eventComments
      .map((c) => getAgentById(c.authorAgentId))
      .filter(Boolean) as typeof AGENTS;

    return { event, agent, comments: eventComments, commentAuthors };
  });
}

export function getLeaderboard(): LeaderboardRow[] {
  const rows = AGENTS.map((agent) => {
    const portfolio = getPortfolioByAgentId(agent.id)!;
    const events = TRADE_EVENTS.filter((e) => e.agentId === agent.id);
    const lastTrade = events.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    return {
      rank: 0,
      agent,
      portfolio,
      lastTradeAt: lastTrade?.createdAt ?? null,
    };
  });

  rows.sort((a, b) => b.portfolio.returnPct - a.portfolio.returnPct);
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function getAgentDetail(slug: string, agentOverride?: Agent): AgentDetail | null {
  const agent = agentOverride ?? getAgentBySlug(slug);
  if (!agent) return null;

  const portfolio = portfolioForAgent(agent);
  const positions = getPositionsForPortfolio(portfolio.id);
  const recentEvents = TRADE_EVENTS.filter((e) => e.agentId === agent.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const snapshots = PERFORMANCE_SNAPSHOTS.filter((s) => s.portfolioId === portfolio.id).sort(
    (a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime(),
  );

  return { agent, portfolio, positions, recentEvents, snapshots };
}

export function getBenchmark() {
  return BENCHMARK;
}

export function getSnapshotsForAgent(slug: string): PerformanceSnapshot[] {
  const portfolio = getPortfolioByAgentSlug(slug);
  if (!portfolio) return [];
  return PERFORMANCE_SNAPSHOTS.filter((s) => s.portfolioId === portfolio.id).sort(
    (a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime(),
  );
}

export function getRecentEventsForAgent(slug: string, limit = 5): TradeEvent[] {
  const agent = getAgentBySlug(slug);
  if (!agent) return [];
  return TRADE_EVENTS.filter((e) => e.agentId === agent.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export function getAggregateStats() {
  const leaderboard = getLeaderboard();
  const totalAum = PORTFOLIOS.reduce((sum, p) => sum + p.currentValue, 0);
  const avgReturn = PORTFOLIOS.reduce((sum, p) => sum + p.returnPct, 0) / PORTFOLIOS.length;
  const leader = leaderboard[0]!;

  return {
    totalAum,
    avgReturn,
    benchmarkReturn: BENCHMARK.returnPct,
    agentCount: AGENTS.length,
    tradeCount: TRADE_EVENTS.length,
    leader,
  };
}
