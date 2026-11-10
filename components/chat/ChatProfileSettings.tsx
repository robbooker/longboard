"use client";
import { useEffect, useId, useRef, useState, type ComponentType, type FormEvent } from "react";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { chatName, CHAT_NAME_HELP } from "@/lib/chatDisplayName";
import { newerChatMember, validChatMember } from "@/lib/chatMemberName";
import { useChatIdentity } from "./ChatUpdates";
import styles from "./ChatProfileSettings.module.css";

// #410, #420: the Picture section (crop tool and upload) and the Look section (theme and colour
// swatches) load only when the dialog opens.
const loadPicture = () => import("./ChatAvatarPicker");
const loadLook = () => import("./ChatLookPicker");
/**
 * A part of the dialog, fetched when the dialog opens. A fetch that fails (no connection) leaves
 * `failed` set, so a line is shown in its place and the chat carries on; it is tried again the
 * next time the dialog opens.
 */
function usePart<P>(open: boolean, load: () => Promise<{ default: ComponentType<P> }>) {
  const [part, setPart] = useState<{ Part?: ComponentType<P>; failed?: boolean }>({});
  const loaded = Boolean(part.Part);
  useEffect(() => {
    if (!open || loaded) return;
    let live = true;
    setPart({});
    load().then(
      (module) => live && setPart({ Part: module.default }),
      () => live && setPart({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, [open, loaded, load]);
  return part;
}
/**
 * The member's own settings: their chat name, how chat looks (#420) and their picture (#410).
 * The name and picture need a signed-in account with a linked member; the Look section is for
 * everyone. Opened by the window event "chat-open-profile-settings"; with detail "look" it opens
 * at the Look section.
 */
export default function ChatProfileSettings({
  accountId,
  member,
}: {
  accountId?: string | null;
  member: ChatMember | null;
}) {
  const identity = useChatIdentity();
  const live = identity?.accountId === accountId ? identity?.member : null;
  const current = member && live?.id === member.id ? newerChatMember(member, live) : member;
  const name = current?.display_name ?? "";
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLElement | null>(null),
    request = useRef<AbortController | null>(null),
    generation = useRef(0);
  const expected = useRef({ accountId, memberId: member?.id });
  expected.current = { accountId, memberId: member?.id };
  const heading = useId(),
    lookHeading = useId(),
    input = useId(),
    hint = useId();
  const look = useRef<HTMLElement>(null),
    startAtLook = useRef(false);
  const picture = usePart(open && Boolean(accountId && current), loadPicture),
    looks = usePart(open, loadLook);
  useEffect(() => {
    const show = (event: Event) => {
      trigger.current = document.activeElement as HTMLElement;
      startAtLook.current = (event as CustomEvent).detail === "look";
      setDraft(name);
      setEditing(false);
      setError("");
      setMessage("");
      setOpen(true);
    };
    window.addEventListener("chat-open-profile-settings", show);
    return () => window.removeEventListener("chat-open-profile-settings", show);
  }, [name]);
  useEffect(() => {
    const version = generation;
    version.current++;
    request.current?.abort();
    setOpen(false);
    setBusy(false);
    setEditing(false);
    setError("");
    setMessage("");
    return () => {
      version.current++;
      request.current?.abort();
    };
  }, [accountId, member?.id]);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    node?.showModal();
    if (startAtLook.current) look.current?.focus({ preventScroll: true });
    return () => node?.close();
  }, [open]);
  // #420: "Themes and colours" in the chat menu lands on the Look section, not the top; and again
  // once the picture and the swatches (each loaded when the dialog opens) have taken their room.
  useEffect(() => {
    if (open && startAtLook.current) look.current?.scrollIntoView({ block: "start" });
  }, [open, looks.Part, picture.Part]);
  function close() {
    generation.current++;
    request.current?.abort();
    setBusy(false);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !accountId || !member) return;
    const name = chatName(draft);
    if (!name) {
      setError(CHAT_NAME_HELP);
      return;
    }
    const token = ++generation.current,
      owner = { accountId, memberId: member.id };
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/chat/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", displayName: name }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (
        token !== generation.current ||
        controller.signal.aborted ||
        owner.accountId !== expected.current.accountId ||
        owner.memberId !== expected.current.memberId
      )
        return;
      if (!response.ok) throw Error(data.error || "Your name could not be updated. Please try again.");
      if (
        data.accountId !== owner.accountId ||
        !validChatMember(data.member) ||
        data.member.id !== owner.memberId
      )
        throw Error("Your account changed. Please reopen profile settings.");
      identity?.publish({
        accountId: data.accountId,
        // #410: a rename keeps the picture (an older server leaves it out of its answer).
        member:
          "avatar_path" in data.member ? data.member : { ...data.member, avatar_path: current?.avatar_path },
      });
      setDraft(data.member.display_name);
      setEditing(false);
      setMessage("Your chat name has been updated.");
    } catch (failure) {
      if (token === generation.current && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : "Your name could not be updated.");
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={heading}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
        }
      }}
    >
      <div className={styles.content}>
        <header>
          <h2 id={heading}>Profile settings</h2>
          <button type="button" onClick={close} aria-label="Close profile settings">
            ×
          </button>
        </header>
        {accountId && current && (
          <>
            <p className={styles.label}>Chat display name</p>
            <strong className={styles.name}>{name}</strong>
            <p id={hint}>Please use your real name so fellow traders know who you are.</p>
            {editing ? (
              <form onSubmit={save}>
                <label htmlFor={input}>Your chat name</label>
                <input
                  id={input}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setError("");
                  }}
                  maxLength={28}
                  autoComplete="name"
                  autoFocus
                  aria-describedby={hint}
                  aria-invalid={!!error}
                  disabled={busy}
                />
                <div className={styles.actions}>
                  <button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save name"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setError("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                className={styles.change}
                type="button"
                onClick={() => {
                  setDraft(name);
                  setError("");
                  setMessage("");
                  setEditing(true);
                }}
              >
                Change Name
              </button>
            )}
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            {message && <p role="status">{message}</p>}
            <p className={styles.note}>This changes your chat name only.</p>
            <hr className={styles.rule} />
          </>
        )}
        {accountId && current && (
          <>
            {picture.Part ? (
              <picture.Part
                accountId={accountId}
                member={current}
                onMember={(update) => identity?.publish(update)}
              />
            ) : (
              <p className={styles.note} role={picture.failed ? "status" : undefined}>
                {picture.failed
                  ? "Your picture could not be loaded. Check your connection and open this again."
                  : "Loading your picture…"}
              </p>
            )}
            <hr className={styles.rule} />
          </>
        )}
        {/* #420: last, so the name and picture stay where they were; "Themes and colours" opens here. */}
        <section
          ref={look}
          className={styles.look}
          aria-labelledby={lookHeading}
          tabIndex={-1}
          data-chat-look
        >
          <h3 id={lookHeading}>Look</h3>
          {looks.Part ? (
            <looks.Part signedIn={Boolean(accountId)} />
          ) : (
            <p className={styles.note} role={looks.failed ? "status" : undefined}>
              {looks.failed
                ? "Themes and colours could not be loaded. Check your connection and open this again."
                : "Loading themes and colours…"}
            </p>
          )}
        </section>
      </div>
    </dialog>
  );
}
