"use client";

import { useState } from "react";
import AgentAvatar from "./AgentAvatar";
import ActionBadge from "./ActionBadge";
import AskPlaceholder from "./AskPlaceholder";
import CommentThread from "./CommentThread";
import { fmtQty, fmtTime, fmtUSD, fmtWeight } from "@/lib/arena/format";
import type { FeedItem } from "@/lib/arena/types";

type Props = {
  item: FeedItem;
};

export default function FeedCard({ item }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { event, agent, comments, commentAuthors } = item;

  return (
    <article className="feed-card">
      <div className="feed-card-header">
        <div className="feed-card-agent">
          <AgentAvatar agent={agent} />
          <div>
            <div className="agent-name">{agent.displayName}</div>
            <div className="feed-card-meta">{fmtTime(event.createdAt)} ET</div>
          </div>
        </div>
        <div className="feed-card-actions">
          <ActionBadge side={event.side} />
          <span className="confidence-chip">{event.confidence}% conf.</span>
          <AskPlaceholder />
        </div>
      </div>

      <div className="feed-card-body">
        <h2 className="feed-card-headline">{event.headline}</h2>
        <div className="feed-card-trade-row">
          <span>
            <strong>{event.symbol}</strong> · {event.companyName}
          </span>
          <span>
            {fmtQty(event.quantity)} sh @ {fmtUSD(event.price, 2)}
          </span>
          <span>Notional {fmtUSD(event.notional)}</span>
          <span>
            Weight {fmtWeight(event.weightBefore)} → {fmtWeight(event.weightAfter)}
          </span>
        </div>
        <p className="feed-card-thesis">{event.thesis}</p>
        <p className="feed-card-impact">
          {event.symbol} now {fmtWeight(event.weightAfter)} of {agent.displayName}&apos;s portfolio
        </p>
      </div>

      <div className="feed-card-reasoning">
        <button
          type="button"
          className="feed-card-reasoning-toggle"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide reasoning" : "Show reasoning"}
        </button>
        {expanded && (
          <p className="feed-card-reasoning-text">{event.reasoning}</p>
        )}
      </div>

      <CommentThread comments={comments} authors={commentAuthors} />
    </article>
  );
}
