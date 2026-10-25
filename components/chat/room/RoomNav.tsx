"use client";
import { chatAvatarColor } from "@/lib/chatAvatar";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { CHAT_ROOMS, isAnnouncementRoom, type ChatRoom } from "@/lib/publicChat";
import { roomNotifyLevel } from "@/lib/chatRoomNotify";
import { DEV_BOARD_LINK, showFeaturesLink } from "@/lib/chatDevBoard";
import Link from "next/link";
import { readChatDraft } from "@/lib/chatRefreshDrafts";
import { Fragment, memo, useLayoutEffect, useState, type RefObject } from "react";
import { useSharedChatActivity } from "../ChatActivityContext";
import ChatIcon from "../ChatIcon";
import ChatPins from "../ChatPins";
import StartDirectMessage from "../StartDirectMessage";
import styles from "../PublicChat.module.css";

// Sidebar groups (UI-SIDEBAR); DMs follow as their own group from DirectInbox.
// D-304: What's New? sits on its own, below the member's pins and above the Rooms heading (or at
// the very top of the list when nothing is pinned); "heading: false" draws no heading for it.
const NAV_GROUPS = [
  { label: "What's New?", heading: false, slugs: ["whats-new"] },
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
  roomCaption: string;
  roomPaused: boolean;
  roomDenied: boolean;
  gainers: boolean;
  announcement: boolean;
  popout: boolean;
  member: ChatMember | null;
  allowedRooms: ChatRoom[];
  /** Chat admin (profiles.role); only admins get the Features link to the dev board (D-242). */
  isAdmin: boolean;
  canLinkShortScout: boolean;
  roomCounts: Partial<Record<ChatRoom, number>> | undefined;
  presenceReady: boolean;
  chatterCount: number;
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
  /** UI-PHONE-NAV: on a phone this list is the home screen, with its own top bar. */
  phone: boolean;
  setListBarHost: (node: HTMLDivElement | null) => void;
  /** An info or settings sheet is open over the page (it is modal). */
  sheetOpen: boolean;
};

/** The square room mark's letters on a phone: "LB", "SS", or the first letter. */
function roomInitials(label: string) {
  const word = label.split(" ")[0];
  return word.length <= 3 ? word : word[0];
}

/** The room sidebar: pins, room groups, search, new DM and the DM list host. Members and
 * settings live in the info sheets (SIDEBAR-REST). */
function RoomNav({
  navRef,
  room,
  roomCaption,
  roomPaused,
  roomDenied,
  gainers,
  announcement,
  popout,
  member,
  allowedRooms,
  isAdmin,
  canLinkShortScout,
  roomCounts,
  presenceReady,
  chatterCount,
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
  phone,
  setListBarHost,
  sheetOpen,
}: RoomNavProps) {
  // ROOM-NOTIFY: muted rooms are dimmed with a small mark; their badge is already 0 in roomCounts.
  const roomLevels = useSharedChatActivity().data.roomLevels;
  const roomHref = (slug: ChatRoom) => `/chat?room=${slug}${popout ? "&popout=1" : ""}`;
  // A phone's list shows each room's unsent draft, read when the list opens.
  const [drafts, setDrafts] = useState<Partial<Record<ChatRoom, string>>>({});
  useLayoutEffect(() => {
    if (!phone || !mobileNavOpen || !member) return;
    const next: Partial<Record<ChatRoom, string>> = {};
    try {
      for (const slug of allowedRooms) {
        const text = readChatDraft(window.sessionStorage, member.id, `room:${slug}`).trim();
        if (text) next[slug] = text;
      }
    } catch {
      /* Storage can be disabled; the list just shows no drafts. */
    }
    setDrafts((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, [phone, mobileNavOpen, member, allowedRooms]);
  const searchButton = (
    <button
      type="button"
      className={phone ? styles.phoneSearch : styles.searchTab}
      aria-pressed={searchOpen}
      onClick={
        phone
          ? () => {
              // On a phone the list's Search row always opens search, as a screen of its own.
              setRoomSelection((value) => value + 1);
              setDmTarget(null);
              setSearchOpen(true);
              setMobileNavOpen(false);
            }
          : onToggleSearch
      }
    >
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
      {phone ? "Search chat" : "Search"}
    </button>
  );
  return (
    <nav
      ref={navRef}
      id="chat-room-navigation"
      className={styles.roomTabs}
      aria-label="Chat rooms"
      inert={sheetOpen || (mobileReplies && (!mobileNavOpen || (replyOpen && !inlineDm)))}
      onKeyDown={(event) => {
        if (!mobileReplies || !mobileNavOpen) return;
        // The phone list is the home screen: Escape has nothing to close.
        if (event.key === "Escape" && !phone) {
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
      {phone ? (
        <>
          <div className={styles.phoneListBar}>
            <h1>Chat</h1>
            {/* The bell and the ••• menu render here from the header (one instance each). */}
            <div ref={setListBarHost} className={styles.phoneListActions} />
          </div>
          {searchButton}
        </>
      ) : (
        <button type="button" className={styles.mobileNavBack} onClick={() => setMobileNavOpen(false)}>
          Back to chat →
        </button>
      )}
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
          {!("heading" in group && group.heading === false) &&
            (group.label === "Rooms" ||
              group.slugs.some((slug) => !isAnnouncementRoom(slug) || allowedRooms.includes(slug))) && (
            <div className={styles.navHeading}>{group.label}</div>
          )}
          {group.label === "Rooms" && showFeaturesLink(isAdmin) && (
            <a {...DEV_BOARD_LINK} data-locked="true" aria-label="Features (private, opens in a new tab)">
              <span
                className={styles.roomMark}
                aria-hidden="true"
                data-initials="F"
                style={{ background: chatAvatarColor("features") }}
              />
              <span className={styles.roomRowText}>Features</span> <ChatIcon name="lock" size={14} />
            </a>
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
                  data-initials={roomInitials(option.label)}
                  style={{ background: chatAvatarColor(option.slug) }}
                />
                {/* The same text wrapper as an open room, so a locked row lines up with the rest. */}
                <span className={styles.roomRowText}>
                  <NavRoomLabel slug={option.slug} label={option.label} />
                </span>{" "}
                <ChatIcon name="lock" size={14} />
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
                data-muted={roomNotifyLevel(roomLevels, option.slug) === "muted" || undefined}
              >
                <span
                  className={styles.roomMark}
                  aria-hidden="true"
                  data-initials={roomInitials(option.label)}
                  style={{ background: chatAvatarColor(option.slug) }}
                />
                <span className={styles.roomRowText}>
                  <NavRoomLabel slug={option.slug} label={option.label} />
                  {phone && drafts[option.slug] && (
                    <small className={styles.roomDraft}>
                      <span>Draft:</span> {drafts[option.slug]}
                    </small>
                  )}
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
                {roomNotifyLevel(roomLevels, option.slug) === "muted" && (
                  <span className={styles.roomMuted} title="Muted" aria-label="Muted">
                    <ChatIcon name="bellOff" size={14} />
                  </span>
                )}
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
      {!phone && searchButton}
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
