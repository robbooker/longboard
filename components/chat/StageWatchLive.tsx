"use client";
// #502/#505: the red "LIVE · Watch live" button of a room whose live video is on. A real link that
// opens the stage in a tab of its own (lib/chatStageWindow.ts), so the room, Dual, Quad or Six view
// it was pressed in stays as it is. `compact` is the narrower one on a Dual, Quad or Six view card.
import { stageWatchClick, stageWatchLink } from "@/lib/chatStageWindow";
import styles from "./PublicChat.module.css";

export default function StageWatchLive({ room, roomLabel, compact }: { room: string; roomLabel?: string; compact?: boolean }) {
  return (
    <a
      {...stageWatchLink(room)}
      className={styles.stageLive}
      data-stage-watch-live={room}
      data-compact={compact || undefined}
      title="Watch live in a new tab"
      aria-label={roomLabel ? `${roomLabel} is live. Watch live in a new tab` : undefined}
      onClick={(event) => stageWatchClick(event, room)}
    >
      <b>
        <i aria-hidden="true" />
        LIVE
      </b>
      <span>{compact ? "Watch" : "Watch live"}</span>
    </a>
  );
}
