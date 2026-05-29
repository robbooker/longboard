import Link from "next/link";
import { notFound } from "next/navigation";
import AgentAvatar from "@/components/arena/AgentAvatar";
import ActionBadge from "@/components/arena/ActionBadge";
import ArenaEquityChart from "@/components/arena/ArenaEquityChart";
import HoldingsTable from "@/components/arena/HoldingsTable";
import { fmtPct, fmtTime, fmtUSD, pctClass } from "@/lib/arena/format";
import { getAgentDetail } from "@/lib/arena/selectors";
import { getPublishedAgent } from "@/lib/arena/agents-store";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const publishedAgent = await getPublishedAgent(slug);
  const detail = getAgentDetail(slug, publishedAgent ?? undefined);
  if (!detail) notFound();

  const { agent, portfolio, positions, recentEvents, snapshots } = detail;
  const returnClass = pctClass(portfolio.returnPct);
  const excessClass = pctClass(portfolio.excessReturnPct);
  const changeSign = portfolio.returnPct > 0 ? 1 : portfolio.returnPct < 0 ? -1 : 0;

  return (
    <>
      <Link href="/arena/portfolios" className="back-link">
        ← Back to portfolios
      </Link>

      <div className="agent-detail-header">
        <AgentAvatar agent={agent} size="lg" />
        <div>
          <h1 className="head-h1">{agent.displayName}</h1>
          <p className="agent-detail-style">{agent.provider} · {agent.style}</p>
          <p className="agent-detail-desc">{agent.description}</p>
        </div>
      </div>

      <div className="agg-strip" style={{ marginBottom: 28 }}>
        <div className="agg-card">
          <p className="agg-label">Portfolio value</p>
          <p className="agg-value">{fmtUSD(portfolio.currentValue)}</p>
        </div>
        <div className="agg-card">
          <p className="agg-label">Total return</p>
          <p className={`agg-value ${returnClass}`}>{fmtPct(portfolio.returnPct)}</p>
        </div>
        <div className="agg-card">
          <p className="agg-label">vs SPY</p>
          <p className={`agg-value ${excessClass}`}>{fmtPct(portfolio.excessReturnPct)}</p>
        </div>
        <div className="agg-card">
          <p className="agg-label">Cash</p>
          <p className="agg-value">{fmtPct(portfolio.cashPct, 1)}</p>
          <p className="agg-sub">{fmtUSD(portfolio.cash)}</p>
        </div>
      </div>

      <ArenaEquityChart snapshots={snapshots} changeSign={changeSign} />

      <div className="section-head">
        <h2 className="section-title">Holdings</h2>
        <span className="section-rule" />
        <span className="section-count">{positions.length} positions</span>
      </div>
      <HoldingsTable positions={positions} />

      <div className="section-head">
        <h2 className="section-title">Recent activity</h2>
        <span className="section-rule" />
      </div>
      <div className="activity-list">
        {recentEvents.map((event) => (
          <div key={event.id} className="activity-item">
            <ActionBadge side={event.side} />
            <span className="activity-item-headline">
              <strong>{event.symbol}</strong> — {event.headline}
            </span>
            <span className="activity-item-time">{fmtTime(event.createdAt)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
