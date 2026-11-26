"use client";
// #506: a Dual, Quad or Six view card that is just a room's live video (the webinar): no chat, no
// stock panel, nothing else. While the room is not live it holds no video connection and downloads
// no player; it says so and waits. It learns the room is live the way the room itself does
// (useStageStatus): one small status read when the card appears, one when the room's "stage" signal
// arrives over the page's own Ably connection, and one when the tab comes back after a while. Never
// on a timer. The player (and with it livekit-client) is downloaded when the room is live, and
// taken away again when the broadcast stops or ends, which closes the connection.
import { useRef } from "react";
import dynamic from "next/dynamic";
import { CHAT_ROOMS, type ChatRoom } from "@/lib/publicChat";
import { useStageStatus } from "../hooks/useStageStatus";
import styles from "./cards.module.css";

const StageVideo = dynamic(() => import("../stage/StageVideo"), { ssr: false });
const nothing = () => undefined;

export default function LiveVideoCard({ room }: { room: ChatRoom }) {
  const stage = useStageStatus(room);
  // The member's sound choice outlives the player, so a broadcast that drops and returns keeps it.
  const soundOn = useRef(false);
  const label = CHAT_ROOMS.find((item) => item.slug === room)?.label ?? room;
  const live = stage.state === "live";
  return (
    <div className={styles.liveVideo} data-card-live-video={room} data-live={live || undefined}>
      {live ? (
        // Watch-only, for an admin too: starting and ending the broadcast stay on the stage itself.
        <StageVideo
          fill
          roomId={room}
          roomLabel={label}
          admin={false}
          video
          stageState={stage.state}
          onStageRefresh={stage.refresh}
          onFeed={nothing}
          soundOn={soundOn}
        />
      ) : (
        <p className={styles.liveVideoNote} role="status" data-card-live-video-off>
          {stage.answered ? (
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
