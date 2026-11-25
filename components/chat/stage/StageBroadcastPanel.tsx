"use client";
// #502: the admin's "Live video" card under the player: start the room's live video, see the stream
// address and key to paste into StreamYard (custom RTMP destination), and end it. Admins only: the
// server refuses everyone else (/api/chat/stage/live). The stream key is a secret: it is held only
// in this component's memory, shown masked until revealed, and never logged or sent anywhere else.
import { useEffect, useId, useRef, useState } from "react";
import { parseStageState, type StageState } from "@/lib/chatStageLive";
import type { ChatRoom } from "@/lib/publicChat";
import styles from "./StageMode.module.css";

type Broadcast = { state: StageState; address?: string; streamKey?: string };
const parse = (body: { state?: unknown; address?: unknown; streamKey?: unknown } | null): Broadcast | null =>
  body && typeof body === "object" && "state" in body
    ? {
        state: parseStageState(body.state),
        ...(typeof body.address === "string" && typeof body.streamKey === "string"
          ? { address: body.address, streamKey: body.streamKey }
          : {}),
      }
    : null;

function CopyButton({ value, name }: { value: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={styles.barButton}
      aria-label={`Copy ${name}`}
      data-stage-copy={name}
      onClick={() =>
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => undefined)
      }
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export default function StageBroadcastPanel({
  room,
  stageState,
  live,
  onChanged,
}: {
  room: ChatRoom;
  /** The room's status as the server last said. */
  stageState: StageState;
  /** The broadcast is playing in this admin's player. */
  live: boolean;
  /** After a start or an end: ask the room's status again. */
  onChanged: () => void;
}) {
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [busy, setBusy] = useState<"start" | "end" | null>(null);
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const addressId = useId();
  const keyId = useId();
  // What is already started (another admin, or this one earlier): its address and key.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/chat/stage/live?room=${encodeURIComponent(room)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        const read = parse(body);
        if (read) setBroadcast(read);
        else setError("Couldn’t read the live video’s settings. Check the LiveKit keys.");
      })
      .catch(() => undefined);
    return () => controller.abort();
    // The status moving between off and started (another admin started or ended it) is read again.
  }, [room, stageState === "off"]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (action: "start" | "end") => {
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/chat/stage/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ room, action }),
      });
      const read = response.ok ? parse(await response.json()) : null;
      if (!read) throw new Error("failed");
      setBroadcast(read);
      setReveal(false);
      setConfirmEnd(false);
      onChanged();
    } catch {
      setError(action === "start" ? "Couldn’t start live video. Please try again." : "Couldn’t end live video. Please try again.");
    } finally {
      setBusy(null);
    }
  };
  const started = !!broadcast?.address && !!broadcast.streamKey;
  return (
    <section className={styles.broadcast} aria-label="Live video" data-stage-broadcast={started ? (live ? "live" : "started") : "off"}>
      <div className={styles.stockHead}>
        <h2 className={styles.label}>Live video · admins only</h2>
        <span className={styles.spacer} />
        {started && (
          <span className={styles.broadcastState} data-live={live || undefined} role="status">
            {live ? "Live: members of this room can watch" : "Waiting for StreamYard to start broadcasting"}
          </span>
        )}
      </div>
      {!started ? (
        <div className={styles.broadcastRow}>
          <p className={styles.newsNote}>
            Starting gives you a stream address and key for StreamYard. Members see a LIVE button in this room once
            StreamYard is broadcasting.
          </p>
          <button
            type="button"
            className={styles.askButton}
            data-stage-start
            disabled={busy !== null || broadcast === null}
            onClick={() => void act("start")}
          >
            {busy === "start" ? "Starting…" : "Start live video"}
          </button>
        </div>
      ) : (
        <>
          <div className={styles.broadcastField}>
            <label htmlFor={addressId}>Stream address</label>
            <input id={addressId} className={`${styles.askInput} ${styles.mono}`} readOnly value={broadcast!.address} data-stage-address onFocus={(event) => event.target.select()} />
            <CopyButton value={broadcast!.address!} name="stream address" />
          </div>
          <div className={styles.broadcastField}>
            <label htmlFor={keyId}>Stream key</label>
            <input
              id={keyId}
              className={`${styles.askInput} ${styles.mono}`}
              readOnly
              type={reveal ? "text" : "password"}
              autoComplete="off"
              value={broadcast!.streamKey}
              data-stage-key
              onFocus={(event) => event.target.select()}
            />
            <button type="button" className={styles.barButton} aria-pressed={reveal} data-stage-key-reveal onClick={() => setReveal((on) => !on)}>
              {reveal ? "Hide" : "Show"}
            </button>
            <CopyButton value={broadcast!.streamKey!} name="stream key" />
          </div>
          <div className={styles.broadcastRow}>
            <p className={styles.newsNote}>
              In StreamYard, add a custom RTMP destination with this address and key, then go live. Keep the key private:
              anyone with it can broadcast to this room. Stopping StreamYard takes the video off for members and keeps
              this address and key for next time; ending removes them.
            </p>
            {confirmEnd ? (
              <>
                <button type="button" className={styles.dangerButton} data-stage-end-confirm disabled={busy !== null} onClick={() => void act("end")}>
                  {busy === "end" ? "Ending…" : "End for everyone"}
                </button>
                <button type="button" className={styles.barButton} disabled={busy !== null} onClick={() => setConfirmEnd(false)}>
                  Keep going
                </button>
              </>
            ) : (
              <button type="button" className={styles.barButton} data-stage-end onClick={() => setConfirmEnd(true)}>
                End live video
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className={styles.broadcastError} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
