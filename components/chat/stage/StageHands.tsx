"use client";
// #508: the "Hands up" list: who has a hand up, in the order raised (oldest first) and how long ago.
// Everyone watching may see it. An admin's (`onLower`, `onLowerAll`) also has the controls that
// lower one hand or all of them; a member's is read-only (their own hand is the top bar's button).
// Names are the display names already used in chat.
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
  /** Admin only: lower one person's hand. Left out, the list is read-only. */
  onLower?: (hand: StageHand) => void;
  /** Admin only: lower every hand. */
  onLowerAll?: () => void;
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
        {onLowerAll && hands.length > 1 && (
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
              {onLower && (
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
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>Nobody has a hand up. Anyone watching can raise one.</p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
