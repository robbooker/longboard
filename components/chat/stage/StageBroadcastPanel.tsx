"use client";
// #502/#512: the admin's "Live video" card under the player: the room's stream address and key to
// paste into StreamYard (custom RTMP destination). #512: they are the room's for good, shown as soon
// as the card opens; there is no start and no end, the room is live while StreamYard broadcasts.
// "Reset key" (with a confirmation step in the card) replaces the key. Admins only: the server
// refuses everyone else (/api/chat/stage/live). The stream key is a secret: it is held only in this
// component's memory, shown masked until revealed, and never logged or sent anywhere else.
import { useEffect, useId, useRef, useState } from "react";
import { CHAT_STAGE_EVENT, parseStageState, type ChatStageEventDetail, type StageState } from "@/lib/chatStageLive";
import type { ChatRoom } from "@/lib/publicChat";
import styles from "./StageMode.module.css";

type Broadcast = { state: StageState; address?: string; streamKey?: string; extra?: number };
const parse = (body: { state?: unknown; address?: unknown; streamKey?: unknown; extra?: unknown } | null): Broadcast | null =>
  body && typeof body === "object" && "state" in body
    ? {
        state: parseStageState(body.state),
        ...(typeof body.address === "string" && typeof body.streamKey === "string"
          ? { address: body.address, streamKey: body.streamKey }
          : {}),
        ...(typeof body.extra === "number" && body.extra > 0 ? { extra: body.extra } : {}),
      }
    : null;
const ask = (room: ChatRoom, action: "open" | "reset", signal?: AbortSignal) =>
  fetch("/api/chat/stage/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ room, action }),
    signal,
  });

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
  live,
  onChanged,
}: {
  room: ChatRoom;
  /** The room is live: StreamYard is broadcasting to it. */
  live: boolean;
  /** After the room's key was made or reset: ask the room's status again. */
  onChanged: () => void;
}) {
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [wasReset, setWasReset] = useState(false);
  const addressId = useId();
  const keyId = useId();
  const confirmId = useId();
  const changed = useRef(onChanged);
  changed.current = onChanged;
  // The room's address and key, as soon as the card opens: the ones the room already has, always;
  // the server makes them only the first time, for a room that has none.
  useEffect(() => {
    const controller = new AbortController();
    setBroadcast(null);
    setError("");
    setReveal(false);
    setConfirmReset(false);
    setWasReset(false);
    const failed = () => !controller.signal.aborted && setError("Couldn’t get the stream address and key. Check the LiveKit keys, then open the stage again.");
    ask(room, "open", controller.signal)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        const read = parse(body);
        if (!read?.streamKey) return failed();
        setBroadcast(read);
        // Made just now (this room's first time): the room's status has changed from "off".
        if ((body as { created?: unknown }).created === true) changed.current();
      })
      .catch(failed);
    // Another admin reset the key (a "stage" signal that is not about the stock on screen): read it
    // again, so this card never shows a key that has stopped working. Reading changes nothing.
    const signal = (event: Event) => {
      const detail = (event as CustomEvent<ChatStageEventDetail>).detail;
      if (detail?.room !== room || detail.onScreen) return;
      fetch(`/api/chat/stage/live?room=${encodeURIComponent(room)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          const read = parse(body);
          if (controller.signal.aborted || !read?.streamKey) return;
          setBroadcast((current) => {
            if (current?.streamKey && current.streamKey !== read.streamKey) setReveal(false);
            return read;
          });
        })
        .catch(() => undefined);
    };
    window.addEventListener(CHAT_STAGE_EVENT, signal);
    return () => {
      controller.abort();
      window.removeEventListener(CHAT_STAGE_EVENT, signal);
    };
  }, [room]);
  const reset = async () => {
    setResetting(true);
    setError("");
    try {
      const response = await ask(room, "reset");
      const read = response.ok ? parse(await response.json()) : null;
      if (!read?.streamKey) throw new Error("failed");
      setBroadcast(read);
      setReveal(false);
      setConfirmReset(false);
      setWasReset(true);
      onChanged();
    } catch {
      setError("Couldn’t reset the stream key. Please try again.");
    } finally {
      setResetting(false);
    }
  };
  const ready = !!broadcast?.address && !!broadcast.streamKey;
  return (
    <section className={styles.broadcast} aria-label="Live video" data-stage-broadcast={ready ? (live ? "live" : "ready") : "loading"}>
      <div className={styles.stockHead}>
        <h2 className={styles.label}>Live video · admins only</h2>
        <span className={styles.spacer} />
        {ready && (
          <span className={styles.broadcastState} data-live={live || undefined} role="status">
            {live ? "Live: members of this room can watch" : "Waiting for StreamYard to start broadcasting"}
          </span>
        )}
      </div>
      {!ready ? (
        !error && (
          <p className={styles.newsNote} role="status">
            Getting this room’s stream address and key…
          </p>
        )
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
          {wasReset && (
            <p className={styles.newsNote} role="status" data-stage-key-reset-done>
              This is a new stream key. Paste it into StreamYard before the next broadcast; the old key no longer works.
            </p>
          )}
          {!!broadcast!.extra && (
            <p className={styles.newsNote} data-stage-key-extra>
              LiveKit has {broadcast!.extra} other stream {broadcast!.extra === 1 ? "key" : "keys"} for this room, and{" "}
              {broadcast!.extra === 1 ? "it still works" : "they still work"}. Reset key removes {broadcast!.extra === 1 ? "it" : "them"}.
            </p>
          )}
          <div className={styles.broadcastRow}>
            {confirmReset ? (
              <>
                <p id={confirmId} className={styles.newsNote} role="alert" data-stage-key-reset-warning>
                  Reset this room’s stream key? The old key stops working immediately, any broadcast using it is cut off,
                  and the new key must be pasted into StreamYard.
                </p>
                <button type="button" className={styles.dangerButton} aria-describedby={confirmId} data-stage-key-reset-confirm disabled={resetting} onClick={() => void reset()}>
                  {resetting ? "Resetting…" : "Reset key"}
                </button>
                <button type="button" className={styles.barButton} data-stage-key-reset-cancel disabled={resetting} onClick={() => setConfirmReset(false)}>
                  Keep this key
                </button>
              </>
            ) : (
              <>
                <p className={styles.newsNote}>
                  In StreamYard, add a custom RTMP destination with this address and key. You only do it once: they stay the
                  same for this room. Going live in StreamYard puts the video on for members, and stopping takes it off. Keep
                  the key private: anyone with it can broadcast to this room.
                </p>
                <button type="button" className={styles.barButton} data-stage-key-reset onClick={() => setConfirmReset(true)}>
                  Reset key
                </button>
              </>
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
