"use client";
import { chatAvatarColor } from "@/lib/chatAvatar";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { CHAT_ROOMS, isAnnouncementRoom, type ChatRoom } from "@/lib/publicChat";
import Link from "next/link";
import { Fragment, memo, type RefObject } from "react";
import ChatIcon from "../ChatIcon";
import ChatPins from "../ChatPins";
import RoomMemberList from "../RoomMemberList";
import StartDirectMessage from "../StartDirectMessage";
import styles from "../PublicChat.module.css";

// Sidebar groups (UI-SIDEBAR); DMs follow as their own group from DirectInbox.
const NAV_GROUPS = [
  { label: "Rooms", slugs: ["main", "social", "shortscout", "gainers"] },
  { label: "Announcements", slugs: ["lb-announcements", "ss-announcements"] },
  { label: "Recordings", slugs: ["lb-recordings", "ss-recordings"] },
] as const;

/** Short sidebar name: the group heading already says Announcements / Recordings. */
function NavRoomLabel({ slug, label }: { slug: string; label: string }) {
  if (slug === "social")
    return (
      <span className={styles.socialRoomLabel}>
        Social <small>(LB + SS)</small>
      </span>
    );
  if (slug === "gainers") return <>Gainers</>;
  const kind = slug.endsWith("-announcements")
    ? " announcements"
    : slug.endsWith("-recordings")
      ? " recordings"
      : "";
  return kind ? (
    <>
      {label.split(" ")[0]}
      <span className={styles.srOnly}>{kind}</span>
    </>
  ) : (
    <>{label}</>
  );
}

type DmTarget = { id: string; name: string };

export type RoomNavProps = {
  navRef: RefObject<HTMLElement | null>;
  room: ChatRoom;
  roomLabel: string;
  roomCaption: string;
  roomPaused: boolean;
  roomDenied: boolean;
  gainers: boolean;
  announcement: boolean;
  popout: boolean;
  member: ChatMember | null;
  allowedRooms: ChatRoom[];
  featureChannel: boolean;
  canLinkShortScout: boolean;
  roomCounts: Partial<Record<ChatRoom, number>> | undefined;
  presenceReady: boolean;
  chatterCount: number;
  onlineMemberIds: Set<string>;
  mobileReplies: boolean;
  mobileNavOpen: boolean;
  replyOpen: boolean;
  inlineDm: boolean;
  searchOpen: boolean;
  /** A send or admin action is running, so room links stay put. */
  navigationBusy: boolean;
  saveSnapshot: () => void;
  onNavigate: (room: ChatRoom) => void;
  onToggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setRoomSelection: (update: (value: number) => number) => void;
  setDmTarget: (target: DmTarget | null) => void;
  setDmSidebarHost: (node: HTMLDivElement | null) => void;
};

/** The room sidebar: pins, room groups, search, members, new DM and the DM list host. */
function RoomNav({
  navRef,
  room,
  roomLabel,
  roomCaption,
  roomPaused,
  roomDenied,
  gainers,
  announcement,
  popout,
  member,
  allowedRooms,
  featureChannel,
  canLinkShortScout,
  roomCounts,
  presenceReady,
  chatterCount,
  onlineMemberIds,
  mobileReplies,
  mobileNavOpen,
  replyOpen,
  inlineDm,
  searchOpen,
  navigationBusy,
  saveSnapshot,
  onNavigate,
  onToggleSearch,
  setSearchOpen,
  setMobileNavOpen,
  setRoomSelection,
  setDmTarget,
  setDmSidebarHost,
}: RoomNavProps) {
  const roomHref = (slug: ChatRoom) => `/chat?room=${slug}${popout ? "&popout=1" : ""}`;
  return (
    <nav
      ref={navRef}
      id="chat-room-navigation"
      className={styles.roomTabs}
      aria-label="Chat rooms"
      inert={mobileReplies && (!mobileNavOpen || (replyOpen && !inlineDm))}
      onKeyDown={(event) => {
        if (!mobileReplies || !mobileNavOpen) return;
        if (event.key === "Escape") {
          event.preventDefault();
          setMobileNavOpen(false);
          return;
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(
          navRef.current?.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled),input:not(:disabled)",
          ) ?? [],
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <button type="button" className={styles.mobileNavBack} onClick={() => setMobileNavOpen(false)}>
        Back to chat →
      </button>
      {member && (
        <ChatPins
          key={`pins:${member.id}`}
          memberId={member.id}
          onNavigate={(pin) => {
            saveSnapshot();
            setSearchOpen(false);
            setMobileNavOpen(false);
            if (pin.kind === "room") {
              setRoomSelection((value) => value + 1);
              setDmTarget(null);
              onNavigate(pin.room);
            } else window.dispatchEvent(new CustomEvent("chat-open-dm", { detail: pin.conversationId }));
          }}
        />
      )}
      {NAV_GROUPS.map((group) => (
        <Fragment key={group.label}>
          {(group.label === "Rooms" ||
            group.slugs.some((slug) => !isAnnouncementRoom(slug) || allowedRooms.includes(slug))) && (
            <div className={styles.navHeading}>{group.label}</div>
          )}
          {group.label === "Rooms" && featureChannel && (
            <Link href="/chat/features" data-locked="true" aria-label="Features (private)">
              <span
                className={styles.roomMark}
                aria-hidden="true"
                style={{ background: chatAvatarColor("features") }}
              />
              <span className={styles.roomRowText}>Features</span> <ChatIcon name="lock" size={14} />
            </Link>
          )}
          {CHAT_ROOMS.filter(
            (option) =>
              (group.slugs as readonly string[]).includes(option.slug) &&
              (!isAnnouncementRoom(option.slug) || allowedRooms.includes(option.slug)),
          ).map((option) =>
            !allowedRooms.includes(option.slug) || (roomDenied && option.slug === room) ? (
              <Link
                key={option.slug}
                href={
                  option.slug === "shortscout"
                    ? `/api/chat/login/start?${canLinkShortScout ? "link=1&" : ""}room=shortscout${popout ? "&popout=1" : ""}`
                    : `/login?next=${encodeURIComponent(roomHref(option.slug))}`
                }
                title="Sign in with this membership"
                data-locked="true"
              >
                <span
                  className={styles.roomMark}
                  aria-hidden="true"
                  style={{ background: chatAvatarColor(option.slug) }}
                />
                <NavRoomLabel slug={option.slug} label={option.label} /> <ChatIcon name="lock" size={14} />
              </Link>
            ) : (
              <Link
                key={option.slug}
                href={roomHref(option.slug)}
                scroll={false}
                onClick={(event) => {
                  setRoomSelection((value) => value + 1);
                  setDmTarget(null);
                  if (option.slug === room) {
                    event.preventDefault();
                    setSearchOpen(false);
                    setMobileNavOpen(false);
                    return;
                  }
                  if (navigationBusy) {
                    event.preventDefault();
                    return;
                  }
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  saveSnapshot();
                  onNavigate(option.slug);
                  setMobileNavOpen(false);
                }}
                aria-current={!searchOpen && !inlineDm && room === option.slug ? "page" : undefined}
                data-unread={(roomCounts?.[option.slug] ?? 0) > 0 || undefined}
              >
                <span
                  className={styles.roomMark}
                  aria-hidden="true"
                  style={{ background: chatAvatarColor(option.slug) }}
                />
                <span className={styles.roomRowText}>
                  <NavRoomLabel slug={option.slug} label={option.label} />
                  {option.slug === room && (
                    <small className={styles.roomCaption} aria-live="polite">
                      {roomCaption}
                      {(roomPaused || !(gainers || announcement)) && (
                        <span className={styles.roomOnline}>
                          {" · "}
                          {roomPaused ? "Paused" : presenceReady ? `${chatterCount} online` : "Connecting…"}
                        </span>
                      )}
                    </small>
                  )}
                </span>
                {(roomCounts?.[option.slug] ?? 0) > 0 && (
                  <span
                    className={styles.activityBadge}
                    aria-label={`${roomCounts?.[option.slug]} unread messages`}
                  >
                    {roomCounts?.[option.slug]}
                  </span>
                )}
              </Link>
            ),
          )}
        </Fragment>
      ))}
      <button type="button" className={styles.searchTab} aria-pressed={searchOpen} onClick={onToggleSearch}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        Search
      </button>
      {member && (
        <RoomMemberList
          key={`${member.id}:${room}`}
          room={room}
          roomLabel={roomLabel}
          memberId={member.id}
          onlineIds={onlineMemberIds}
          presenceReady={presenceReady}
          onSelect={(target) => {
            setDmTarget(target);
            setMobileNavOpen(false);
          }}
        />
      )}
      {member && (
        <StartDirectMessage
          key={member.id}
          onSelect={(target) => {
            setDmTarget(target);
            setMobileNavOpen(false);
          }}
        />
      )}
      <div ref={setDmSidebarHost} className={styles.dmSidebarHost} />
    </nav>
  );
}

export default memo(RoomNav);
