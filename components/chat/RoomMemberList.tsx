"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ChatRoom } from "@/lib/publicChat";
import styles from "./RoomMemberList.module.css";

const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

import { useChatNameRefresh, useChatNameLabel } from "./ChatUpdates";
import MembershipBadges from "./MembershipBadges";
import type { ChatMembership } from "@/lib/chatMemberships";
import { AvatarBadge } from "./ChatAvatar";
import { pictureViewLabel, useMemberPictureView } from "./MemberPictureView";
type Member = { id: string; display_name: string; memberships?: ChatMembership[]; avatar_path?: string };
export default function RoomMemberList({
  room,
  roomLabel,
  memberId,
  onlineIds,
  presenceReady,
  onSelect,
  canRemovePictures = false,
}: {
  room: ChatRoom;
  roomLabel: string;
  memberId: string;
  onlineIds: Set<string>;
  presenceReady: boolean;
  onSelect: (target: { id: string; name: string }) => void;
  /** #410: admins can take down anyone's picture from here. */
  canRemovePictures?: boolean;
}) {
  const nameLabel = useChatNameLabel();
  const openPictureView = useMemberPictureView();
  useChatNameRefresh(() => setRetry((v) => v + 1));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const presenceIds = presenceReady
    ? [...onlineIds]
        .filter((id) => MEMBER_ID.test(id))
        .map((id) => id.toLowerCase())
        .sort()
    : [];
  const snapshot = JSON.stringify([...new Set(presenceIds)]);
  const scope = JSON.stringify([room, memberId, query, presenceReady, snapshot]);
  const [pagination, setPagination] = useState<{ scope: string; pages: Array<string | null> }>({
    scope: "",
    pages: [null],
  });
  // Persist the reset so a later return to an old snapshot cannot revive its page.
  if (pagination.scope !== scope) setPagination({ scope, pages: [null] });
  const pages = pagination.scope === scope ? pagination.pages : [null];
  const onlineSnapshot = new Set(presenceIds);
  const [loadedScope, setLoadedScope] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [pictureNote, setPictureNote] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  async function removePicture(target: Member) {
    const name = nameLabel(target.id, target.display_name);
    if (!window.confirm(`Remove ${name}'s picture? They will show their initials again.`)) return;
    setRemoving(target.id);
    setPictureNote("");
    try {
      const response = await fetch("/api/chat/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", memberId: target.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The picture could not be removed. Please try again.");
      setMembers((current) =>
        current.map((member) => {
          if (member.id !== target.id) return member;
          const { avatar_path: _removed, ...rest } = member;
          return rest;
        }),
      );
      setPictureNote(`${name}'s picture was removed.`);
    } catch (failure) {
      setPictureNote(failure instanceof Error ? failure.message : "The picture could not be removed.");
    } finally {
      setRemoving(null);
    }
  }
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useId(),
    search = useId();
  const cursor = pages[pages.length - 1];

  const visibleMembers = loadedScope === scope ? members : [];
  const pageLoading = loading || loadedScope !== scope;

  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let running = false;
    setMembers([]);
    setNextCursor(null);
    setLoading(true);
    setError("");
    const load = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        if (JSON.parse(snapshot).length > 5000)
          throw new Error("Too many connected members to load this list. Please try again later.");
        const response = await fetch("/api/chat/room-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, q: query, cursor, onlineIds: JSON.parse(snapshot) }),
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load members. Please try again.");
        if (!controller.signal.aborted) {
          setMembers(data.members);
          setNextCursor(data.nextCursor);
          setError("");
        }
      } catch (failure) {
        // A failed refresh keeps the last good page of this view on screen (with the alert and Retry).
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Could not load members.");
        }
      } finally {
        running = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadedScope(scope);
        }
      }
    };
    const timer = setTimeout(() => void load(), 200);
    // HEALTH-2026-10-19-1: presence changes, your own rename and Retry reload the open list at once.
    // Nothing tells the window when someone else renames, so this timer is how a peer's new name
    // (read fresh by the server on every request) reaches an open list within a minute.
    const poll = setInterval(() => {
      if (!document.hidden) void load();
    }, 45000);
    const resume = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [open, room, query, cursor, retry, snapshot, scope]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  return (
    <div className={styles.wrapper}>
      <button
        ref={trigger}
        type="button"
        className={styles.launch}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery("");
          setPagination({ scope: "", pages: [null] });
          setOpen(true);
        }}
      >
        Member List
      </button>
      {open && (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby={heading}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className={styles.content}>
            <header>
              <h2 id={heading}>{roomLabel} members</h2>
              <button type="button" onClick={close} aria-label="Close member list">
                ×
              </button>
            </header>
            <p>
              Choose a name to see their picture; you can message them from there. Online means connected to
              this room.
            </p>
            <label htmlFor={search}>Find a member</label>
            <input
              id={search}
              type="search"
              maxLength={28}
              placeholder="Search chat names…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPagination({ scope: "", pages: [null] });
              }}
            />
            <p role={error ? "alert" : "status"} className={styles.note}>
              {error ||
                (pageLoading
                  ? "Loading members…"
                  : visibleMembers.length
                    ? `${visibleMembers.length} members on this page`
                    : "No members found.")}
            </p>
            {error && (
              <button type="button" className={styles.launch} onClick={() => setRetry((value) => value + 1)}>
                Retry
              </button>
            )}
            <ul className={styles.members} aria-label="Room members" aria-busy={pageLoading}>
              {visibleMembers.map((member) => (
                <li
                  key={member.id}
                  className={canRemovePictures && member.avatar_path ? styles.withPicture : undefined}
                >
                  {/* #414: a row opens the larger view of that member and the list stays open behind
                      it. Choosing a row used to open a DM: the view offers that as a button, except
                      for yourself and bots (#330: nobody can message a bot privately). */}
                  <button
                    type="button"
                    disabled={
                      !openPictureView && (member.id === memberId || member.memberships?.includes("bot"))
                    }
                    title={
                      openPictureView
                        ? pictureViewLabel(nameLabel(member.id, member.display_name))
                        : undefined
                    }
                    onClick={(event) => {
                      const name = nameLabel(member.id, member.display_name);
                      const message =
                        member.id === memberId || member.memberships?.includes("bot")
                          ? undefined
                          : () => {
                              close();
                              onSelect({ id: member.id, name });
                            };
                      if (!openPictureView) return message?.();
                      openPictureView(
                        {
                          memberId: member.id,
                          path: member.avatar_path,
                          name,
                          colorKey: member.id,
                          onMessage: message,
                        },
                        event.currentTarget,
                      );
                    }}
                  >
                    <strong>
                      <AvatarBadge
                        memberId={member.id}
                        path={member.avatar_path}
                        px={24}
                        style={{ marginRight: 8, verticalAlign: "-7px" }}
                      />
                      {nameLabel(member.id, member.display_name)}
                      {member.id === memberId ? " (you)" : ""}
                      <MembershipBadges memberships={member.memberships} />
                    </strong>
                    <span
                      className={styles.presence}
                      data-online={presenceReady && onlineSnapshot.has(member.id.toLowerCase())}
                    >
                      <i aria-hidden="true" />
                      {!presenceReady
                        ? "Status unavailable"
                        : onlineSnapshot.has(member.id.toLowerCase())
                          ? "Online"
                          : "Offline"}
                    </span>
                  </button>
                  {canRemovePictures && member.avatar_path && (
                    <button
                      type="button"
                      className={styles.removePicture}
                      disabled={removing === member.id}
                      aria-label={`Remove ${nameLabel(member.id, member.display_name)}'s picture`}
                      onClick={() => void removePicture(member)}
                    >
                      {removing === member.id ? "Removing…" : "Remove picture"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {pictureNote && (
              <p role="status" className={styles.note}>
                {pictureNote}
              </p>
            )}
            <nav className={styles.pages} aria-label="Member list pages">
              <button
                type="button"
                disabled={pageLoading || pages.length === 1}
                onClick={() => setPagination({ scope, pages: pages.slice(0, -1) })}
              >
                Previous
              </button>
              <span>Page {pages.length}</span>
              <button
                type="button"
                disabled={pageLoading || !nextCursor}
                onClick={() => {
                  if (nextCursor) setPagination({ scope, pages: [...pages, nextCursor] });
                }}
              >
                Next
              </button>
            </nav>
            <p className={styles.note}>
              Only chat names are shown. Selecting someone does not send a message; their message-request
              preferences still apply.
            </p>
          </div>
        </dialog>
      )}
    </div>
  );
}
