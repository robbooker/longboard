"use client";
import { clearChatOutbox } from "@/lib/chatOutbox";
import { clearChatDeviceStore } from "@/lib/chatDeviceStore";
import type { ChatActivity } from "@/lib/chatActivity";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { disableCurrentChatPush } from "@/lib/chatPushBrowser";
import type { ChatTheme } from "@/lib/chatTheme";
import type { ChatRoom } from "@/lib/publicChat";
import Link from "next/link";
import { memo, type Dispatch, type RefObject, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import ChatActivityBell from "../ChatActivityBell";
import ChatFavorite from "../ChatFavorite";
import ChatHeaderMenu from "../ChatHeaderMenu";
import ChatIcon from "../ChatIcon";
import ChatPins from "../ChatPins";
import { ChatPushPromptButton } from "../ChatPushPrompt";
import { usePushPrompt } from "../usePushPrompt";
import RoomNotifyChoice from "../RoomNotifyChoice";
import SkipLatestButton from "../SkipLatestButton";
import SocialCommunityIcon from "../SocialCommunityIcon";
import styles from "../PublicChat.module.css";
import type { ActionState, IdentityStatus } from "./types";
import { CHAT_THEMES } from "./useChatTheme";

type Setter<T> = Dispatch<SetStateAction<T>>;

export type ChatHeaderProps = {
  inlineDm: boolean;
  navTrigger: RefObject<HTMLButtonElement | null>;
  room: ChatRoom;
  roomLabel: string;
  dmView: string | null;
  gainers: boolean;
  announcement: boolean;
  shortScoutRoom: boolean;
  roomPaused: boolean;
  presenceReady: boolean;
  chatterCount: number;
  popout: boolean;
  popoutState: ActionState;
  openPopout: () => void;
  loading: boolean;
  openingReady: boolean;
  skippingLatest: boolean;
  jumpToLatest: () => void;
  searchOpen: boolean;
  mobileNavOpen: boolean;
  member: ChatMember | null;
  accountId: string | undefined;
  displayName: string;
  identityStatus: IdentityStatus;
  featureChannel: boolean;
  activityData: ChatActivity;
  activityError: string;
  readActivity: (body: Record<string, unknown>) => Promise<void>;
  isOwner: boolean;
  adminOpen: boolean;
  setAdminOpen: Setter<boolean>;
  hasSeparateShortScoutProfile: boolean;
  canLinkShortScout: boolean;
  serverSession: boolean;
  loginHref: string;
  theme: ChatTheme;
  setTheme: (theme: ChatTheme) => void;
  saveSnapshot: () => void;
  onNavigate: (room: ChatRoom) => void;
  setRoomSelection: Setter<number>;
  setDmTarget: Setter<{ id: string; name: string } | null>;
  setSearchOpen: Setter<boolean>;
  setMobileNavOpen: Setter<boolean>;
  setIdentityStatus: Setter<IdentityStatus>;
  setError: Setter<string>;
  setNameState: Setter<ActionState>;
  /** UI-PHONE-NAV: a phone gets back, a centered title and one info button. */
  phone: boolean;
  phoneBack: () => void;
  infoOpen: boolean;
  openInfo: () => void;
  /** SIDEBAR-REST: sounds and message requests for all DMs, in their own sheet. */
  openDmSettings: () => void;
  infoTrigger: RefObject<HTMLButtonElement | null>;
  /** The phone list's top bar, where the bell and the ••• menu go. */
  listBarHost: HTMLDivElement | null;
};

/** The room (or inline DM) header: brand, presence, Latest, Search, the bell and the ••• menu. */
function ChatHeader({
  inlineDm,
  navTrigger,
  room,
  roomLabel,
  dmView,
  gainers,
  announcement,
  shortScoutRoom,
  roomPaused,
  presenceReady,
  chatterCount,
  popout,
  popoutState,
  openPopout,
  loading,
  openingReady,
  skippingLatest,
  jumpToLatest,
  searchOpen,
  mobileNavOpen,
  member,
  accountId,
  displayName,
  identityStatus,
  featureChannel,
  activityData,
  activityError,
  readActivity,
  isOwner,
  adminOpen,
  setAdminOpen,
  hasSeparateShortScoutProfile,
  canLinkShortScout,
  serverSession,
  loginHref,
  theme,
  setTheme,
  saveSnapshot,
  onNavigate,
  setRoomSelection,
  setDmTarget,
  setSearchOpen,
  setMobileNavOpen,
  setIdentityStatus,
  setError,
  setNameState,
  phone,
  phoneBack,
  infoOpen,
  openInfo,
  openDmSettings,
  infoTrigger,
  listBarHost,
}: ChatHeaderProps) {
  const roomTitle =
    announcement || gainers
      ? roomLabel
      : room === "shortscout"
        ? "ShortScout"
        : room === "social"
          ? "Social"
          : "Longboard";
  const presence = roomPaused
    ? "Paused"
    : gainers
      ? "Live Gainers alerts"
      : announcement
        ? "Admin posts only"
        : presenceReady
          ? `${chatterCount} online`
          : "Connecting…";
  // PHONE-NOTIFY-PROMPT: a bell with a slash while phone notifications are off on this device.
  const pushPrompt = usePushPrompt(phone, accountId);
  const bell = (member || featureChannel) && (
    <ChatActivityBell
      data={activityData}
      error={activityError}
      read={readActivity}
      productUpdates={featureChannel}
    />
  );
  const menu = (
    <ChatHeaderMenu>
      {(close) => (
        <>
          {phone ? (
            // On a phone the room's own items are in its info sheet; the favorite shortcut stays here.
            member && (
              <ChatFavorite
                key={member.id}
                memberId={member.id}
                target={null}
                label={roomLabel}
                shortcut
                onNavigate={(favorite) => {
                  saveSnapshot();
                  close();
                  setSearchOpen(false);
                  setMobileNavOpen(false);
                  if (favorite.kind === "room") onNavigate(favorite.room);
                  else
                    window.dispatchEvent(
                      new CustomEvent("chat-open-dm", { detail: favorite.conversationId }),
                    );
                }}
              />
            )
          ) : (
            <>
              {/* UI-MENUS: three groups — This room, You, App. */}
              <div className={styles.menuSectionLabel}>{inlineDm ? "This conversation" : "This room"}</div>
              {member && !inlineDm && (
                <ChatPins
                  key={`pin:${member.id}:${room}`}
                  memberId={member.id}
                  target={{ kind: "room", room }}
                  label={roomLabel}
                />
              )}
              {member && (
                <ChatFavorite
                  key={member.id}
                  memberId={member.id}
                  target={inlineDm ? null : { kind: "room", room }}
                  label={roomLabel}
                  shortcut
                  onNavigate={(favorite) => {
                    saveSnapshot();
                    close();
                    setSearchOpen(false);
                    setMobileNavOpen(false);
                    if (favorite.kind === "room") onNavigate(favorite.room);
                    else
                      window.dispatchEvent(
                        new CustomEvent("chat-open-dm", { detail: favorite.conversationId }),
                      );
                  }}
                />
              )}
              {inlineDm && (
                <button
                  type="button"
                  className={styles.menuItem}
                  aria-haspopup="dialog"
                  onClick={() => {
                    close();
                    openInfo();
                  }}
                >
                  <span className={styles.menuIconLabel}>
                    <ChatIcon name="settings" />
                    DM settings
                  </span>
                </button>
              )}
              {!popout ? (
                <button
                  type="button"
                  className={styles.menuItem}
                  disabled={popoutState === "loading"}
                  onClick={() => {
                    openPopout();
                    close();
                  }}
                >
                  <span className={styles.menuIconLabel}>
                    <ChatIcon name="external" />
                    {gainers ? "Pop out Gainers" : "Pop out chat"}
                  </span>
                </button>
              ) : (
                <Link className={styles.menuItem} href={`/chat?room=${room}`}>
                  <span className={styles.menuIconLabel}>
                    <ChatIcon name="external" />
                    {gainers ? "Return to Gainers" : "Open full page"}
                  </span>
                </Link>
              )}
              {member && !inlineDm && <RoomNotifyChoice room={room} variant="menu" />}
              {isOwner ? (
                <button
                  type="button"
                  className={styles.menuItem}
                  aria-expanded={adminOpen}
                  aria-controls="longboard-chat-admin-panel"
                  onClick={() => {
                    setAdminOpen((open) => !open);
                    close();
                  }}
                >
                  <span className={styles.menuIconLabel}>
                    <ChatIcon name="shield" />
                    Admin controls
                  </span>{" "}
                  <span aria-hidden="true">{adminOpen ? "−" : "+"}</span>
                </button>
              ) : null}
              <div className={styles.menuDivider} />
            </>
          )}
          <div className={styles.menuSectionLabel}>You</div>
          <div className={styles.menuIdentity}>
            <span>Signed in</span>
            <strong>{displayName || "Welcome to Longboard"}</strong>
          </div>
          {accountId && member && (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                close();
                window.dispatchEvent(new Event("chat-open-profile-settings"));
              }}
            >
              <span className={styles.menuIconLabel}>
                <ChatIcon name="user" />
                Profile settings
              </span>
            </button>
          )}
          {member && (phone || !inlineDm) && (
            // In a conversation on a computer, "DM settings" above opens these with its own.
            <button
              type="button"
              className={styles.menuItem}
              aria-haspopup="dialog"
              onClick={() => {
                close();
                openDmSettings();
              }}
            >
              <span className={styles.menuIconLabel}>
                <ChatIcon name="settings" />
                DM settings
              </span>
            </button>
          )}
          {accountId && (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                close();
                window.dispatchEvent(new Event("chat-open-push-settings"));
              }}
            >
              <span className={styles.menuIconLabel}>
                <ChatIcon name="bell" />
                Phone notifications
              </span>
            </button>
          )}
          {!member ? (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setIdentityStatus("name");
                close();
              }}
            >
              Link your member name
            </button>
          ) : null}
          {identityStatus === "ready" && !member ? (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setError("");
                setNameState("default");
                setIdentityStatus("name");
                close();
              }}
            >
              Change chat name
            </button>
          ) : null}
          {hasSeparateShortScoutProfile && (
            <a className={styles.menuItem} href="/chat/login/connected">
              Original ShortScout profile / membership settings →
            </a>
          )}
          {canLinkShortScout ? (
            <a
              className={styles.menuItem}
              href={`/api/chat/login/start?link=1&room=shortscout${popout ? "&popout=1" : ""}`}
            >
              <span className={styles.menuIconLabel}>
                <ChatIcon name="link" />
                Connect ShortScout →
              </span>
            </a>
          ) : null}
          {serverSession ? (
            <button
              className={styles.menuItem}
              onClick={async () => {
                try {
                  if (accountId) await disableCurrentChatPush(accountId);
                } catch {
                  setError("Could not turn off this device's notifications. Please try signing out again.");
                  return;
                }
                const response = await fetch("/api/chat/login/logout", { method: "POST" });
                if (response.ok) {
                  // Messages waiting to send belong to this member on this device only.
                  clearChatOutbox(window.localStorage, member?.id);
                  // Recent chat kept on this device (DEVICE-STORE) goes with the session.
                  await clearChatDeviceStore();
                  window.location.replace(loginHref);
                } else setError("Could not sign out. Please try again.");
              }}
            >
              <span className={styles.menuIconLabel}>
                <ChatIcon name="signout" />
                Sign out of chat
              </span>
            </button>
          ) : null}
          <div className={styles.menuDivider} />
          <div className={styles.menuSectionLabel}>App</div>
          <div role="group" aria-label="Chat theme">
            {CHAT_THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.menuItem}
                aria-pressed={theme === option.value}
                onClick={() => setTheme(option.value)}
              >
                <span className={styles.menuIconLabel}>
                  <ChatIcon name={option.icon} /> {option.label}
                </span>
                <span aria-hidden="true">{theme === option.value ? "✓" : ""}</span>
              </button>
            ))}
          </div>
          <Link className={styles.menuItem} href="/chat/quad">
            <span className={styles.menuIconLabel}>
              <ChatIcon name="grid" />
              Quad view
            </span>
          </Link>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              close();
              window.dispatchEvent(new Event("chat-refresh-app"));
            }}
          >
            <span className={styles.menuIconLabel}>
              <ChatIcon name="refresh" />
              Refresh app
            </span>
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              close();
              window.dispatchEvent(new Event("chat-open-install-guide"));
            }}
          >
            <span className={styles.menuIconLabel}>
              <ChatIcon name="phone" />
              Install on phone
            </span>
          </button>
        </>
      )}
    </ChatHeaderMenu>
  );
  if (phone) {
    const title = inlineDm ? (dmView ?? "Direct message") : searchOpen ? "Search" : roomTitle;
    const subtitle = inlineDm ? "Direct message" : searchOpen ? `From ${roomTitle}` : presence;
    return (
      <>
        <header
          className={styles.header}
          data-phone="true"
          data-dm={inlineDm}
          data-push-prompt={pushPrompt !== "hidden" || undefined}
        >
          <button
            ref={navTrigger}
            type="button"
            className={styles.phoneIconButton}
            aria-label="Back to all chats"
            onClick={phoneBack}
          >
            <ChatIcon name="back" size={24} />
          </button>
          {/* Tapping the title opens the info sheet too; the info button is the labelled control. */}
          <div className={styles.phoneTitle} onClick={openInfo}>
            <h1 title={title}>{title}</h1>
            <small
              className={styles.onlineCount}
              data-live={!inlineDm && !searchOpen && presenceReady && !roomPaused}
              aria-live="polite"
            >
              {!inlineDm && !searchOpen && <i aria-hidden="true" />}
              {subtitle}
            </small>
          </div>
          <ChatPushPromptButton state={pushPrompt} className={styles.phoneIconButton} />
          <button
            ref={infoTrigger}
            type="button"
            className={styles.phoneIconButton}
            aria-label={inlineDm ? "Conversation info" : "Room info"}
            aria-haspopup="dialog"
            aria-expanded={infoOpen}
            onClick={openInfo}
          >
            <ChatIcon name="info" size={22} />
          </button>
        </header>
        {listBarHost &&
          createPortal(
            <>
              <ChatPushPromptButton state={pushPrompt} className={styles.phoneIconButton} />
              {bell}
              {menu}
            </>,
            listBarHost,
          )}
      </>
    );
  }
  return (
    <header className={styles.header} data-dm={inlineDm}>
      <div className={styles.compactBrand}>
        {inlineDm ? (
          <>
            <button
              ref={navTrigger}
              type="button"
              className={styles.dmRoomBack}
              aria-label={`Back to ${roomLabel} room`}
              title={`Back to ${roomLabel} room`}
              onClick={() => {
                setRoomSelection((value) => value + 1);
                setDmTarget(null);
                setSearchOpen(false);
              }}
            >
              <span aria-hidden="true">←</span>
              <span>{roomLabel}</span>
            </button>
            {/* Clicking the name opens conversation info too; the info button is the labelled control. */}
            <div className={`${styles.communityTitle} ${styles.headerInfoTitle}`} onClick={openInfo}>
              <h1 title={dmView ?? undefined}>{dmView}</h1>
            </div>
          </>
        ) : (
          <>
            <button
              ref={navTrigger}
              type="button"
              className={styles.mobileNavArrow}
              aria-label="Open room navigation"
              aria-expanded={mobileNavOpen}
              aria-controls="chat-room-navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              ←
            </button>
            {room === "social" ? (
              <span
                className={styles.lbMark}
                role="img"
                aria-label="Social community"
                title="Social community"
              >
                <SocialCommunityIcon />
              </span>
            ) : (
              <span
                className={styles.lbMark}
                aria-label={
                  gainers ? "Gainers alerts" : shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"
                }
                title={gainers ? "Gainers alerts" : shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"}
              >
                {gainers ? "G" : shortScoutRoom ? "SS" : "LB"}
                <span aria-hidden="true">{gainers ? "↗" : shortScoutRoom ? "↘" : "🌴"}</span>
              </span>
            )}
            <div
              className={`${styles.communityTitle} ${styles.roomHeaderTitle} ${styles.headerInfoTitle}`}
              onClick={openInfo}
            >
              <h1 title={roomTitle}>{roomTitle}</h1>
              {
                <span
                  className={styles.onlineCount}
                  data-live={presenceReady && !roomPaused}
                  data-paused={roomPaused || undefined}
                  aria-live="polite"
                >
                  <i aria-hidden="true" />
                  {presence}
                </span>
              }
            </div>
          </>
        )}
      </div>
      <div className={styles.headerActions}>
        {gainers && !inlineDm && !popout && (
          <button
            type="button"
            className={styles.headerSearch}
            aria-label="Pop out Gainers"
            title="Pop out Gainers"
            onClick={openPopout}
          >
            ↗ <span>Pop out</span>
          </button>
        )}
        <SkipLatestButton
          className={styles.headerSearch}
          label="Latest"
          disabled={!inlineDm && (loading || !openingReady || skippingLatest)}
          onClick={jumpToLatest}
        />
        <button
          type="button"
          className={styles.headerSearch}
          aria-label="Search chat"
          aria-pressed={searchOpen && !inlineDm}
          onClick={() => {
            setRoomSelection((value) => value + 1);
            setDmTarget(null);
            setSearchOpen(true);
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <span>Search chat</span>
        </button>
        {member && (
          <button
            ref={infoTrigger}
            type="button"
            className={`${styles.headerSearch} ${styles.headerInfo}`}
            aria-label={inlineDm ? "Conversation info" : "Room info"}
            title={inlineDm ? "Conversation info" : "Room info"}
            aria-haspopup="dialog"
            aria-expanded={infoOpen}
            onClick={openInfo}
          >
            <ChatIcon name="info" size={18} />
          </button>
        )}
        {bell}
        {menu}
      </div>
    </header>
  );
}

export default memo(ChatHeader);
