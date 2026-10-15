"use client";
import type { ChatMember } from "@/lib/chatDirectMessages";
import type { RoomMessagePin } from "@/lib/chatRoomMessagePins";
import type { ChatRoom } from "@/lib/publicChat";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import ChatFavorite from "../ChatFavorite";
import ChatIcon from "../ChatIcon";
import ChatPins from "../ChatPins";
import RoomMemberList from "../RoomMemberList";
import RoomMessagePins, { type MessagePinControls } from "../RoomMessagePins";
import RoomNotifyChoice from "../RoomNotifyChoice";
import styles from "../PublicChat.module.css";

export type PhoneInfoSheetProps = {
  dm: boolean;
  title: string;
  subtitle: string;
  member: ChatMember | null;
  room: ChatRoom;
  roomLabel: string;
  pins: RoomMessagePin[];
  pinControls: MessagePinControls;
  pinError: string;
  onlineIds: Set<string>;
  presenceReady: boolean;
  isOwner: boolean;
  adminOpen: boolean;
  setAdminOpen: Dispatch<SetStateAction<boolean>>;
  onClose: () => void;
  onOpenPin: (pin: RoomMessagePin) => void;
  onSelectMember: (target: { id: string; name: string }) => void;
  onSearch: () => void;
  onLatest: () => void;
  setDmSettingsHost: Dispatch<SetStateAction<HTMLDivElement | null>>;
};

/** UI-PHONE-NAV: a phone conversation's one info sheet, with what used to sit in its header. */
export default function PhoneInfoSheet({
  dm,
  title,
  subtitle,
  member,
  room,
  roomLabel,
  pins,
  pinControls,
  pinError,
  onlineIds,
  presenceReady,
  isOwner,
  adminOpen,
  setAdminOpen,
  onClose,
  onOpenPin,
  onSelectMember,
  onSearch,
  onLatest,
  setDmSettingsHost,
}: PhoneInfoSheetProps) {
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, []);
  const label = dm ? "Conversation info" : "Room info";
  return (
    <>
      <div className={styles.phoneScrim} aria-hidden="true" onClick={onClose} />
      <section
        ref={sheet}
        className={styles.phoneSheet}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(event) => {
          // The member list is its own dialog; its Escape closes only that.
          if (event.key !== "Escape" || (event.target as Element).closest("dialog")) return;
          event.preventDefault();
          onClose();
        }}
      >
        <div className={styles.phoneSheetGrab} aria-hidden="true" />
        <header className={styles.phoneSheetHead}>
          <h2>{title}</h2>
          <p>{subtitle}</p>
          <button
            type="button"
            className={styles.phoneSheetClose}
            aria-label={`Close ${label.toLowerCase()}`}
            onClick={onClose}
          >
            <ChatIcon name="close" />
          </button>
        </header>
        {dm ? (
          <>
            <div className={styles.phoneSheetActions}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLatest();
                }}
              >
                <span aria-hidden="true">↓</span> Latest messages
              </button>
            </div>
            {/* The open DM's settings (favorite, pin, sound or mute, block, report) render here. */}
            <div ref={setDmSettingsHost} className={styles.phoneSheetDm} />
          </>
        ) : (
          <>
            {member && (
              <div className={styles.phoneSheetActions}>
                <ChatFavorite
                  key={`favorite:${member.id}:${room}`}
                  memberId={member.id}
                  target={{ kind: "room", room }}
                  label={roomLabel}
                />
                <ChatPins
                  key={`pin:${member.id}:${room}`}
                  memberId={member.id}
                  target={{ kind: "room", room }}
                  label={roomLabel}
                />
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSearch();
                  }}
                >
                  <ChatIcon name="search" /> Search in {roomLabel}
                </button>
                {isOwner && (
                  <button
                    type="button"
                    aria-expanded={adminOpen}
                    aria-controls="longboard-chat-admin-panel"
                    onClick={() => {
                      setAdminOpen((open) => !open);
                      onClose();
                    }}
                  >
                    <ChatIcon name="shield" /> Admin controls
                  </button>
                )}
              </div>
            )}
            {member && <RoomNotifyChoice room={room} variant="sheet" />}
            <section className={styles.phoneSheetSection} aria-label="Pinned">
              <h3>Pinned</h3>
              {pins.length || pinError ? (
                <RoomMessagePins
                  pins={pins}
                  controls={pinControls}
                  error={pinError}
                  onOpen={(pin) => {
                    onClose();
                    onOpenPin(pin);
                  }}
                />
              ) : (
                <p>Nothing pinned yet. Pin a message from its ••• menu.</p>
              )}
            </section>
            {member && (
              <section className={styles.phoneSheetSection} aria-label="Members">
                <h3>Members</h3>
                <p>{presenceReady ? `${onlineIds.size} online now` : "Checking who’s online…"}</p>
                <RoomMemberList
                  key={`${member.id}:${room}`}
                  room={room}
                  roomLabel={roomLabel}
                  memberId={member.id}
                  onlineIds={onlineIds}
                  presenceReady={presenceReady}
                  onSelect={(target) => {
                    onClose();
                    onSelectMember(target);
                  }}
                />
              </section>
            )}
          </>
        )}
      </section>
    </>
  );
}
