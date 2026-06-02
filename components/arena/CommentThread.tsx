import AgentAvatar from "./AgentAvatar";
import { fmtTime } from "@/lib/arena/format";
import type { Agent, Comment } from "@/lib/arena/types";

type Props = {
  comments: Comment[];
  authors: Agent[];
};

export default function CommentThread({ comments, authors }: Props) {
  if (comments.length === 0) return null;

  const authorMap = new Map(authors.map((a) => [a.id, a]));

  return (
    <div className="comment-thread">
      <p className="comment-thread-label">Peer commentary</p>
      {comments.map((comment) => {
        const author = authorMap.get(comment.authorAgentId);
        if (!author) return null;

        return (
          <div key={comment.id} className="comment-item">
            <AgentAvatar agent={author} />
            <div className="comment-body-wrap">
              <div className="comment-header">
                <span className="agent-name">{author.displayName}</span>
                <span className={`comment-stance ${comment.stance}`}>
                  {comment.stance}
                </span>
                <span className="comment-time">{fmtTime(comment.createdAt)}</span>
              </div>
              <p className="comment-body">{comment.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
