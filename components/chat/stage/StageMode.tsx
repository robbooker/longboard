"use client";
// #501 Stage mode (admin-only preview): a room "goes live" as a three-column trading desk. This
// component draws the top bar, the stage (video, chapters, the stock on screen) and the middle
// column (trade tape, question queue). The third column is the room's own chat: PublicChat keeps
// its message list, composer, outbox and typing indicator where they are, and StageMode.module.css
// lays them out as the right column in a compact style. Downloaded only when an admin opens it.
// Local state only: questions, votes, chapters and the stock on screen are not saved anywhere.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ChatRoom } from "@/lib/publicChat";
import { stageElapsed, stageHref } from "@/lib/chatStageMode";
import StageVideo, { StageOverlayCard } from "./StageVideo";
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
  onExit,
}: {
  room: ChatRoom;
  roomLabel: string;
  presenceReady: boolean;
  chatterCount: number;
  onExit: () => void;
}) {
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
  // The stock on screen. One setter, so an admin action or a realtime event can drive it later.
  const [onScreen, setOnScreen] = useState<string | null>(null);
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
    <div className={styles.root} data-stage-root={room}>
      <header className={styles.topBar}>
        <span className={styles.appMark} aria-hidden="true">
          L
        </span>
        <h1 ref={heading} tabIndex={-1} className={styles.roomName}>
          # {roomLabel}
        </h1>
        <span className={styles.liveBadge}>LIVE</span>
        <span className={styles.previewTag}>Admin preview · sample video</span>
        <Elapsed />
        <span className={styles.spacer} />
        <span className={`${styles.mono} ${styles.secondary}`} data-stage-viewers>
          {presenceReady ? `${chatterCount} online` : "Connecting…"}
        </span>
        <button type="button" className={styles.barButton} aria-pressed={handUp} onClick={() => setHandUp((up) => !up)}>
          {handUp ? "Hand raised" : "Raise hand"}
        </button>
        <button type="button" className={styles.barButton} data-stage-exit onClick={onExit}>
          Back to rooms
        </button>
      </header>

      <section className={styles.stageColumn} aria-label="Stage" data-stage-column="stage">
        <StageVideo roomId={room} overlay={<StageOverlayCard tag="WATCH" sym="APUS" note="details below the video" />} />
        <div className={styles.chapters}>
          <h2 className={styles.label}>Chapters · tap to rewind</h2>
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
        <StageStockPanel onScreen={onScreen} onSelect={setOnScreen} />
      </section>

      <section className={styles.middleColumn} aria-label="Trades and questions" data-stage-column="trades">
        <h2 className={styles.label}>Trade tape</h2>
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

        <h2 className={styles.label}>Question queue</h2>
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
        <p className={styles.sampleNote}>Sample trades and questions. Nothing here is saved or sent.</p>
      </section>
    </div>
  );
}
