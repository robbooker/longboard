"use client";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import styles from "../PublicChat.module.css";
import type { ActionState } from "./types";

/** Shown to a signed-in member who has not linked a chat name yet. */
export default function NameGate({
  onSubmit,
  nameDraft,
  setNameDraft,
  nameState,
  setNameState,
  error,
  setError,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  nameDraft: string;
  setNameDraft: Dispatch<SetStateAction<string>>;
  nameState: ActionState;
  setNameState: Dispatch<SetStateAction<ActionState>>;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
}) {
  return (
    <div className={styles.gate}>
      <form className={styles.gateForm} onSubmit={onSubmit}>
        <h1 className={styles.gateTitle}>
          Your member name. <span>Join the room.</span>
        </h1>
        <p className={styles.gateCopy}>
          Link this name to your account to chat and receive private message requests across devices.
        </p>
        <label className={styles.nameLabel} htmlFor="longboard-chat-name">
          Your chat name
        </label>
        <input
          id="longboard-chat-name"
          className={styles.nameInput}
          value={nameDraft}
          maxLength={28}
          autoComplete="nickname"
          autoFocus
          placeholder="Enter the name you want to use"
          aria-invalid={nameState === "error"}
          onChange={(event) => {
            setNameDraft(event.target.value);
            setError("");
            setNameState("default");
          }}
        />
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={nameState === "loading"}
          data-state={nameState}
        >
          {nameState === "loading" ? "JOINING…" : "LINK NAME & JOIN"}
        </button>
        <p className={styles.feedback} data-error={Boolean(error)} aria-live="polite">
          {error}
        </p>
      </form>
    </div>
  );
}
