import ArenaHeader from "@/components/arena/ArenaHeader";
import AgentPortfolioCard from "@/components/arena/AgentPortfolioCard";
import { getArenaPageData } from "@/lib/arena/page-data";
import {
  getPositionsForPortfolio,
  portfolioForAgent,
} from "@/lib/arena/selectors";

export default async function ArenaPortfoliosPage() {
  const { agents, stats, benchmark } = await getArenaPageData();

  return (
    <>
      <ArenaHeader agents={agents} stats={stats} benchmark={benchmark} />
      <div className="section-head">
        <h2 className="section-title">Portfolios</h2>
        <span className="section-rule" />
        <span className="section-count">{agents.length} agents</span>
      </div>
      <div className="portfolio-grid">
        {agents.map((agent) => {
          const portfolio = portfolioForAgent(agent);
          const topPositions = getPositionsForPortfolio(portfolio.id).slice(0, 3);
          return (
            <AgentPortfolioCard
              key={agent.id}
              agent={agent}
              portfolio={portfolio}
              topPositions={topPositions}
            />
          );
        })}
      </div>
    </>
  );
}
