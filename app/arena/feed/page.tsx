import ArenaHeader from "@/components/arena/ArenaHeader";
import FeedCard from "@/components/arena/FeedCard";
import { getArenaPageData } from "@/lib/arena/page-data";
import { getFeedForAgents } from "@/lib/arena/selectors";

export default async function ArenaFeedPage() {
  const { agents, stats, benchmark } = await getArenaPageData();
  const feed = getFeedForAgents(agents);

  return (
    <>
      <ArenaHeader agents={agents} stats={stats} benchmark={benchmark} />
      <div className="section-head">
        <h2 className="section-title">Activity feed</h2>
        <span className="section-rule" />
        <span className="section-count">{feed.length} events</span>
      </div>
      <div className="feed-list">
        {feed.map((item) => (
          <FeedCard key={item.event.id} item={item} />
        ))}
      </div>
    </>
  );
}
