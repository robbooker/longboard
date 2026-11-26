"use client";
// #506: a Dual, Quad or Six view card that is just a room's live video (the webinar): no chat, no
// stock panel, nothing else. While the room is not live it holds no video connection and downloads
// no player; it says so and waits. The player (and with it livekit-client) is downloaded when the
// room is live, and taken away again when the broadcast stops or ends, which closes the connection.
// #523:
//  - it learns the room is live from the page's one shared reader (hooks/useStageLiveRooms.ts,
//    through StageRoomsContext): one request for all the page's cards when it opens, one when a
//    room's "stage" signal arrives, one when the tab comes back. The card asks nothing itself;
//  - a card that is not on screen (another pane is expanded, or another card's tab is chosen on a
//    narrow screen: it stays mounted, hidden) lets go of its connection after a short grace, so
//    flipping between panes does not disconnect, and connects again when it is shown.
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CHAT_ROOMS, type ChatRoom } from "@/lib/publicChat";
import { useStageRoomsContext } from "../hooks/useStageLiveRooms";
import styles from "./cards.module.css";

const StageVideo = dynamic(() => import("../stage/StageVideo"), { ssr: false });
const nothing = () => undefined;
/** How long a hidden card keeps its connection (a browser test may shorten it outside production). */
export const LIVE_VIDEO_HIDDEN_GRACE_MS = 12_000;
const hiddenGrace = () =>
  (process.env.NODE_ENV !== "production" && (window as unknown as { __chatVideoCardHiddenMsForTests?: number }).__chatVideoCardHiddenMsForTests) ||
  LIVE_VIDEO_HIDDEN_GRACE_MS;

export default function LiveVideoCard({ room, visible = true }: { room: ChatRoom; visible?: boolean }) {
  const rooms = useStageRoomsContext();
  const stage = rooms.of(room);
  // The member's sound choice outlives the player, so a broadcast that drops and returns keeps it.
  const soundOn = useRef(false);
  const label = CHAT_ROOMS.find((item) => item.slug === room)?.label ?? room;
  const live = stage.state === "live";
  // #523: shown, or hidden for less than the grace. The timer exists only while a live card is hidden.
  const [held, setHeld] = useState(visible);
  useEffect(() => {
    if (visible) return setHeld(true);
    if (!live) return setHeld(false);
    const timer = setTimeout(() => setHeld(false), hiddenGrace());
    return () => clearTimeout(timer);
  }, [visible, live]);
  const refresh = useRef(() => undefined as void);
  refresh.current = () => rooms.refresh(room);
  const onStageRefresh = useRef(() => refresh.current()).current;
  return (
    <div className={styles.liveVideo} data-card-live-video={room} data-live={live || undefined} data-card-live-video-held={(live && held) || undefined}>
      {live && held ? (
        // Watch-only, for an admin too: starting and ending the broadcast stay on the stage itself.
        <StageVideo
          fill
          roomId={room}
          roomLabel={label}
          admin={false}
          video
          stageState={stage.state}
          onStageRefresh={onStageRefresh}
          onFeed={nothing}
          soundOn={soundOn}
        />
      ) : (
        <p className={styles.liveVideoNote} role="status" data-card-live-video-off>
          {live ? (
            <span>The video plays here when this card is shown.</span>
          ) : stage.answered ? (
            <>
              <strong># {label} isn’t live right now</strong>
              <span>The video starts here by itself when it goes live.</span>
            </>
          ) : (
            <span>Checking for live video…</span>
          )}
        </p>
      )}
    </div>
  );
}
