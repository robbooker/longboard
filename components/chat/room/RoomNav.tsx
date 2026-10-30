"use client";
import { chatAvatarColor } from "@/lib/chatAvatar";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { CHAT_ROOMS, isAnnouncementRoom, type ChatRoom } from "@/lib/publicChat";
import { roomNotifyLevel } from "@/lib/chatRoomNotify";
import { DEV_BOARD_LINK, showFeaturesLink } from "@/lib/chatDevBoard";
import Link from "next/link";
import { readChatDraft } from "@/lib/chatRefreshDrafts";
import { Fragment, memo, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { foldedRoomTotals, type SidebarFoldGroup } from "@/lib/chatSidebarFold";
import { useSharedChatActivity } from "../ChatActivityContext";
import ChatIcon from "../ChatIcon";
import ChatPins from "../ChatPins";
import StartDirectMessage from "../StartDirectMessage";
import { FoldHeading, useSidebarFolds } from "../SidebarFold";
import type { ChatPage, ChatPageSuggestion } from "@/lib/chatPages";
import { FAQ_CHAT_PAGE, NEW_CHAT_PAGE, WAITING_CHAT_PAGES } from "../hooks/useChatPages";
import styles from "../PublicChat.module.css";

// Sidebar groups (UI-SIDEBAR); DMs follow as their own group from DirectInbox.
// D-304: What's New? sits on its own, below the member's pins and above the Rooms heading (or at
// the very top of the list when nothing is pinned); "heading: false" draws no heading for it.
// D-324: each group with a heading can be folded to just that heading (`fold`).
const NAV_GROUPS: ReadonlyArray<{
  label: string;
  heading?: false;
  fold?: SidebarFoldGroup;
  slugs: readonly ChatRoom[];
}> = [
  { label: "What's New?", heading: false, slugs: ["whats-new"] },
  { label: "Rooms", fold: "rooms", slugs: ["main", "social", "shortscout", "gainers", "developers", "admins"] },
  { label: "Announcements", fold: "announcements", slugs: ["lb-announcements", "ss-announcements"] },
  { label: "Recordings", fold: "recordings", slugs: ["lb-recordings", "ss-recordings"] },
];

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
  /** LB-PAGES (#321): the Pages section below Recordings (null: not shown). */
  pages: ChatPage[] | null;
  canManagePages: boolean;
  /** #329: this member's own suggestions, marked in their list. */
  pageSuggestions: ChatPageSuggestion[];
  /** #329: for an admin, how many suggestions are waiting for approval. */
  waitingPageCount: number;
  /** #332: the FAQ row directly under What's New (members, not guests). */
  showFaq: boolean;
  /** The page on screen, if any. */
  openPageId: string | null;
  onOpenPage: (id: string) => void;
};

/** The square mark's letters for a page: the first letters of its first two words. */
function pageInitials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "P";
}

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
  pages,
  canManagePages,
  pageSuggestions,
  waitingPageCount,
  showFaq,
  openPageId,
  onOpenPage,
}: RoomNavProps) {
  // ROOM-NOTIFY: muted rooms are dimmed with a small mark; their badge is already 0 in roomCounts.
  const activityData = useSharedChatActivity().data;
  const roomLevels = activityData.roomLevels;
  // D-324: folded groups (this person, this device) and what a folded heading adds up.
  const { folded, setFolded } = useSidebarFolds(member?.id);
  const mentionCounts = activityData.roomCounts;
  const groupTotals = useMemo(
    () =>
      Object.fromEntries(
        NAV_GROUPS.map((group) => [
          group.label,
          foldedRoomTotals(group.slugs, roomCounts, mentionCounts, allowedRooms),
        ]),
      ),
    [roomCounts, mentionCounts, allowedRooms],
  );
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
      {NAV_GROUPS.map((group) => {
        const groupFolded = !!group.fold && folded.has(group.fold);
        return (
          <Fragment key={group.label}>
            {group.heading !== false &&
              (group.label === "Rooms" ||
                group.slugs.some((slug) => !isAnnouncementRoom(slug) || allowedRooms.includes(slug))) && (
                <div className={styles.navHeading} data-sidebar-group={group.fold}>
                  {group.fold ? (
                    <FoldHeading
                      group={group.fold}
                      label={group.label}
                      folded={groupFolded}
                      onToggle={(value) => setFolded(group.fold!, value)}
                      unread={groupTotals[group.label]?.unread}
                      mention={groupTotals[group.label]?.mention}
                    />
                  ) : (
                    group.label
                  )}
                </div>
              )}
            {!groupFolded && group.label === "Rooms" && showFeaturesLink(isAdmin) && (
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
            {!groupFolded &&
              CHAT_ROOMS.filter(
                (option) =>
                  group.slugs.includes(option.slug) &&
                  // #332: others never see the Admins room, not even as a locked row.
                  ((!isAnnouncementRoom(option.slug) && option.slug !== "admins") || allowedRooms.includes(option.slug)),
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
                    aria-current={
                      !searchOpen && !inlineDm && !openPageId && room === option.slug ? "page" : undefined
                    }
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
                              {roomPaused
                                ? "Paused"
                                : presenceReady
                                  ? `${chatterCount} online`
                                  : "Connecting…"}
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
            {group.slugs[0] === "whats-new" && showFaq && (
              <a
                href={`/chat?page=${FAQ_CHAT_PAGE}`}
                onClick={(event) => {
                  event.preventDefault();
                  if (navigationBusy) return;
                  if (openPageId !== FAQ_CHAT_PAGE) saveSnapshot();
                  setSearchOpen(false);
                  onOpenPage(FAQ_CHAT_PAGE);
                }}
                aria-current={openPageId === FAQ_CHAT_PAGE ? "page" : undefined}
                data-chat-faq
              >
                <span
                  className={styles.roomMark}
                  aria-hidden="true"
                  data-initials="?"
                  style={{ background: chatAvatarColor("page:faq") }}
                />
                <span className={styles.roomRowText}>FAQ</span>
              </a>
            )}
          </Fragment>
        );
      })}
      {pages && (
        <>
          <div className={styles.navHeading} data-sidebar-group="pages">
            {/* Pages carry no unread counts; a folded heading shows only an admin's waiting count (#329). */}
            <FoldHeading
              group="pages"
              label="Pages"
              folded={folded.has("pages")}
              onToggle={(value) => setFolded("pages", value)}
            >
              {folded.has("pages") && waitingPageCount > 0 && (
                <span className={styles.pagesWaitingCount} data-pages-waiting-count={waitingPageCount}>
                  {waitingPageCount}
                  <span className={styles.srOnly}> waiting for approval</span>
                </span>
              )}
            </FoldHeading>
          </div>
          {!folded.has("pages") &&
            pages.map((page) => (
              <a
                key={page.id}
                href={`/chat?page=${encodeURIComponent(page.slug)}`}
                onClick={(event) => {
                  event.preventDefault();
                  if (navigationBusy) return;
                  if (openPageId !== page.id) saveSnapshot();
                  setSearchOpen(false);
                  onOpenPage(page.id);
                }}
                aria-current={openPageId === page.id ? "page" : undefined}
                data-chat-page={page.slug}
              >
                <span
                  className={styles.roomMark}
                  aria-hidden="true"
                  data-initials={pageInitials(page.name)}
                  style={{ background: chatAvatarColor(`page:${page.slug}`) }}
                />
                <span className={styles.roomRowText}>{page.name}</span>
              </a>
            ))}
          {!folded.has("pages") &&
            pageSuggestions.map((page) => (
              <a
                key={page.id}
                href="/chat"
                onClick={(event) => {
                  event.preventDefault();
                  if (navigationBusy) return;
                  if (openPageId !== page.id) saveSnapshot();
                  setSearchOpen(false);
                  onOpenPage(page.id);
                }}
                aria-current={openPageId === page.id ? "page" : undefined}
                data-chat-page-suggestion={page.status}
              >
                <span
                  className={styles.roomMark}
                  aria-hidden="true"
                  data-initials={pageInitials(page.name)}
                  style={{ background: chatAvatarColor(`page:${page.id}`) }}
                />
                <span className={styles.roomRowText}>
                  {page.name}
                  <small className={styles.pageSuggestionStatus}>{page.status === "pending" ? "Waiting for approval" : "Declined"}</small>
                </span>
              </a>
            ))}
          {waitingPageCount > 0 && !folded.has("pages") && (
            <a
              href="/chat?page=waiting"
              onClick={(event) => {
                event.preventDefault();
                if (navigationBusy) return;
                if (openPageId !== WAITING_CHAT_PAGES) saveSnapshot();
                setSearchOpen(false);
                onOpenPage(WAITING_CHAT_PAGES);
              }}
              aria-current={openPageId === WAITING_CHAT_PAGES ? "page" : undefined}
              data-chat-page="waiting"
            >
              <span
                className={styles.roomMark}
                aria-hidden="true"
                data-initials="…"
                style={{ background: chatAvatarColor("page:waiting") }}
              />
              <span className={styles.roomRowText}>Waiting for approval</span>
              <span className={styles.pagesWaitingCount} data-pages-waiting-count={waitingPageCount}>
                {waitingPageCount}
              </span>
            </a>
          )}
          {!folded.has("pages") && (
            <a
              href="/chat?page=new"
              onClick={(event) => {
                event.preventDefault();
                if (navigationBusy) return;
                setSearchOpen(false);
                onOpenPage(NEW_CHAT_PAGE);
              }}
              aria-current={openPageId === NEW_CHAT_PAGE ? "page" : undefined}
              data-chat-page="new"
            >
              <span
                className={styles.roomMark}
                aria-hidden="true"
                data-initials="+"
                style={{ background: chatAvatarColor("page:new") }}
              />
              <span className={styles.roomRowText}>{canManagePages ? "Add a page" : "Suggest a page"}</span>
            </a>
          )}
        </>
      )}
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
