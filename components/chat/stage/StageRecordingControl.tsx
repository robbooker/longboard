"use client";
// #524: an admin's small control under a room's ended live-video notice: "Add recording link", or
// "Change" and "Remove" once it has one. Downloaded only for admins, only when such a notice is on
// screen. The server checks everything again (admin, room, a YouTube or Loom link).
import { useState, type FormEvent } from "react";
import { stageRecordingUrl } from "@/lib/chatStageRecording";
import styles from "./StageRecordingControl.module.css";

const PROBLEMS: Record<string, string> = {
  invalid_link: "That is not a YouTube or Loom video link.",
  not_ended_notice: "This notice can't take a recording.",
};

export default function StageRecordingControl({ room, messageId, recordingUrl }: { room: string; messageId: string; recordingUrl: string | null }) {
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const save = async (url: string | null) => {
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch("/api/chat/stage/recording", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ room, message: messageId, url }),
      });
      if (response.ok) {
        // The room reloads the notice by itself (everyone showing it is told).
        setEditing(false);
        setLink("");
      } else {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setProblem(PROBLEMS[body?.error ?? ""] ?? "That did not save. Please try again.");
      }
    } catch {
      setProblem("That did not save. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!stageRecordingUrl(link)) setProblem(PROBLEMS.invalid_link);
    else void save(link.trim());
  };
  if (editing)
    return (
      <form className={styles.form} onSubmit={submit} data-stage-recording-form>
        <input
          className={styles.input}
          type="url"
          inputMode="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="YouTube or Loom link"
          aria-label="Recording link (YouTube or Loom)"
          autoFocus
          disabled={busy}
        />
        <button type="submit" className={styles.action} disabled={busy || !link.trim()}>
          Save
        </button>
        <button type="button" className={styles.action} disabled={busy} onClick={() => (setEditing(false), setProblem(""))}>
          Cancel
        </button>
        {problem ? (
          <span className={styles.problem} role="alert">
            {problem}
          </span>
        ) : null}
      </form>
    );
  return (
    <div className={styles.row} data-stage-recording-control>
      <button type="button" className={styles.action} disabled={busy} onClick={() => setEditing(true)}>
        {recordingUrl ? "Change" : "Add recording link"}
      </button>
      {recordingUrl ? (
        <button type="button" className={styles.action} disabled={busy} onClick={() => void save(null)}>
          Remove
        </button>
      ) : null}
      {problem ? (
        <span className={styles.problem} role="alert">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
