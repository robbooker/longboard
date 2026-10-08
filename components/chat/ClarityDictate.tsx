"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./ClarityReview.module.css";

const MAX_MS = 4 * 60_000;
function recorderType() {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"])
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  return "";
}

/**
 * Dictate → stop → the transcript is inserted into the composer for review. The audio is sent
 * only for transcription; it is never attached to or sent as a message.
 */
export function ClarityDictate({
  conversationId,
  disabled,
  onText,
  onError,
}: {
  conversationId: string;
  disabled: boolean;
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const owner = useRef(conversationId);
  owner.current = conversationId;

  function stopTracks() {
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
  }
  // Switching conversations or unmounting discards any recording in progress.
  useEffect(
    () => () => {
      cancelled.current = true;
      clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stopTracks();
    },
    [conversationId],
  );

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
      return onError("Dictation isn't supported in this browser. Type your message instead.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError("Microphone access was blocked. Allow it in your browser settings to dictate.");
    }
    const type = recorderType();
    const next = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    cancelled.current = false;
    const forConversation = conversationId;
    next.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    next.onstop = async () => {
      clearTimeout(timer.current);
      stopTracks();
      if (cancelled.current || owner.current !== forConversation) return setState("idle");
      setState("transcribing");
      try {
        const audio = new Blob(chunks.current, {
          type: (next.mimeType || type || "audio/webm").split(";")[0],
        });
        const form = new FormData();
        form.set("conversationId", forConversation);
        form.set("file", audio, "dictation");
        const response = await fetch("/api/chat/clarity/transcribe", { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(data.error || "Transcription failed. Try again or type your message.");
        if (owner.current === forConversation && typeof data.text === "string") onText(data.text);
      } catch (e) {
        if (owner.current === forConversation)
          onError(e instanceof Error ? e.message : "Transcription failed.");
      } finally {
        chunks.current = [];
        setState("idle");
      }
    };
    recorder.current = next;
    next.start();
    setState("recording");
    timer.current = setTimeout(() => next.state === "recording" && next.stop(), MAX_MS);
  }

  return (
    <span className={styles.tools}>
      {state === "recording" ? (
        <>
          <button
            type="button"
            className={styles.tool}
            data-recording="true"
            onClick={() => recorder.current?.stop()}
          >
            ■ Stop dictating
          </button>
          <button
            type="button"
            className={styles.tool}
            onClick={() => {
              cancelled.current = true;
              recorder.current?.stop();
            }}
          >
            Discard
          </button>
        </>
      ) : (
        <button
          type="button"
          className={styles.tool}
          disabled={disabled || state !== "idle"}
          onClick={() => void start()}
        >
          {state === "transcribing" ? "Transcribing…" : "🎙 Dictate"}
        </button>
      )}
    </span>
  );
}
