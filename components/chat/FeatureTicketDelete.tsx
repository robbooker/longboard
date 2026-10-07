"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./FeatureChannel.module.css";
export type TicketDeleteTarget = { id: string; revision: number };
export default function FeatureTicketDelete({
  target,
  viewerId,
  busy,
  onDelete,
}: {
  target: TicketDeleteTarget;
  viewerId: string;
  busy: boolean;
  onDelete: (target: TicketDeleteTarget) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<TicketDeleteTarget | null>(null);
  useEffect(() => {
    setConfirmation(null);
    dialog.current?.close();
  }, [target.id, viewerId]);
  useEffect(() => {
    if (confirmation) {
      dialog.current?.showModal();
      cancel.current?.focus();
    } else dialog.current?.close();
  }, [confirmation]);
  return (
    <div className={styles.deleteAction}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirmation({ id: target.id, revision: target.revision })}
      >
        Delete ticket
      </button>
      <small>Only your unsubmitted draft can be deleted. Its discussion will also be removed.</small>
      <dialog
        ref={dialog}
        className={styles.deleteDialog}
        aria-labelledby="delete-ticket-question"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setConfirmation(null);
        }}
      >
        <h2 id="delete-ticket-question">Are you sure you want to delete this ticket?</h2>
        <p>This permanently removes this draft and its discussion.</p>
        <div className={styles.actions}>
          <button ref={cancel} type="button" disabled={busy} onClick={() => setConfirmation(null)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !confirmation}
            onClick={async () => {
              if (!confirmation) return;
              await onDelete(confirmation);
              setConfirmation(null);
            }}
          >
            {busy ? "Deleting…" : "Confirm"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
