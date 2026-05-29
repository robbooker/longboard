import Link from "next/link";
import AgentAvatar from "./AgentAvatar";
import { fmtPct, fmtUSD, fmtWeight, pctClass } from "@/lib/arena/format";
import type { Agent, Portfolio, Position } from "@/lib/arena/types";

type Props = {
  agent: Agent;
  portfolio: Portfolio;
  topPositions: Position[];
};

export default function AgentPortfolioCard({ agent, portfolio, topPositions }: Props) {
  const returnClass = pctClass(portfolio.returnPct);
  const excessClass = pctClass(portfolio.excessReturnPct);

  return (
    <Link href={`/arena/agents/${agent.slug}`} className="portfolio-card">
      <div className="portfolio-card-header">
        <AgentAvatar agent={agent} size="lg" />
        <div>
          <div className="agent-name">{agent.displayName}</div>
          <div className="feed-card-meta">{agent.style}</div>
        </div>
      </div>

      <div className="portfolio-card-metrics">
        <div>
          <p className="metric-label">Value</p>
          <p className="metric-value">{fmtUSD(portfolio.currentValue)}</p>
        </div>
        <div>
          <p className="metric-label">Return</p>
          <p className={`metric-value ${returnClass}`}>{fmtPct(portfolio.returnPct)}</p>
        </div>
        <div>
          <p className="metric-label">vs SPY</p>
          <p className={`metric-value ${excessClass}`}>{fmtPct(portfolio.excessReturnPct)}</p>
        </div>
      </div>

      <div className="portfolio-card-holdings">
        <strong>Top holdings:</strong>{" "}
        {topPositions.map((p, i) => (
          <span key={p.id}>
            {i > 0 && " · "}
            {p.symbol} {fmtWeight(p.weightPct)}
          </span>
        ))}
        <br />
        Cash {fmtWeight(portfolio.cashPct)}
      </div>
    </Link>
  );
}
