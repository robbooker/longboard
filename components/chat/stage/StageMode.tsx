"use client";
// #501/#502 Stage mode: a room "goes live" as a trading desk. This component draws the top bar and
// the stage (the video player and the stock on screen). The last column is the room's own chat:
// PublicChat keeps its message list, composer, outbox and typing indicator where they are, and
// StageMode.module.css lays them out as the right column in a compact style.
//  - A member (while the room is live) gets two columns: the video and stock, and the room chat.
//  - An admin also gets what is still a mock-up, labelled as samples: the chapters, the middle
//    column (trade tape, question queue) and the host line; plus the "Live video"
//    card with the room's stream address and key (#512). Members never see made-up trades or questions.
// Downloaded only when someone opens the stage. Questions, votes and chapters are local state: not
// saved anywhere. #507: the stock on screen is the host's choice for everyone (`hostOnScreen`, from
// the room's status and its "stage" signal); a member's own chip is local and changes only their view.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ChatRoom } from "@/lib/publicChat";
import { CHAT_STAGE_EVENT, stageElapsed, stageHref, type ChatStageEventDetail, type StageState } from "@/lib/chatStageMode";
import { parseStageOnScreen } from "@/lib/chatStageLive";
import StageBroadcastPanel from "./StageBroadcastPanel";
import StageVideo from "./StageVideo";
import StageStockPanel from "./StageStockPanel";
import {
  STAGE_CHAPTERS,
  STAGE_LIVE_CHAPTER,
  STAGE_QUESTIONS,
  STAGE_TRADES,
  type StageQuestion,
} from "./stageSample";
import styles from "./StageMode.module.css";

/** The timer in the top bar: how long this preview has been open. */
function Elapsed() {
  const started = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className={`${styles.mono} ${styles.secondary}`} data-stage-elapsed aria-label="Time live">
      {stageElapsed(now - started.current)}
    </span>
  );
}

export default function StageMode({
  room,
  roomLabel,
  presenceReady,
  chatterCount,
  admin,
  video,
  stageState,
  hostOnScreen,
  onStageRefresh,
  onExit,
}: {
  room: ChatRoom;
  roomLabel: string;
  presenceReady: boolean;
  chatterCount: number;
  /** A chat admin: the preview's sample panels and the room's stream address and key. */
  admin: boolean;
  /** Live video is set up on the server (LiveKit). */
  video: boolean;
  /** The room's live video as the server last said. */
  stageState: StageState;
  /** #507: the stock the host put on screen for everyone watching this room (null: none). */
  hostOnScreen: string | null;
  onStageRefresh: () => void;
  onExit: () => void;
}) {
  // What the player reports: whether the broadcast is playing here, and how many are watching.
  const [feed, setFeed] = useState<{ live: boolean; viewers: number | null }>({ live: false, viewers: null });
  const live = feed.live || (video && stageState === "live");
  // The address says the stage is open (/chat?room=<room>&stage=1) for as long as it is.
  useEffect(() => {
    const set = (on: boolean) => window.history.replaceState(window.history.state, "", stageHref(window.location.href, on));
    set(true);
    return () => set(false);
  }, []);
  // The menu that opened the stage is hidden now: focus moves to the stage's heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  const [handUp, setHandUp] = useState(false);
  const [chapter, setChapter] = useState<string>(STAGE_LIVE_CHAPTER);
  // This viewer's own chip (null: whatever is on screen). When the host changes the stock, someone
  // looking at another chip stays there and gets a "Now on screen" button; everyone else follows.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    // Looking at the very stock the host has on screen is following the host.
    if (picked && picked === hostOnScreen) setPicked(null);
  }, [picked, hostOnScreen]);
  // #507: the host (an admin, once the room has its stream key) sets the stock for everyone.
  const [hostBusy, setHostBusy] = useState(false);
  const [hostError, setHostError] = useState("");
  const setForEveryone = async (symbol: string | null) => {
    setHostBusy(true);
    setHostError("");
    try {
      const response = await fetch("/api/chat/stage/on-screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ room, symbol }),
      });
      const body = (await response.json().catch(() => null)) as { onScreen?: unknown; error?: unknown } | null;
      const onScreen = response.ok ? parseStageOnScreen(body?.onScreen) : null;
      if (!onScreen) {
        setHostError(
          body?.error === "not_started"
            ? "This room’s live video isn’t set up yet. Wait a moment for the stream key below, then try again."
            : "Couldn’t change the stock on screen. Please try again.",
        );
        return false;
      }
      // This page shows it at once, the same way as everyone else's (who hear it over the room's signal).
      const detail: ChatStageEventDetail = { room, onScreen };
      window.dispatchEvent(new CustomEvent(CHAT_STAGE_EVENT, { detail }));
      setPicked(null);
      return true;
    } catch {
      setHostError("Couldn’t change the stock on screen. Please try again.");
      return false;
    } finally {
      setHostBusy(false);
    }
  };
  const [voted, setVoted] = useState<ReadonlySet<string>>(() => new Set());
  const [asked, setAsked] = useState<StageQuestion[]>([]);
  const [draft, setDraft] = useState("");
  const questionId = useId();
  const ask = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim().slice(0, 240);
    if (!text) return;
    setAsked((list) => [...list, { id: `mine-${list.length + 1}`, votes: 0, text, by: "You · only on this device" }]);
    setDraft("");
  };

  return (
    <div className={styles.root} data-stage-root={room} data-stage-columns={admin ? 3 : 2}>
      <header className={styles.topBar}>
        <span className={styles.appMark} aria-hidden="true">
          L
        </span>
        <h1 ref={heading} tabIndex={-1} className={styles.roomName}>
          # {roomLabel}
        </h1>
        {(live || !video) && (
          <span className={styles.liveBadge} data-stage-live>
            LIVE
          </span>
        )}
        {admin && (
          <span className={styles.previewTag}>
            {video ? "Admin view · trades, questions and chapters are samples" : "Admin preview · sample video"}
          </span>
        )}
        {/* How long this preview has been open: not a real broadcast clock, so not shown to members. */}
        {admin && <Elapsed />}
        <span className={styles.spacer} />
        <span className={`${styles.mono} ${styles.secondary}`} data-stage-viewers>
          {feed.live && feed.viewers !== null
            ? `${feed.viewers} watching`
            : presenceReady
              ? `${chatterCount} online`
              : "Connecting…"}
        </span>
        {/* Raising a hand does nothing yet: part of the admin preview only. */}
        {admin && (
          <button type="button" className={styles.barButton} aria-pressed={handUp} onClick={() => setHandUp((up) => !up)}>
            {handUp ? "Hand raised" : "Raise hand"}
          </button>
        )}
        <button type="button" className={styles.barButton} data-stage-exit onClick={onExit}>
          {admin ? "Back to rooms" : "Back to the room"}
        </button>
      </header>

      <section className={styles.stageColumn} aria-label="Stage" data-stage-column="stage">
        <StageVideo
          roomId={room}
          roomLabel={roomLabel}
          admin={admin}
          video={video}
          stageState={stageState}
          onStageRefresh={onStageRefresh}
          onFeed={setFeed}
        />
        {admin && video && (
          <StageBroadcastPanel room={room} live={feed.live || stageState === "live"} onChanged={onStageRefresh} />
        )}
        {admin && (
          <div className={styles.chapters}>
            <h2 className={styles.label}>Chapters · sample</h2>
            <div className={styles.chapterRow}>
              {STAGE_CHAPTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.chapter}
                  aria-pressed={item.id === chapter}
                  data-stage-chapter={item.id}
                  onClick={() => setChapter(item.id)}
                >
                  <span className={`${styles.mono} ${styles.secondary}`}>{item.time}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <StageStockPanel
          host={hostOnScreen}
          picked={picked}
          onPick={setPicked}
          samples={admin}
          controls={admin && video ? { ready: stageState !== "off", busy: hostBusy, error: hostError, set: setForEveryone } : undefined}
        />
      </section>

      {admin && (
      <section className={styles.middleColumn} aria-label="Trades and questions" data-stage-column="trades">
        <h2 className={styles.label}>Trade tape · sample</h2>
        <ol className={`${styles.tape} ${styles.mono}`}>
          {STAGE_TRADES.map((trade, index) => (
            <li key={trade.id} data-latest={index === 0 || undefined}>
              <span className={styles.secondary}>{trade.time}</span>
              <span className={styles.tradeTag} data-tag={trade.tag}>
                {trade.tag}
              </span>
              <strong>{trade.sym}</strong>
              <span className={`${styles.tradeNote} ${styles.secondary}`}>{trade.note}</span>
            </li>
          ))}
        </ol>

        <h2 className={styles.label}>Question queue · sample</h2>
        <ul className={styles.questions}>
          {[...STAGE_QUESTIONS, ...asked].map((question) => {
            const on = voted.has(question.id);
            return (
              <li key={question.id} className={styles.question} data-stage-question={question.id}>
                <button
                  type="button"
                  className={styles.vote}
                  aria-pressed={on}
                  aria-label={`Upvote: ${question.text}`}
                  onClick={() =>
                    setVoted((current) => {
                      const next = new Set(current);
                      if (on) next.delete(question.id);
                      else next.add(question.id);
                      return next;
                    })
                  }
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                  <span className={styles.mono} data-stage-votes>
                    {question.votes + (on ? 1 : 0)}
                  </span>
                </button>
                <div className={styles.questionText}>
                  <span>{question.text}</span>
                  <small>{question.by}</small>
                </div>
              </li>
            );
          })}
        </ul>
        <form className={styles.ask} onSubmit={ask}>
          <label htmlFor={questionId} className={styles.srOnly}>
            Your question
          </label>
          <input
            id={questionId}
            className={styles.askInput}
            value={draft}
            maxLength={240}
            placeholder="Ask Rob a question"
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className={styles.askButton}>
            Ask
          </button>
        </form>
        <p className={styles.sampleNote}>Sample trades and questions, shown to admins only. Nothing here is saved or sent.</p>
      </section>
      )}
    </div>
  );
}
