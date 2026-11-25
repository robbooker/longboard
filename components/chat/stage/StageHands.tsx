"use client";
// #508: the admin's "Hands up" list: who has a hand up, in the order raised (oldest first), how long
// ago, and the controls that lower one hand or all of them. Members never see this list (their page
// shows only their own hand and a count). Names are the display names already used in chat.
import { useEffect, useState } from "react";
import { stageHandAgo, stageHandCountLabel, type StageHand } from "@/lib/chatStageHand";
import styles from "./StageHands.module.css";

export default function StageHands({
  hands,
  busy,
  error,
  onLower,
  onLowerAll,
}: {
  hands: readonly StageHand[];
  busy: boolean;
  error: string;
  onLower: (hand: StageHand) => void;
  onLowerAll: () => void;
}) {
  // "2 min ago" keeps up while anyone is waiting.
  const [now, setNow] = useState(() => Date.now());
  const waiting = hands.length > 0;
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [waiting, hands]);
  return (
    <section className={styles.hands} aria-label="Hands up" data-stage-hands={hands.length}>
      <div className={styles.head}>
        <h2 className={styles.title} aria-live="polite">
          Hands up{waiting ? ` · ${hands.length}` : ""}
        </h2>
        {hands.length > 1 && (
          <button type="button" className={styles.lower} data-stage-hands-lower-all disabled={busy} onClick={onLowerAll}>
            Lower all
          </button>
        )}
      </div>
      {waiting ? (
        <ol className={styles.list} aria-label={stageHandCountLabel(hands.length)}>
          {hands.map((hand, index) => (
            <li key={hand.member} className={styles.row} data-stage-hand-of={hand.member}>
              <span className={styles.place} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.who}>
                <span className={styles.name} data-stage-hand-name>
                  {hand.name || "A member"}
                </span>
                <small data-stage-hand-ago>{stageHandAgo(hand.at, now)}</small>
              </span>
              <button
                type="button"
                className={styles.lower}
                aria-label={`Lower ${hand.name || "this member"}’s hand`}
                data-stage-hand-lower
                disabled={busy}
                onClick={() => onLower(hand)}
              >
                Lower
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>Nobody has a hand up. Anyone watching can raise one; only admins see who.</p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
