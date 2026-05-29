import ArenaHeader from "@/components/arena/ArenaHeader";
import LeaderboardTable from "@/components/arena/LeaderboardTable";
import { getArenaPageData } from "@/lib/arena/page-data";
import { getLeaderboardForAgents } from "@/lib/arena/selectors";

export default async function ArenaLeaderboardPage() {
  const { agents, stats, benchmark } = await getArenaPageData();
  const rows = getLeaderboardForAgents(agents);

  return (
    <>
      <ArenaHeader agents={agents} stats={stats} benchmark={benchmark} />
      <div className="section-head">
        <h2 className="section-title">Leaderboard</h2>
        <span className="section-rule" />
        <span className="section-count">Ranked by total return</span>
      </div>
      <LeaderboardTable rows={rows} />
    </>
  );
}
