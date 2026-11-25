"use client";
// #501/#502 Stage mode: a room "goes live" as a trading desk. This component draws the top bar and
// the stage (the video player and the stock on screen). The last column is the room's own chat:
// PublicChat keeps its message list, composer, outbox and typing indicator where they are, and
// StageMode.module.css lays them out as the right column in a compact style.
//  - A member (while the room is live) gets two columns: the video and stock, and the room chat.
//  - #508: anyone watching the live video can raise a hand (top bar) and see who has one up. An
//    admin's "Hands up" list is at the top of the middle column, with the controls that lower hands;
//    a member's opens from the count in the top bar and drops over the top of the room chat, so it
//    never covers the video or moves the chat. Real, not a sample: see useStageHand.ts.
//  - An admin also gets what is still a mock-up, labelled as samples: the chapters, the middle
//    column (trade tape, question queue) and the host line; plus the "Live video"
//    card that starts and ends the broadcast. Members never see made-up trades or questions.
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
import StageHands from "./StageHands";
import handStyles from "./StageHands.module.css";
import { useStageHand } from "./useStageHand";
import { stageHandCountLabel } from "@/lib/chatStageHand";
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
  /** A chat admin: the preview's sample panels and the controls that start and end live video. */
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

  // #508: raising a hand, for everyone watching the live video. The host sees who (StageHands).
  const hand = useStageHand(room);
  // A member's list of who has a hand up: opened from the count in the top bar.
  const [handsOpen, setHandsOpen] = useState(false);
  const handsId = useId();
  const [chapter, setChapter] = useState<string>(STAGE_LIVE_CHAPTER);
  // This viewer's own chip (null: whatever is on screen). When the host changes the stock, someone
  // looking at another chip stays there and gets a "Now on screen" button; everyone else follows.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    // Looking at the very stock the host has on screen is following the host.
    if (picked && picked === hostOnScreen) setPicked(null);
  }, [picked, hostOnScreen]);
  // #507: the host (an admin, once the room's live video is started) sets the stock for everyone.
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
            ? "Start live video first: a stock can be put on screen once it has started."
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
      <header className={`${styles.topBar} ${handStyles.anchor}`}>
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
        {/* #508: anyone watching the live video can raise a hand; everyone sees how many are up. */}
        {hand.connected && (live || hand.raised) && (
          <>
            {hand.error && !admin && (
              <span className={handStyles.barError} role="alert" data-stage-hand-error>
                {hand.error}
              </span>
            )}
            <span className={handStyles.count} role="status" data-stage-hand-count={hand.count}>
              {hand.count === 0 ? (
                ""
              ) : admin ? (
                stageHandCountLabel(hand.count)
              ) : (
                <button
                  type="button"
                  className={handStyles.countButton}
                  aria-expanded={handsOpen}
                  aria-controls={handsId}
                  data-stage-hands-toggle
                  onClick={() => setHandsOpen((open) => !open)}
                >
                  {stageHandCountLabel(hand.count)}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                    <path d={handsOpen ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
                  </svg>
                </button>
              )}
            </span>
            {/* A member's list drops from the top bar's right end, over the top of the room chat. */}
            {!admin && handsOpen && hand.count > 0 && (
              <div
                id={handsId}
                className={handStyles.panel}
                data-stage-hands-panel
                onKeyDown={(event) => {
                  if (event.key === "Escape") setHandsOpen(false);
                }}
              >
                <StageHands hands={hand.hands} busy={false} error="" />
                <button type="button" className={handStyles.close} data-stage-hands-close onClick={() => setHandsOpen(false)}>
                  Close
                </button>
              </div>
            )}
            <button
              type="button"
              className={styles.barButton}
              aria-pressed={hand.raised}
              data-stage-hand={hand.raised ? "up" : "down"}
              aria-busy={hand.busy || undefined}
              onClick={hand.toggle}
            >
              {hand.raised ? "Lower hand" : "Raise hand"}
            </button>
          </>
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
          <StageBroadcastPanel room={room} stageState={stageState} live={feed.live} onChanged={onStageRefresh} />
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
        {video && (
          <StageHands hands={hand.hands} busy={hand.busy} error={hand.error} onLower={hand.lower} onLowerAll={hand.lowerAll} />
        )}
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
