"use client";
import {
  revealPinnedMessage,
  watchPinnedMessageIntent,
  type PinnedMessageJump,
} from "@/lib/chatPinnedMessageJump";
import { useChatScrollIntent } from "./hooks/useChatScrollIntent";
import ComposerLinkPreview from "./ComposerLinkPreview";
import {
  chatPaneVisible,
  chatPaneAtBottom,
  chatPaneFollowingScroll,
  chatPaneScrollIntent,
  chatScrollPointer,
  chatScrollKey,
  type ChatScrollIntent,
  watchChatPaneLayout,
} from "@/lib/chatScrollFollow";
import { ChatReadRecovery } from "@/lib/chatReadRecovery";
import { openChatPopout } from "@/lib/chatPopout";
import { beginMobileSend, watchChatViewport } from "@/lib/chatMobileSend";
import { useMobileKeyboardDismiss } from "./hooks/useMobileKeyboardDismiss";
import ChatFavorite from "./ChatFavorite";
import ChatPins from "./ChatPins";
import RoomMessagePins from "./RoomMessagePins";
import { useRoomMessagePins } from "./hooks/useRoomMessagePins";
import type { RoomMessagePin } from "@/lib/chatRoomMessagePins";
import { ChatRoomCache, type RoomSnapshot } from "@/lib/chatRoomCache";
import { ChatSessionContext, useChatSession } from "./ChatSession";
import RoomMessageRow from "./RoomMessageRow";
import { reconcileRoomMessages } from "@/lib/chatMessageIdentity";
import { jumpToLatestState } from "@/lib/chatJumpToLatest";
import { realtimeRoomMessage } from "@/lib/chatRealtimeRoom";
import { useChatRefreshGuard } from "./hooks/useChatRefreshGuard";
import { clearChatDrafts } from "@/lib/chatRefreshDrafts";
import VoiceRecorder from "./VoiceRecorder";
import { isAnnouncementRoom } from "@/lib/publicChat";
import { ChatUpdatesProvider, useChatUpdates, useChatAccess, useChatIdentity } from "./ChatUpdates";
import AttachmentMetadataProvider from "./AttachmentMetadata";

import type { ChatBootstrap } from "@/lib/chatBootstrapTypes";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { parseSummaryCommand } from "@/lib/chatSummaryCommand";
import {
  CHAT_ROOMS,
  parseChatRoom,
  countChatters,
  mergeReaction,
  mergeRoomMessage,
  type ChatRoom,
  type PublicChatMessage,
  type PublicChatReaction,
  type PublicChatRoomState,
} from "@/lib/publicChat";
import { createClient } from "@/lib/supabase/client";
import { chatThemeCookie, type ChatTheme } from "@/lib/chatTheme";
import type { RealtimeChannel } from "@supabase/supabase-js";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, useId } from "react";
import SocialCommunityIcon from "./SocialCommunityIcon";
import ChatActivityBell from "./ChatActivityBell";
import { AttachmentPicker } from "./ChatAttachments";
import { GifComposer } from "./ChatGif";
import ChatHeaderMenu from "./ChatHeaderMenu";
import type { ReplyDraft } from "./ChatReplyPanel";
import dynamic from "next/dynamic";
import DirectInbox from "./DirectInbox";
import SkipLatestButton from "./SkipLatestButton";
import StartDirectMessage from "./StartDirectMessage";
import RoomMemberList from "./RoomMemberList";
import { disableCurrentChatPush } from "@/lib/chatPushBrowser";
import ChatAppControls from "./ChatAppControls";
import ChatProfileSettings from "./ChatProfileSettings";
import { newerChatMember } from "@/lib/chatMemberName";
import ChatPushSettings from "./ChatPushSettings";
import ChatInstallGuide from "./ChatInstallGuide";
import FeatureNotifications from "./FeatureNotifications";
import { useAttachments } from "./hooks/useAttachments";
import { ChatActivityProvider, useSharedChatActivity } from "./ChatActivityContext";
import { useVisibleChatNotifications } from "./hooks/useVisibleChatNotifications";
import { useReplyCounts } from "./hooks/useReplyCounts";
import { useReplyNavigation } from "./hooks/useReplyNavigation";
import MentionTextarea from "./MentionTextarea";
import styles from "./PublicChat.module.css";
import { MessageReactionProvider } from "./MessageReactions";

// Secondary tools are downloaded only when their visible gate first renders.
const ChatSearch = dynamic(() => import("./ChatSearch"), {
  ssr: false,
  loading: () => (
    <p className={styles.loading} role="status">
      Loading search…
    </p>
  ),
});
const ChatReportReview = dynamic(() => import("./ChatReportReview"), {
  ssr: false,
  loading: () => <p role="status">Loading reported conversations…</p>,
});
const ChatReplyPanel = dynamic(() => import("./ChatReplyPanel"), {
  ssr: false,
  loading: () => (
    <aside className={styles.replyPanel} aria-label="Comment replies" aria-busy="true">
      <header>
        <h2>Thread</h2>
        <button type="button" onClick={() => window.history.back()} aria-label="Back from loading replies">
          ← Back
        </button>
      </header>
      <p className={styles.loading} role="status">
        Loading replies…
      </p>
    </aside>
  ),
});

const GUEST_TOKEN_KEY = "longboard-public-chat-guest-token-v1";
const GUEST_NAME_KEY = "longboard-public-chat-display-name-v1";
const CHAT_THEME_KEY = "longboard-public-chat-theme-v1";
const MAX_MESSAGE_LENGTH = 600;
const COUNTER_THRESHOLD = 500;

type IdentityStatus = "checking" | "name" | "ready";
type ActionState = "default" | "loading" | "error" | "success";
const CHAT_THEMES: Array<{ value: ChatTheme; label: string; icon: string }> = [
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "light", label: "Light", icon: "☀" },
  { value: "blade-runner", label: "Blade Runner", icon: "🤖" },
];

type GuestResponse = {
  guestId?: string;
  displayName?: string;
  message?: PublicChatMessage | string;
  reaction?: PublicChatReaction;
  room?: PublicChatRoomState;
  buddyError?: string;
  error?: string;
};

type AdminSummary = {
  id: string;
  summary_date: string;
  message_count: number;
  model: string;
  summary_text: string;
  updated_at: string;
};

type AdminResponse = {
  isOwner?: boolean;
  room?: PublicChatRoomState;
  summaries?: AdminSummary[];
  result?: { status?: string; summary?: AdminSummary };
  error?: string;
};

async function invokeGuest(body: Record<string, unknown>): Promise<GuestResponse> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as GuestResponse;
  if (response.ok) return result;
  if (result.error === "chat_paused")
    throw new Error("Chat is temporarily paused. History remains available below.");
  throw new Error(
    typeof result.message === "string" ? result.message : "The chat service did not respond. Try again.",
  );
}

async function invokeAdmin(room: ChatRoom, body?: Record<string, unknown>): Promise<AdminResponse> {
  const response = await fetch(
    `/api/chat/admin?room=${room}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = (await response.json().catch(() => ({}))) as AdminResponse;
  if (response.ok) return result;
  throw new Error(result.error || "The chat admin service did not respond.");
}

export type PublicChatProps = {
  /** Saved theme read from the theme cookie on the server, to avoid a flash on load. */
  initialTheme?: ChatTheme | null;
  pane?: {
    visible: boolean;
    active?: boolean;
    conversationId?: string;
    onPrivateMessage?: (id: string) => void;
    onSkipLatest?: (handler: (() => void) | null) => void;
  };
  hasSeparateShortScoutProfile?: boolean;
  appVersion?: string;
  bootstrap?: ChatBootstrap;
  accountId?: string;
  roomRealtime?: boolean;
  realtimeRooms?: ChatRoom[];
  featureChannel?: boolean;
  allowedRooms?: ChatRoom[];
  serverSession?: boolean;
  canLinkShortScout?: boolean;
  isAdmin?: boolean;
  room: ChatRoom;
  popout: boolean;
  fontVariableClass: string;
};
function PublicChatContent({
  pane,
  initialTheme,
  hasSeparateShortScoutProfile = false,
  cold,
  snapshot,
  onSnapshot,
  onNavigate,
  onRoomsUpdated,
  clearSession,
  accountId,
  bootstrap,
  room,
  popout,
  fontVariableClass,
  isAdmin = false,
  allowedRooms: initialAllowedRooms = ["main", "social"],
  serverSession = false,
  canLinkShortScout: initialCanLinkShortScout = false,
  featureChannel = false,
}: PublicChatProps & {
  cold: boolean;
  snapshot: RoomSnapshot | null;
  onSnapshot: (snapshot: RoomSnapshot) => void;
  onNavigate: (room: ChatRoom) => void;
  onRoomsUpdated: (rooms: ChatRoom[]) => void;
  clearSession: () => void;
}) {
  const currentAccess = useChatAccess(accountId);
  useEffect(() => {
    if (currentAccess) onRoomsUpdated(currentAccess.rooms);
  }, [currentAccess, onRoomsUpdated]);
  const allowedRooms = currentAccess?.rooms ?? initialAllowedRooms;
  const canLinkShortScout = currentAccess?.canLinkShortScout ?? initialCanLinkShortScout;
  const [accessDenied, setAccessDenied] = useState(false);
  const roomDenied = accessDenied || (!!currentAccess && !allowedRooms.includes(room));
  const session = useChatSession();
  const {
    dmSidebarHost,
    setDmSidebarHost,
    dmConversationHost,
    setDmConversationHost,
    dmView,
    setDmView,
    roomSelection,
    setRoomSelection,
    dmTarget,
    setDmTarget,
    navTrigger,
    mobileNavOpen,
    setMobileNavOpen,
    setMember: publishMember,
  } = session;
  const updates = useChatUpdates()!;
  const recordings = room === "lb-recordings" || room === "ss-recordings";
  const announcement = isAnnouncementRoom(room);
  const gainers = room === "gainers";
  const readOnlyAnnouncement = gainers || (announcement && !isAdmin);
  const shortScoutRoom = room === "shortscout" || room === "ss-announcements" || room === "ss-recordings";
  const roomLabel = CHAT_ROOMS.find((option) => option.slug === room)!.label;
  const roomHref = (slug: ChatRoom) => `/chat?room=${slug}${popout ? "&popout=1" : ""}`;
  const loginHref = `/chat/login?room=${room}${popout ? "&popout=1" : ""}`;
  const supabase = useMemo(() => createClient(), []);
  const [theme, setTheme] = useState<ChatTheme>(initialTheme ?? "dark");
  const [themeReady, setThemeReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVisited, setSearchVisited] = useState(false);
  const sharedIdentity = useChatIdentity();
  const [member, setMember] = useState<ChatMember | null>(bootstrap?.member ?? null);
  useEffect(() => {
    publishMember(member);
  }, [member, publishMember]);
  const activity = useSharedChatActivity();
  const { data: activityData, read: readActivity } = activity;
  const lastRoomRead = useRef("");
  const scrolledMention = useRef("");
  const [signedIn, setSignedIn] = useState(!!bootstrap);
  const [identityError, setIdentityError] = useState("");
  const [mobileActionsHost, setMobileActionsHost] = useState<HTMLDivElement | null>(null);

  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>(
    bootstrap ? (bootstrap.member ? "ready" : "name") : "checking",
  );
  const [guestId, setGuestId] = useState(bootstrap?.member?.id ?? "");
  const [displayName, setDisplayName] = useState(bootstrap?.member?.display_name ?? "");
  const [chatterCount, setChatterCount] = useState(0);
  const [presenceReady, setPresenceReady] = useState(false);
  const [onlineMemberIds, setOnlineMemberIds] = useState<Set<string>>(new Set());
  const [nameDraft, setNameDraft] = useState(bootstrap?.member?.display_name ?? "");
  useEffect(() => {
    const next = sharedIdentity && sharedIdentity.accountId === accountId ? sharedIdentity.member : null;
    if (!next || !member || next.id !== member.id) return;
    const accepted = newerChatMember(member, next);
    if (accepted === member) return;
    setMember(accepted);
    setDisplayName(accepted.display_name);
    setNameDraft(accepted.display_name);
  }, [sharedIdentity, accountId, member]);
  const {
    target: navigationReplyTarget,
    depth: replyDepth,
    mobile: mobileReplies,
    open: openReplies,
    back: backReplies,
    close: closeReplies,
  } = useReplyNavigation(room, session.navigationOwner, !!pane);
  const replyTarget = recordings ? null : navigationReplyTarget;
  const replyDrafts = useRef<Record<string, ReplyDraft>>(snapshot?.replyDrafts ?? {});
  const uploads = useAttachments(room);
  const messageRetry = useRef<{ key: string; id: string } | null>(null);

  const navRef = useRef<HTMLElement>(null);

  const navWasOpen = useRef(false);

  useEffect(() => {
    setRoomSelection((value) => value + 1);
    setDmTarget(null);
  }, [room, setRoomSelection, setDmTarget]);
  const inlineDm = !!pane?.conversationId || dmView !== null;
  const roomPins = useRoomMessagePins(
    accountId,
    room,
    identityStatus === "ready" && !roomDenied && !inlineDm && !searchOpen && pane?.visible !== false,
  );
  const pinControls = useMemo(
    () => ({
      canManagePins: roomPins.canManagePins,
      pinnedIds: new Set(roomPins.pins.map((pin) => pin.messageId)),
      busy: roomPins.busy,
      onToggle: roomPins.toggle,
    }),
    [roomPins.canManagePins, roomPins.pins, roomPins.busy, roomPins.toggle],
  );
  useEffect(() => {
    setMobileNavOpen(false);
  }, [room, mobileReplies, setMobileNavOpen]);
  useEffect(() => {
    if (mobileNavOpen && mobileReplies) {
      navWasOpen.current = true;
      navRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (navWasOpen.current) {
      navWasOpen.current = false;
      navTrigger.current?.focus({ preventScroll: true });
    }
  }, [mobileNavOpen, mobileReplies, navTrigger]);

  const replyTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!replyTarget) replyTrigger.current?.focus({ preventScroll: true });
  }, [replyTarget]);
  const messageVersion = useRef(0);
  const [messages, updateMessages] = useState<PublicChatMessage[]>(bootstrap?.messages ?? []);
  const setMessages = useCallback((action: React.SetStateAction<PublicChatMessage[]>) => {
    messageVersion.current++;
    updateMessages(action);
  }, []);
  const knownMessageIds = useRef("");
  // Derived ID lists change only with messages; typing and scrolling must not rebuild them.
  const messageIds = useMemo(
    () => ({
      known: messages
        .filter((message) => !message.pending)
        .slice(-200)
        .map((message) => message.id)
        .join(","),
      replies: messages
        .filter((m) => !m.pending && !m.removed)
        .map((m) => m.id)
        .join(","),
      visible: messages
        .filter((message) => !message.pending && !message.deleted_at && !message.removed)
        .map((message) => message.id),
    }),
    [messages],
  );
  knownMessageIds.current = messageIds.known;
  const replyCounts = useReplyCounts(room, inlineDm ? "" : messageIds.replies, bootstrap?.counts, {
    accountId,
    memberId: member?.id,
  });
  const [reactions, updateReactions] = useState<PublicChatReaction[]>(bootstrap?.reactions ?? []);
  const setReactions = useCallback((action: React.SetStateAction<PublicChatReaction[]>) => {
    messageVersion.current++;
    updateReactions(action);
  }, []);
  const [body, setBody] = useState(snapshot?.draft ?? "");
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = composerRef.current;
    if (!node || CSS.supports("field-sizing", "content")) return;
    // Fallback auto-grow; CSS min-height and max-height still bound the result.
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
  }, [body, identityStatus]);
  const [loading, setLoading] = useState(cold);
  const [nameState, setNameState] = useState<ActionState>("default");
  const [sendState, setSendState] = useState<ActionState>("default");
  useChatRefreshGuard(
    pane?.conversationId ? undefined : member?.id,
    pane?.conversationId ? null : `room:${room}`,
    body,
    setBody,
    uploads.blocked ||
      uploads.files.length > 0 ||
      sendState === "loading" ||
      sendState === "error" ||
      messages.some((message) => message.pending) ||
      Object.values(replyDrafts.current).some((draft) => !!draft.pending?.length),
    () => {
      if (inlineDm || pane) return;
      const url = new URL(window.location.href);
      url.searchParams.set("room", room);
      url.searchParams.delete("dm");
      if (replyTarget) url.searchParams.set("thread", replyTarget);
      else url.searchParams.delete("thread");
      window.history.replaceState(window.history.state, "", url);
    },
  );
  const restoredThread = useRef(false);
  useEffect(() => {
    if (pane || recordings || !member || restoredThread.current) return;
    restoredThread.current = true;
    const id = new URL(window.location.href).searchParams.get("thread");
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) openReplies(id);
  }, [member, openReplies, pane, recordings]);
  const [popoutState, setPopoutState] = useState<ActionState>("default");
  const [roomStatus, setRoomStatus] = useState<PublicChatRoomState | null>(
    !cold && bootstrap?.room === room ? bootstrap.roomState : null,
  );
  const [isOwner, setIsOwner] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  // Preserve search state after first use; never mount a closed search initially.
  useEffect(() => {
    if (searchOpen && !inlineDm) setSearchVisited(true);
  }, [searchOpen, inlineDm]);
  const [adminState, setAdminState] = useState<ActionState>("default");
  const [adminAction, setAdminAction] = useState<"room" | "summary" | null>(null);
  const [adminFeedback, setAdminFeedback] = useState("");
  const [adminReason, setAdminReason] = useState("");
  const [summaries, setSummaries] = useState<AdminSummary[]>([]);
  const [error, setError] = useState("");
  const [connectionIssue, setConnectionIssue] = useState<{ room: ChatRoom; message: string } | null>(null);
  const connectionError = connectionIssue?.room === room ? connectionIssue.message : "";
  const mentionNamesSignature = useMemo(
    () =>
      JSON.stringify([
        ...new Set([
          "Buddy",
          ...(member?.display_name ? [member.display_name] : []),
          ...messages.filter((message) => message.member_id).map((message) => message.author_label),
        ]),
      ]),
    [messages, member?.display_name],
  );
  const mentionNames = useMemo<string[]>(() => JSON.parse(mentionNamesSignature), [mentionNamesSignature]);
  const canMessage = !!member;
  const openPrivateMessage = useCallback(
    (id: string, name: string) => {
      if (pane) {
        pane.onPrivateMessage?.(id);
        return;
      }
      if (!canMessage) {
        window.location.href = loginHref;
        return;
      }
      setDmTarget({ id, name });
    },
    [canMessage, loginHref, setDmTarget, pane],
  );
  const openMessageReplies = useCallback(
    (id: string, trigger: HTMLButtonElement) => {
      replyTrigger.current = trigger;
      openReplies(id);
    },
    [openReplies],
  );
  const editMessage = useCallback(
    (updated: PublicChatMessage) => setMessages((current) => mergeRoomMessage(current, updated)),
    [setMessages],
  );
  const deleteMessage = useCallback(
    (id: string, message?: PublicChatMessage | null) => {
      setMessages((current) =>
        message ? mergeRoomMessage(current, message) : current.filter((message) => message.id !== id),
      );
      updates.invalidate("room", "history", "activity");
      setReactions((current) => current.filter((reaction) => reaction.message_id !== id));
    },
    [setMessages, setReactions, updates],
  );
  const pinnedToBottom = useRef(true);
  // Newest sequence the reader had seen when they stopped following; Infinity while following.
  const awaySeq = useRef(Infinity),
    farFromBottom = useRef(false),
    previousMaxSeq = useRef(0);
  const scrollIntent = useRef<ChatScrollIntent | null>(null),
    resumeLive = useRef(false);
  useChatScrollIntent(scrollIntent);
  const [openingReady, setOpeningReady] = useState(pane?.active === false);
  const [unreadStart, setUnreadStart] = useState<string | null>(null);
  const [unreadThread, setUnreadThread] = useState<{
    parentId: string;
    messageId: string;
    readThrough: number;
  } | null>(null);
  const [historyPage, setHistoryPage] = useState<{ hasMore: boolean; hasNewer: boolean }>({
    hasMore: false,
    hasNewer: false,
  });
  const historyWindow = useRef<string | null>(null),
    pageScroll = useRef<"first" | "last" | null>(null);
  const latestReadPending = useRef(0),
    latestReadConfirmed = useRef(0),
    latestIntentCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => latestIntentCleanup.current?.(), []);
  const pageBusy = useRef(0);
  const [paging, setPaging] = useState(false),
    [sentWindowRetry, setSentWindowRetry] = useState(false);
  const sendReadHold = useRef(false),
    readIntentThrough = useRef(0);
  const readIntent = (target: EventTarget | null) => {
    if (
      historyPage.hasNewer ||
      (target instanceof Element &&
        target.closest('textarea,input,select,[contenteditable="true"],dialog,[aria-modal="true"]'))
    )
      return;
    if (sendReadHold.current || readIntentThrough.current) {
      sendReadHold.current = false;
      readIntentThrough.current = messages.reduce((max, row) => Math.max(max, row.unread_seq ?? 0), 0);
      setRoomScrollVersion((v) => v + 1);
    }
  };

  // The server-rendered landing spot, used once for the first open of this room.
  const initialOpening = useRef(!cold && bootstrap?.room === room ? bootstrap.opening : undefined);
  const openingPending = useRef(pane?.active !== false),
    openingAnchor = useRef<string | null>(null),
    openingMoved = useRef(false);
  const openingCancelled = useRef(false),
    openingReadThrough = useRef(0),
    openingSettled = useRef(""),
    openingScope = useRef(""),
    openingChildPending = useRef(false),
    openingIntentCleanup = useRef<(() => void) | null>(null),
    visibleReplyReadThrough = useRef(0);
  const pinJumpRequest = useRef(0),
    pinScrollTarget = useRef<PinnedMessageJump | null>(null);
  const pinHighlightCleanup = useRef<(() => void) | null>(null);
  const pinIntent = useRef(false),
    pinIntentCleanup = useRef<(() => void) | null>(null);
  const [pinReplyJump, setPinReplyJump] = useState<PinnedMessageJump | null>(null);
  const cancelPinJump = useCallback(() => {
    if (!pinIntent.current) return;
    pinIntent.current = false;
    pinIntentCleanup.current?.();
    pinJumpRequest.current++;
    pinScrollTarget.current = null;
    pinHighlightCleanup.current?.();
    setPinReplyJump(null);
  }, []);
  const pinNavigation = useRef({ key: "", version: 0 });
  const pinNavigationKey = JSON.stringify([
    accountId,
    member?.id,
    room,
    replyTarget,
    searchOpen,
    inlineDm,
    mobileNavOpen,
    pane?.visible,
  ]);
  if (pinNavigation.current.key !== pinNavigationKey)
    pinNavigation.current = { key: pinNavigationKey, version: pinNavigation.current.version + 1 };
  useLayoutEffect(() => {
    if (pane?.active === false || pane?.visible === false || searchOpen || inlineDm || mobileNavOpen)
      cancelPinJump();
  }, [pane?.active, pane?.visible, searchOpen, inlineDm, mobileNavOpen, cancelPinJump]);
  useEffect(
    () => () => {
      pinIntentCleanup.current?.();
      pinHighlightCleanup.current?.();
    },
    [],
  );
  useEffect(() => {
    if (pinReplyJump && pinReplyJump.messageId !== replyTarget) setPinReplyJump(null);
  }, [pinReplyJump, replyTarget]);
  const [pinJumpError, setPinJumpError] = useState("");
  const [pinRevealRequest, setPinRevealRequest] = useState(0);
  const [roomScrollVersion, setRoomScrollVersion] = useState(0);
  const scrollSignature = useRef("");
  const maxSeq = useMemo(
    () => messages.reduce((max, message) => Math.max(max, message.unread_seq ?? 0), 0),
    [messages],
  );
  useLayoutEffect(() => {
    if (pinnedToBottom.current) awaySeq.current = Infinity;
    // Away without a recorded boundary (pin jump, paging): count from what was already loaded.
    else if (awaySeq.current === Infinity) awaySeq.current = previousMaxSeq.current;
    previousMaxSeq.current = maxSeq;
  }, [maxSeq]);
  const settleOpening = () => {
    openingIntentCleanup.current?.();
    openingIntentCleanup.current = null;
    openingSettled.current = openingScope.current;
  };
  const cancelOpening = () => {
    openingIntentCleanup.current?.();
    openingIntentCleanup.current = null;
    if (!openingMoved.current) setUnreadStart(null);
    if (openingSettled.current !== openingScope.current && (openingPending.current || !openingMoved.current))
      pinnedToBottom.current = false;
    openingCancelled.current = true;
    openingMoved.current = true;
  };
  const initialScrollDone = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const mobilePage = useRef<HTMLElement>(null);
  useMobileKeyboardDismiss(mobilePage);
  useEffect(() => (mobilePage.current ? watchChatViewport(mobilePage.current) : undefined), []);
  const loadedRoom = useRef<ChatRoom | null>(cold ? null : (bootstrap?.room ?? null));
  const latestSnapshot = useRef<RoomSnapshot | null>(null);
  latestSnapshot.current =
    accountId && roomStatus
      ? {
          bootstrap: {
            accountId,
            room,
            member,
            roomState: roomStatus,
            messages,
            reactions,
            counts: replyCounts,
            featureChannel,
          },
          draft: body,
          replyDrafts: replyDrafts.current,
          scroll: messagesRef.current?.scrollTop ?? snapshot?.scroll ?? 0,
          pinned: pinnedToBottom.current,
        }
      : null;
  const saveSnapshot = () => {
    if (latestSnapshot.current)
      onSnapshot({
        ...latestSnapshot.current,
        scroll: messagesRef.current?.scrollTop ?? latestSnapshot.current.scroll,
        pinned: pinnedToBottom.current,
      });
  };
  useLayoutEffect(
    () => () => {
      if (latestSnapshot.current)
        onSnapshot({
          ...latestSnapshot.current,
          scroll: messagesRef.current?.scrollTop ?? latestSnapshot.current.scroll,
          pinned: pinnedToBottom.current,
        });
    },
    [onSnapshot],
  );
  useEffect(() => {
    // A landing spot is only valid for the first open; opening into a DM first makes it stale.
    if (inlineDm) initialOpening.current = undefined;
    if (
      !member?.id ||
      identityStatus !== "ready" ||
      inlineDm ||
      pane?.visible === false ||
      pane?.active === false
    )
      return;
    const scope = JSON.stringify([accountId, member.id, room]);
    if (openingScope.current !== scope) openingSettled.current = "";
    if (openingSettled.current === scope) return;
    openingScope.current = scope;
    openingChildPending.current = false;
    visibleReplyReadThrough.current = 0;
    const controller = new AbortController();
    const navigation = pinJumpRequest;
    const intent = ++navigation.current;
    pinIntentCleanup.current?.();
    pinHighlightCleanup.current?.();
    pinIntent.current = false;
    pinScrollTarget.current = null;
    setPinReplyJump(null);
    setPinJumpError("");
    setUnreadStart(null);
    setUnreadThread(null);
    historyWindow.current = null;
    scrollIntent.current = null;
    resumeLive.current = false;
    sendReadHold.current = false;
    readIntentThrough.current = 0;
    setSentWindowRetry(false);
    latestReadPending.current = 0;
    latestReadConfirmed.current = 0;
    setHistoryPage({ hasMore: false, hasNewer: false });
    openingPending.current = true;
    setOpeningReady(false);
    openingCancelled.current = false;
    openingMoved.current = false;
    initialScrollDone.current = false;
    openingAnchor.current = null;
    openingReadThrough.current = 0;
    pinnedToBottom.current = true;
    const preset = initialOpening.current;
    initialOpening.current = undefined;
    const deepLink =
      window.location.hash.startsWith("#chat-message-") ||
      new URL(window.location.href).searchParams.has("thread");
    if (deepLink) {
      // The server may have rendered a page around the unread anchor; keep paging consistent with it.
      if (preset?.window) {
        historyWindow.current = preset.window.range;
        setHistoryPage({ hasMore: preset.window.hasMore, hasNewer: preset.window.hasNewer });
      }
      openingMoved.current = true;
      pinnedToBottom.current = false;
      initialScrollDone.current = true;
      openingPending.current = false;
      openingSettled.current = scope;
      setOpeningReady(true);
      return;
    }
    const stopIntent = watchPinnedMessageIntent(cancelOpening);
    openingIntentCleanup.current = stopIntent;
    const cleanup = () => {
      stopIntent();
      openingIntentCleanup.current = null;
      controller.abort();
      navigation.current++;
      if (openingSettled.current !== scope) {
        cancelOpening();
        openingPending.current = false;
        setOpeningReady(true);
      }
    };
    if (preset) {
      // The server already found the landing spot and loaded its messages: no round trips.
      openingReadThrough.current = preset.parentId ? 0 : preset.readThrough || 0;
      if (preset.messageId) {
        openingAnchor.current = preset.messageId;
        pinnedToBottom.current = false;
        awaySeq.current = preset.parentId ? Infinity : Math.max(0, preset.readThrough - 1);
        historyWindow.current = preset.window?.range ?? null;
        setHistoryPage({ hasMore: !!preset.window?.hasMore, hasNewer: !!preset.window?.hasNewer });
        setUnreadStart(preset.parentId ? null : (preset.unreadMessageId ?? preset.messageId));
        if (preset.parentId && preset.unreadMessageId) {
          openingChildPending.current = true;
          setUnreadThread({
            parentId: preset.parentId,
            messageId: preset.unreadMessageId,
            readThrough: preset.readThrough || 0,
          });
          openReplies(preset.parentId);
        }
      }
      openingPending.current = false;
      setOpeningReady(true);
      return cleanup;
    }
    void (async () => {
      const response = await fetch(`/api/chat/opening?room=${room}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not find your unread messages. Reopen this room to retry.");
      const result = await response.json();
      if (controller.signal.aborted || intent !== pinJumpRequest.current) return;
      openingReadThrough.current = result.parentId ? 0 : Number(result.readThrough) || 0;
      if (openingCancelled.current) {
        openingPending.current = false;
        setOpeningReady(true);
        return;
      }
      if (result.messageId) {
        const history = await fetch(
          `/api/chat/history?room=${room}&ids=${knownMessageIds.current}&around=${result.messageId}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!history.ok) throw new Error("Could not load your unread conversation.");
        const page = await history.json();
        if (controller.signal.aborted || intent !== pinJumpRequest.current) return;
        if (openingCancelled.current) {
          openingPending.current = false;
          setOpeningReady(true);
          return;
        }
        openingAnchor.current = result.messageId;
        pinnedToBottom.current = false;
        awaySeq.current = result.parentId ? Infinity : Math.max(0, (Number(result.readThrough) || 0) - 1);
        historyWindow.current = page.range ?? null;
        setHistoryPage({ hasMore: !!page.hasMore, hasNewer: !!page.hasNewer });
        setUnreadStart(result.parentId ? null : (result.unreadMessageId ?? result.messageId));
        setMessages((current) => reconcileRoomMessages(current, page.messages));
        if (result.parentId && result.unreadMessageId) {
          openingChildPending.current = true;
          setUnreadThread({
            parentId: result.parentId,
            messageId: result.unreadMessageId,
            readThrough: Number(result.readThrough) || 0,
          });
          openReplies(result.parentId);
        }
      }
      if (controller.signal.aborted || intent !== pinJumpRequest.current) return;
      openingPending.current = false;
      setOpeningReady(true);
    })().catch((e) => {
      if (!controller.signal.aborted && intent === pinJumpRequest.current) {
        setError(e instanceof Error ? e.message : "Chat unavailable");
        // Without a landing spot, open at the latest message rather than leaving the room unpositioned.
        openingPending.current = false;
        setOpeningReady(true);
      }
    });
    return cleanup;
  }, [
    accountId,
    member?.id,
    identityStatus,
    room,
    inlineDm,
    setMessages,
    pane?.visible,
    pane?.active,
    openReplies,
  ]);
  const openPinnedMessage = useCallback(
    async (pin: RoomMessagePin, trigger: HTMLButtonElement) => {
      cancelPinJump();
      scrollIntent.current = null;
      resumeLive.current = false;
      latestIntentCleanup.current?.();
      latestReadPending.current = 0;
      latestReadConfirmed.current = 0;
      setUnreadStart(null);
      setUnreadThread(null);
      historyWindow.current = null;
      setHistoryPage({ hasMore: false, hasNewer: false });
      const request = ++pinJumpRequest.current;
      pinIntent.current = true;
      pinIntentCleanup.current = watchPinnedMessageIntent(cancelPinJump);
      const navigation = pinNavigation.current.version;
      skipRequest.current++;
      setSkippingLatest(false);
      // A pin is navigation, never a request to consume the latest unread boundary.
      openingCancelled.current = true;
      openingMoved.current = true;
      openingReadThrough.current = 0;
      openingPending.current = false;
      initialScrollDone.current = true;
      pinnedToBottom.current = false;
      setOpeningReady(true);
      setPinJumpError("");
      if (pin.replyToId) {
        setPinReplyJump({ messageId: pin.messageId, request, trigger });
        openReplies(pin.messageId);
        return;
      }
      try {
        const response = await fetch(
          `/api/chat/history?room=${room}&ids=${knownMessageIds.current}&anchor=${pin.messageId}`,
          { cache: "no-store" },
        );
        const result = await response.json();
        if (request !== pinJumpRequest.current || navigation !== pinNavigation.current.version) return;
        if (
          !response.ok ||
          !result.messages?.some(
            (message: PublicChatMessage) =>
              message.id === pin.messageId && !message.deleted_at && !message.removed,
          )
        )
          throw Error("This pinned message is no longer available.");
        openingAnchor.current = pin.messageId;
        pinScrollTarget.current = { messageId: pin.messageId, request, trigger };
        setPinRevealRequest(request);
        replyTrigger.current = null;
        closeReplies();
        setMessages((current) => reconcileRoomMessages(current, result.messages));
        setReactions(result.reactions ?? []);
      } catch (error) {
        if (request === pinJumpRequest.current && navigation === pinNavigation.current.version) {
          pinScrollTarget.current = null;
          setPinJumpError(error instanceof Error ? error.message : "Could not open this pinned message.");
          updates.invalidate("room");
        }
      }
    },
    [room, closeReplies, openReplies, setMessages, setReactions, updates, cancelPinJump],
  );
  const [skippingLatest, setSkippingLatest] = useState(false);
  const skipRequest = useRef(0),
    skipFailure = useRef("");
  useEffect(() => {
    const requestState = skipRequest,
      pageState = pageBusy;
    setSkippingLatest(false);
    return () => {
      requestState.current++;
      pageState.current++;
      setPaging(false);
    };
  }, [inlineDm, member?.id, pane?.visible, pane?.active]);
  const skipLatest = useCallback(async () => {
    if (inlineDm) {
      session.dmSkipLatest.current?.();
      return;
    }
    if (skippingLatest || loading || !openingReady || pane?.visible === false) return;
    cancelPinJump();
    scrollIntent.current = null;
    resumeLive.current = false;
    pinJumpRequest.current++;
    pinScrollTarget.current = null;
    setPinJumpError("");
    pageBusy.current++;
    setPaging(false);
    const request = ++skipRequest.current;
    setSkippingLatest(true);
    latestIntentCleanup.current?.();
    latestIntentCleanup.current = watchPinnedMessageIntent(() => {
      if (request === skipRequest.current) {
        skipRequest.current++;
        latestReadPending.current = 0;
        latestReadConfirmed.current = 0;
        pinnedToBottom.current = false;
        setSkippingLatest(false);
        latestIntentCleanup.current?.();
      }
    });
    // Keep the old position and read boundary until fresh latest history succeeds.
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const version = messageVersion.current;
        const response = await fetch(
          `/api/chat/history?room=${room}&ids=${knownMessageIds.current}&latest=1`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("Could not load the most recent message. Please try again.");
        const result = await response.json();
        if (request !== skipRequest.current) return;
        // A send, realtime row, edit, or history refresh may have overtaken this snapshot.
        if (version !== messageVersion.current) continue;
        const previousFailure = skipFailure.current;
        setError((current) => (current === previousFailure ? "" : current));
        skipFailure.current = "";
        pinJumpRequest.current++;
        openingPending.current = false;
        setOpeningReady(true);
        settleOpening();
        openingCancelled.current = true;
        openingMoved.current = true;
        openingAnchor.current = null;
        openingReadThrough.current = 0;
        sendReadHold.current = false;
        readIntentThrough.current = 0;
        setSentWindowRetry(false);
        latestReadPending.current = Number(result.latestThrough) || 0;
        historyWindow.current = null;
        setHistoryPage({ hasMore: false, hasNewer: false });
        setUnreadStart(null);
        setUnreadThread(null);
        pinnedToBottom.current = true;
        initialScrollDone.current = true;
        setSearchOpen(false);
        closeReplies();
        setMobileNavOpen(false);
        setMessages((current) => reconcileRoomMessages(current, result.messages));
        setReactions(result.reactions ?? []);
        setRoomScrollVersion((value) => value + 1);
        updates.invalidate("activity");
        return;
      }
      throw new Error("Messages changed while loading the latest history. Please try again.");
    } catch (e) {
      if (request === skipRequest.current) {
        skipFailure.current = e instanceof Error ? e.message : "Could not load the most recent message.";
        setError(skipFailure.current);
      }
    } finally {
      if (request === skipRequest.current) setSkippingLatest(false);
    }
  }, [
    inlineDm,
    session.dmSkipLatest,
    skippingLatest,
    loading,
    openingReady,
    pane?.visible,
    room,
    closeReplies,
    setMobileNavOpen,
    setMessages,
    setReactions,
    updates,
    cancelPinJump,
  ]);
  async function refreshSentWindow(force = false) {
    if (!force && !pinnedToBottom.current) return;
    const request = ++skipRequest.current;
    const version = messageVersion.current;
    if (force) pinnedToBottom.current = true;
    try {
      const response = await fetch(`/api/chat/history?room=${room}&ids=${knownMessageIds.current}`, {
        cache: "no-store",
      });
      const page = await response.json();
      if (request !== skipRequest.current || !pinnedToBottom.current) return;
      if (!response.ok || version !== messageVersion.current)
        throw Error("Message sent. The latest history could not load. Use Show sent message to retry.");
      historyWindow.current = null;
      openingAnchor.current = null;
      scrollIntent.current = null;
      resumeLive.current = false;
      setUnreadStart(null);
      setHistoryPage({ hasMore: false, hasNewer: false });
      setSentWindowRetry(false);
      setError("");
      setMessages((current) => reconcileRoomMessages(current, page.messages));
      setReactions(page.reactions ?? []);
    } catch (error) {
      if (request === skipRequest.current) {
        setSentWindowRetry(true);
        setError(error instanceof Error ? error.message : "Message sent. Use Show sent message to retry.");
      }
    }
  }
  async function pageHistory(direction: "before" | "after") {
    if (paging || loading) return;
    latestIntentCleanup.current?.();
    latestReadPending.current = 0;
    latestReadConfirmed.current = 0;
    cancelOpening();
    pinnedToBottom.current = false;
    scrollIntent.current = null;
    resumeLive.current = false;
    setUnreadStart(null);
    setUnreadThread(null);
    cancelPinJump();
    const rows = messages.filter((m) => !m.pending && !m.removed && m.unread_seq),
      cursor =
        direction === "before"
          ? (rows[0]?.unread_seq ?? Number(historyWindow.current?.split(",")[0]))
          : (rows.at(-1)?.unread_seq ?? Number(historyWindow.current?.split(",")[1]));
    if (!cursor) return;
    const request = ++skipRequest.current,
      busy = ++pageBusy.current;
    setPaging(true);
    try {
      const response = await fetch(
        `/api/chat/history?room=${room}&ids=${knownMessageIds.current}&${direction}=${cursor}`,
        { cache: "no-store" },
      );
      const page = await response.json();
      if (request !== skipRequest.current) return;
      if (!response.ok) throw Error("Could not load this page. Try again.");
      if (!page.messages?.some((row: PublicChatMessage) => !row.removed)) {
        setError("This page changed. Use Latest to refresh the conversation.");
        return;
      }
      historyWindow.current = page.range ?? null;
      openingAnchor.current = null;
      pageScroll.current = direction === "before" ? "last" : "first";
      setHistoryPage({ hasMore: !!page.hasMore, hasNewer: !!page.hasNewer });
      setMessages((current) => reconcileRoomMessages(current, page.messages));
      setReactions(page.reactions ?? []);
    } catch (e) {
      if (request === skipRequest.current)
        setError(e instanceof Error ? e.message : "Could not load messages.");
    } finally {
      if (busy === pageBusy.current) setPaging(false);
    }
  }
  // On the live tail, move instantly; skipLatest still refreshes the tail and read boundary.
  const jumpToLatest = useCallback(() => {
    const node = messagesRef.current;
    if (!inlineDm && node && !loading && openingReady && !historyWindow.current && !historyPage.hasNewer) {
      cancelPinJump();
      scrollIntent.current = null;
      resumeLive.current = false;
      pinnedToBottom.current = true;
      awaySeq.current = Infinity;
      farFromBottom.current = false;
      node.scrollTop = node.scrollHeight;
      setRoomScrollVersion((value) => value + 1);
    }
    void skipLatest();
  }, [inlineDm, loading, openingReady, historyPage.hasNewer, cancelPinJump, skipLatest]);
  const registerSkipLatest = pane?.onSkipLatest;
  useEffect(() => {
    registerSkipLatest?.(inlineDm || (!loading && openingReady && !skippingLatest) ? jumpToLatest : null);
    return () => registerSkipLatest?.(null);
  }, [registerSkipLatest, inlineDm, loading, openingReady, skippingLatest, jumpToLatest]);
  useVisibleChatNotifications({
    container: messagesRef,
    enabled:
      !!member &&
      identityStatus === "ready" &&
      !loading &&
      openingReady &&
      !searchOpen &&
      !inlineDm &&
      !mobileNavOpen &&
      pane?.visible !== false &&
      pane?.active !== false &&
      (!mobileReplies || !replyTarget),
    scope: { kind: "room", room },
    canonicalIds: messageIds.visible,
    selector: 'article[id^="chat-message-"]',
    attribute: "id",
  });
  const summaryRetry = useRef<{ room: string; id: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const openingThrough = !openingCancelled.current && openingMoved.current ? openingReadThrough.current : 0;
    const renderedThrough = messages.reduce((max, message) => Math.max(max, message.unread_seq ?? 0), 0);
    const activityThrough = activityData.roomMessageThrough?.[room] ?? 0;
    const normalThrough =
      pinnedToBottom.current &&
      !!messagesRef.current &&
      chatPaneAtBottom(messagesRef.current) &&
      !historyPage.hasNewer
        ? Math.min(activityThrough, Math.max(renderedThrough, openingThrough))
        : openingThrough;
    const roomThrough =
      latestReadConfirmed.current ||
      visibleReplyReadThrough.current ||
      (sendReadHold.current
        ? 0
        : readIntentThrough.current
          ? Math.min(normalThrough, readIntentThrough.current)
          : normalThrough);
    // Keep the existing sequence marker independent from exact notification acknowledgements.
    if (
      pane?.visible === false ||
      pane?.active === false ||
      latestReadPending.current ||
      openingPending.current ||
      !openingReady ||
      !member ||
      loading ||
      loadedRoom.current !== room ||
      identityStatus !== "ready" ||
      searchOpen ||
      inlineDm ||
      document.hidden ||
      document.querySelector("dialog[open]") ||
      !roomThrough
    )
      return;
    const key = `${member.id}:${room}:${roomThrough}`;
    if (lastRoomRead.current === key) {
      if (latestReadConfirmed.current === roomThrough) latestReadConfirmed.current = 0;
      if (visibleReplyReadThrough.current === roomThrough) visibleReplyReadThrough.current = 0;
      return;
    }
    lastRoomRead.current = key;
    void readActivity({ kind: "room", room, mentionThrough: 0, roomThrough })
      .then(() => {
        if (latestReadConfirmed.current === roomThrough) latestReadConfirmed.current = 0;
        if (visibleReplyReadThrough.current === roomThrough) visibleReplyReadThrough.current = 0;
      })
      .catch(() => {
        if (lastRoomRead.current === key) lastRoomRead.current = "";
      });
  }, [
    activityData,
    readActivity,
    member,
    loading,
    identityStatus,
    room,
    searchOpen,
    inlineDm,
    openingReady,
    roomScrollVersion,
    messages,
    pane?.visible,
    pane?.active,
    historyPage.hasNewer,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    if (pane) return;
    const reveal = () => {
      const id = window.location.hash.slice(1);
      if (loading || !id.startsWith("chat-message-") || scrolledMention.current === id) return;
      const target = document.getElementById(id);
      if (target) {
        openingCancelled.current = true;
        openingMoved.current = true;
        pinnedToBottom.current = false;
        initialScrollDone.current = true;
        scrollIntent.current = null;
        resumeLive.current = false;
        target.scrollIntoView({ block: "center" });
        scrolledMention.current = id;
        return;
      }
      // Mentions/search may link to a reply now hidden from the main feed.
      void fetch(`/api/chat/thread?room=${room}&messageId=${encodeURIComponent(id.slice(13))}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          const data = await response.json();
          if (!controller.signal.aborted && window.location.hash.slice(1) === id) {
            scrolledMention.current = id;
            openReplies(data.parent.reply_to_id || data.parent.id);
          }
        })
        .catch(() => undefined);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => {
      controller.abort();
      window.removeEventListener("hashchange", reveal);
    };
  }, [loading, messages, room, openReplies, pane]);

  useEffect(() => {
    const saved = window.localStorage.getItem(CHAT_THEME_KEY);
    if (CHAT_THEMES.some((option) => option.value === saved)) {
      setTheme(saved as ChatTheme);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    window.localStorage.setItem(CHAT_THEME_KEY, theme);
    document.cookie = chatThemeCookie(theme);
  }, [theme, themeReady]);

  useEffect(() => {
    let cancelled = false;
    const stop = updates.watch(async () => {
      const response = await updates.read(`/api/chat?room=${room}`);
      const result = await response.json();
      if (!cancelled && response.ok && typeof result.isOpen === "boolean") setRoomStatus(result);
    }, ["status"]);
    return () => {
      cancelled = true;
      stop();
    };
  }, [room, updates]);

  useEffect(() => {
    let cancelled = false;
    if (!isAdmin || pane) return;
    void invokeAdmin(room)
      .then((result) => {
        if (cancelled || !result.isOwner) return;
        setIsOwner(true);
        if (result.room) setRoomStatus(result.room);
        setSummaries(result.summaries ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [room, isAdmin, pane]);

  useEffect(() => {
    if (bootstrap) {
      window.localStorage.removeItem(GUEST_TOKEN_KEY);
      if (!bootstrap.member) setNameDraft(window.localStorage.getItem(GUEST_NAME_KEY) ?? "");
      return;
    }
    let cancelled = false;
    async function identify() {
      try {
        const response = await fetch("/api/chat/member", { cache: "no-store" });
        if (!response.ok) throw new Error("Your chat identity could not load. Please refresh to try again.");
        const account = (await response.json()) as { signedIn: boolean; member: ChatMember | null };
        if (cancelled) return;
        if (!account.signedIn) {
          window.location.replace(loginHref);
          return;
        }
        setSignedIn(true);
        const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
        const savedName = window.localStorage.getItem(GUEST_NAME_KEY) ?? "";
        if (account.member) {
          setMember(account.member);
          setGuestId(account.member.id);
          setDisplayName(account.member.display_name);
          setNameDraft(account.member.display_name);
          window.localStorage.removeItem(GUEST_TOKEN_KEY);
          setIdentityStatus("ready");
          return;
        }
        if (account.signedIn || !token) {
          setNameDraft(savedName);
          setIdentityStatus("name");
          return;
        }
        try {
          const result = await invokeGuest({ room, action: "session", token });
          if (cancelled) return;
          if (!result.guestId || !result.displayName) throw new Error("invalid_session");
          setGuestId(result.guestId);
          setDisplayName(result.displayName);
          setNameDraft(result.displayName);
          setIdentityStatus("ready");
        } catch {
          if (!cancelled) {
            window.localStorage.removeItem(GUEST_TOKEN_KEY);
            setNameDraft(savedName);
            setIdentityStatus("name");
          }
        }
      } catch (e) {
        if (!cancelled)
          setIdentityError(e instanceof Error ? e.message : "Your chat identity could not load.");
      }
    }
    void identify();
    return () => {
      cancelled = true;
    };
  }, [room, loginHref, bootstrap]);

  useEffect(() => {
    if (serverSession) return;
    let previous: string | null | undefined = accountId;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      if (previous !== undefined && previous !== id) {
        // Clear private state immediately before re-identifying this browser.
        clearSession();
        setMember(null);
        setDmTarget(null);
        setSignedIn(false);
        setGuestId("");
        setIdentityStatus("checking");
        setMessages([]);
        setReactions([]);
        window.location.reload();
      }
      previous = id;
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, room, serverSession, accountId, setMessages, setReactions, clearSession, setDmTarget]);

  useEffect(() => {
    if (inlineDm) return;
    let cancelled = false;
    const recovery = new ChatReadRecovery((message) => setConnectionIssue({ room, message }));
    setConnectionIssue(null);
    if (loadedRoom.current !== room) setLoading(true);
    const load = async () => {
      try {
        const version = messageVersion.current;
        const requestedAnchor = openingAnchor.current,
          requestedWindow = historyWindow.current;
        const response = await updates.read(
          `/api/chat/history?room=${room}&ids=${knownMessageIds.current}${requestedWindow ? `&range=${requestedWindow}` : requestedAnchor ? `&anchor=${requestedAnchor}` : ""}`,
        );
        const result = await response.json();
        if (cancelled) return;
        if (response.status === 401) {
          clearSession();
          setMessages([]);
          setReactions([]);
          window.location.replace(loginHref);
          return;
        }
        if (
          response.status === 403 ||
          (response.status === 503 && result.error === "chat_unavailable" && shortScoutRoom)
        ) {
          setAccessDenied(true);
          setMessages([]);
          setReactions([]);
          setLoading(false);
          return;
        }
        if (!response.ok) throw new Error("Chat history did not load. Please try again.");
        if (
          version !== messageVersion.current ||
          requestedAnchor !== openingAnchor.current ||
          requestedWindow !== historyWindow.current
        ) {
          updates.invalidate("history");
          return;
        }
        loadedRoom.current = room;
        setAccessDenied(false);
        // Do not drop pending local sends while a reconciliation is in flight.
        if (requestedWindow) {
          setHistoryPage({ hasMore: !!result.hasMore, hasNewer: !!result.hasNewer });
          // Only a deliberate tail return plus a current no-gap response releases a fixed window.
          if (resumeLive.current && pinnedToBottom.current && !result.hasNewer) {
            historyWindow.current = null;
            openingAnchor.current = null;
            resumeLive.current = false;
            updates.invalidate("history");
          }
        }
        setMessages((current) => reconcileRoomMessages(current, result.messages));
        setReactions(result.reactions);
        setLoading(false);
        recovery.success();
      } catch (e) {
        if (!cancelled) {
          recovery.failure(e);
          setLoading(false);
        }
      }
    };
    const stop = updates.watch(load, ["history"], true, 60000);
    const message = (event: Event) => {
      const payload = (event as CustomEvent).detail;
      if (payload.eventType === "DELETE")
        setMessages((current) => current.filter((m) => m.id !== payload.old.id));
      else if (payload.new.room_slug === room) {
        // Trust the realtime row; reload history only when no loaded message can supply its badges.
        setMessages((current) => {
          const range = historyWindow.current?.split(",").map(Number);
          const { message: incoming, needsProjection } = realtimeRoomMessage(current, payload.new);
          if (
            range &&
            !incoming.removed &&
            !current.some((row) => row.id === incoming.id) &&
            ((incoming.unread_seq ?? 0) < range[0] || (incoming.unread_seq ?? 0) > range[1])
          )
            return current;
          if (needsProjection) queueMicrotask(() => updates.invalidate("history"));
          return mergeRoomMessage(current, incoming);
        });
      }
    };
    const reaction = (event: Event) => {
      const payload = (event as CustomEvent).detail;
      if (payload.new?.message_id)
        setReactions((current) => mergeReaction(current, payload.new as PublicChatReaction));
    };
    window.addEventListener("chat-room-event", message);
    window.addEventListener("chat-reaction-event", reaction);
    return () => {
      cancelled = true;
      stop();
      window.removeEventListener("chat-room-event", message);
      window.removeEventListener("chat-reaction-event", reaction);
    };
  }, [updates, room, inlineDm, loginHref, setMessages, setReactions, clearSession, shortScoutRoom]);

  useEffect(() => {
    if (pane?.conversationId) return;
    let channel: RealtimeChannel | null = null;
    const presenceKey = guestId || `observer-${crypto.randomUUID()}`;

    channel = supabase.channel(`longboard-public-chat-presence-${room}`, {
      config: { presence: { key: presenceKey } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setPresenceReady(true);
        const presence = channel?.presenceState<{ guestId?: string }>() ?? {};
        setChatterCount(countChatters(presence));
        setOnlineMemberIds(
          new Set(
            Object.values(presence)
              .flat()
              .map((item) => item.guestId)
              .filter((id): id is string => typeof id === "string"),
          ),
        );
      })
      .subscribe(async (status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setPresenceReady(false);
          return;
        }
        if (status !== "SUBSCRIBED" || identityStatus !== "ready" || !guestId) return;
        await channel?.track({ guestId, onlineAt: new Date().toISOString() });
      });

    return () => {
      setPresenceReady(false);
      setChatterCount(0);
      setOnlineMemberIds(new Set());
      if (channel) void supabase.removeChannel(channel);
    };
  }, [guestId, identityStatus, supabase, room, pane?.conversationId]);

  useLayoutEffect(() => {
    const node = messagesRef.current;
    if (
      pane?.visible === false ||
      ((replyTarget || mobileNavOpen) && mobileReplies) ||
      searchOpen ||
      inlineDm ||
      !node ||
      loading ||
      identityStatus === "checking" ||
      (identityStatus === "name" && roomStatus?.isOpen !== false)
    )
      return;
    if (openingPending.current) return;
    return watchChatPaneLayout(node, () => {
      if (pinScrollTarget.current) {
        const jump = pinScrollTarget.current;
        const target = node.querySelector<HTMLElement>(`[id="chat-message-${jump.messageId}"]`);
        if (jump.request !== pinJumpRequest.current) pinScrollTarget.current = null;
        else if (target) {
          pinHighlightCleanup.current?.();
          pinHighlightCleanup.current = revealPinnedMessage(node, target, jump.trigger);
          scrollIntent.current = null;
          pinScrollTarget.current = null;
          pinnedToBottom.current = false;
        }
      }
      if (
        pane?.active !== false &&
        !openingMoved.current &&
        openingAnchor.current &&
        !openingCancelled.current
      ) {
        const target = node.querySelector<HTMLElement>(`[id="chat-message-${openingAnchor.current}"]`);
        if (target) {
          node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top;
          scrollIntent.current = null;
          openingMoved.current = true;
          initialScrollDone.current = true;
          pinnedToBottom.current = false;
          if (!openingChildPending.current) settleOpening();
          setRoomScrollVersion((v) => v + 1);
        }
      }
      if (pane?.active !== false && pageScroll.current) {
        const rows = node.querySelectorAll<HTMLElement>('article[id^="chat-message-"]');
        const target = pageScroll.current === "first" ? rows[0] : rows[rows.length - 1];
        if (target) {
          node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top;
          pageScroll.current = null;
          scrollIntent.current = null;
        }
      }
      if ((!initialScrollDone.current && !openingCancelled.current) || pinnedToBottom.current) {
        node.scrollTop = node.scrollHeight;
        scrollIntent.current = null;
        initialScrollDone.current = true;
        pinnedToBottom.current = true;
        if (!openingAnchor.current && !openingCancelled.current && pane?.active !== false) settleOpening();
        if (latestReadPending.current && pane?.active !== false) {
          latestReadConfirmed.current = latestReadPending.current;
          latestReadPending.current = 0;
          setRoomScrollVersion((v) => v + 1);
        }
        latestIntentCleanup.current?.();
      }
    });
  }, [
    messages,
    loading,
    identityStatus,
    roomStatus?.isOpen,
    searchOpen,
    replyTarget,
    mobileReplies,
    mobileNavOpen,
    inlineDm,
    openingReady,
    skippingLatest,
    pane?.visible,
    pane?.active,
    pinRevealRequest,
  ]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    },
    [],
  );

  const roomPaused = roomStatus?.isOpen === false;
  const pauseNotice = roomStatus?.notice || "Chat temporarily paused by Longboard.";

  const feedback = useMemo(() => {
    if (error) return error;
    // Only /summary reports success here; a room message confirms itself by appearing.
    if (sendState === "success") return "Message sent.";
    return body.length > COUNTER_THRESHOLD ? `${body.length} / ${MAX_MESSAGE_LENGTH}` : "";
  }, [body.length, error, sendState]);

  async function setRoomOpen(isOpen: boolean) {
    if (adminAction) return;
    if (
      !isOpen &&
      !window.confirm(`Pause ${roomLabel} now? History stays readable. The other room remains available.`)
    ) {
      return;
    }
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    setAdminState("loading");
    setAdminAction("room");
    setAdminFeedback(isOpen ? "Reopening chat…" : "Pausing chat…");
    try {
      const result = await invokeAdmin(room, { action: "set_room_open", isOpen, reason: adminReason });
      if (!result.room) throw new Error("The room state did not update.");
      setRoomStatus(result.room);
      if (isOpen) setAdminReason("");
      setAdminState("success");
      setAdminFeedback(
        isOpen ? "Chat reopened. New participation is enabled." : "Chat paused. History remains readable.",
      );
      setAdminAction(null);
      adminTimerRef.current = setTimeout(() => {
        setAdminState("default");
        setAdminFeedback("");
      }, 2400);
    } catch (caught) {
      setAdminFeedback(caught instanceof Error ? caught.message : "The room state did not update.");
      setAdminState("error");
      setAdminAction(null);
    }
  }

  async function summarizeNow() {
    if (adminAction) return;
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    setAdminState("loading");
    setAdminAction("summary");
    setAdminFeedback("Creating a private summary…");
    try {
      const result = await invokeAdmin(room, { action: "summarize_now" });
      const refreshed = await invokeAdmin(room);
      setSummaries(refreshed.summaries ?? (result.result?.summary ? [result.result.summary] : summaries));
      setAdminState("success");
      setAdminFeedback(
        result.result?.status === "no_messages"
          ? "There are no messages to summarize for today."
          : "Today’s private summary is ready.",
      );
      setAdminAction(null);
      adminTimerRef.current = setTimeout(() => {
        setAdminState("default");
        setAdminFeedback("");
      }, 2400);
    } catch (caught) {
      setAdminFeedback(caught instanceof Error ? caught.message : "Buddy could not create the summary.");
      setAdminState("error");
      setAdminAction(null);
    }
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nameState === "loading") return;
    if (roomPaused) {
      setError(pauseNotice);
      return;
    }

    const nextName = nameDraft.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (nextName.length < 2 || nextName.length > 28) {
      setError("Use a name between 2 and 28 characters.");
      setNameState("error");
      return;
    }

    const token = window.localStorage.getItem(GUEST_TOKEN_KEY) || crypto.randomUUID();
    setNameState("loading");
    setError("");
    try {
      if (signedIn) {
        const response = await fetch("/api/chat/member", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: nextName, token }),
        });
        const result = await response.json();
        if (!response.ok || !result.member) throw new Error(result.error || "Your name could not be linked.");
        const linked = result.member as ChatMember;
        setMember(linked);
        setGuestId(linked.id);
        setDisplayName(linked.display_name);
        setNameDraft(linked.display_name);
        window.localStorage.removeItem(GUEST_TOKEN_KEY);
        window.localStorage.setItem(GUEST_NAME_KEY, linked.display_name);
        setNameState("success");
        setIdentityStatus("ready");
        return;
      }
      const result = await invokeGuest({ room, action: "register", token, displayName: nextName });
      if (!result.guestId || !result.displayName) throw new Error("Your chat name was not saved.");
      window.localStorage.setItem(GUEST_TOKEN_KEY, token);
      window.localStorage.setItem(GUEST_NAME_KEY, result.displayName);
      setGuestId(result.guestId);
      setDisplayName(result.displayName);
      setNameDraft(result.displayName);
      setNameState("success");
      setIdentityStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your chat name was not saved.");
      setNameState("error");
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guestId || sendState === "loading" || uploads.blocked) return;
    if (roomPaused) {
      setError(pauseNotice);
      return;
    }

    const nextBody = body.trim();
    if (!nextBody && !uploads.ids.length) {
      setError("Write a message before sending it.");
      setSendState("error");
      return;
    }

    const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (!token && !member) {
      setIdentityStatus("name");
      return;
    }

    const summary = parseSummaryCommand(nextBody, room);
    if (summary) {
      if (uploads.files.length) {
        setError("Remove attachments before requesting a summary.");
        return;
      }
      if ("error" in summary) {
        setError(summary.error);
        return;
      }
      setSendState("loading");
      setError("");
      if (summaryRetry.current?.room !== summary.room)
        summaryRetry.current = { room: summary.room, id: crypto.randomUUID() };
      try {
        const response = await fetch("/api/chat/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: summary.room, clientId: summaryRetry.current.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Summary unavailable.");
        summaryRetry.current = null;
        setBody("");
        setSendState("success");
        window.dispatchEvent(new Event("chat-summary-delivered"));
        timerRef.current = setTimeout(() => setSendState("default"), 1400);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Summary unavailable.");
        setSendState("error");
      }
      return;
    }

    const sendKey = JSON.stringify([room, nextBody, uploads.ids]);
    if (messageRetry.current?.key !== sendKey)
      messageRetry.current = { key: sendKey, id: crypto.randomUUID() };
    const clientId = messageRetry.current.id;
    const optimisticId = `pending-${crypto.randomUUID()}`;
    const optimistic: PublicChatMessage = {
      id: optimisticId,
      guest_id: guestId,
      member_id: member?.id ?? null,
      author_label: displayName,
      body: nextBody,
      created_at: new Date().toISOString(),
      pending: true,
    };
    const mobileSend = beginMobileSend(event.currentTarget.querySelector("textarea"), messagesRef.current);
    if (historyWindow.current) {
      sendReadHold.current = true;
      readIntentThrough.current = 0;
    }
    pinnedToBottom.current = true;
    setMessages((current) => [...current, optimistic]);
    setBody("");

    setError("");
    setSendState("loading");

    try {
      const result = await invokeGuest({
        room,
        action: "send",
        token,
        body: nextBody,
        attachmentIds: uploads.ids,
        clientId,
      });
      const sent = typeof result.message === "object" ? result.message : null;
      if (!sent?.id) throw new Error("That message was not sent.");
      setMessages((current) =>
        mergeRoomMessage(
          current.filter((message) => message.id !== optimisticId),
          sent,
        ),
      );
      uploads.clear();
      messageRetry.current = null;
      if (historyWindow.current) void refreshSentWindow();
      mobileSend.confirmed();
      setSendState("default");
    } catch (caught) {
      mobileSend.cancel();
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      const reason = caught instanceof Error ? caught.message : "That message was not sent.";
      // The composer stays editable while sending, so never overwrite a newer draft.
      const newer = bodyRef.current.trim();
      if (newer) {
        setBody(`${nextBody}\n${bodyRef.current}`);
        setError(`${reason} Your unsent message was put back above your new text.`);
      } else {
        setBody(nextBody);
        setError(reason);
      }
      setSendState("error");
    }
  }

  function openPopout() {
    setPopoutState("loading");
    const opened = openChatPopout(room);
    if (!opened) {
      setError("Your browser blocked the chat window. Allow popups and try again.");
      setPopoutState("error");
      return;
    }
    setPopoutState("success");
    timerRef.current = setTimeout(() => setPopoutState("default"), 1400);
  }

  return (
    <main
      ref={mobilePage}
      className={`${styles.page} ${fontVariableClass}`}
      data-pane={!!pane}
      data-popout={popout}
      data-theme={theme}
      data-room={shortScoutRoom ? "shortscout" : room}
    >
      <div
        className={styles.shell}
        data-reply-open={!!replyTarget && !inlineDm}
        data-nav-open={mobileNavOpen}
        data-dm-open={inlineDm}
      >
        {!pane && (
          <nav
            ref={navRef}
            id="chat-room-navigation"
            className={styles.roomTabs}
            aria-label="Chat rooms"
            inert={mobileReplies && (!mobileNavOpen || (!!replyTarget && !inlineDm))}
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
                  } else
                    window.dispatchEvent(new CustomEvent("chat-open-dm", { detail: pin.conversationId }));
                }}
              />
            )}
            <div className={styles.navHeading}>YOUR COMMUNITIES</div>
            <div className={styles.navPresence} aria-live="polite">
              <strong>{roomLabel}</strong>
              <span
                className={styles.onlineCount}
                data-live={presenceReady && !roomPaused}
                data-paused={roomPaused || undefined}
              >
                <i aria-hidden="true" />
                {roomPaused
                  ? "Paused"
                  : gainers
                    ? "Live Gainers alerts"
                    : announcement
                      ? "Admin posts only"
                      : presenceReady
                        ? `${chatterCount} online`
                        : "Connecting…"}
              </span>
            </div>
            {featureChannel && <Link href="/chat/features">FEATURES 🔒</Link>}
            {CHAT_ROOMS.filter(
              (option) => !isAnnouncementRoom(option.slug) || allowedRooms.includes(option.slug),
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
                >
                  {option.slug === "social" ? (
                    <span className={styles.socialRoomLabel}>
                      {option.label} <small>(LB + SS)</small>
                    </span>
                  ) : (
                    option.label
                  )}{" "}
                  🔒
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
                    if (sendState === "loading" || adminAction) {
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
                >
                  {option.slug === "social" ? (
                    <span className={styles.socialRoomLabel}>
                      {option.label} <small>(LB + SS)</small>
                    </span>
                  ) : (
                    option.label
                  )}
                  {(activity.data.roomMessageCounts?.[option.slug] ?? 0) > 0 && (
                    <span
                      className={styles.activityBadge}
                      aria-label={`${activity.data.roomMessageCounts?.[option.slug]} unread messages`}
                    >
                      {activity.data.roomMessageCounts?.[option.slug]}
                    </span>
                  )}
                </Link>
              ),
            )}
            <button
              type="button"
              className={styles.searchTab}
              aria-pressed={searchOpen}
              onClick={() => {
                setRoomSelection((value) => value + 1);
                setDmTarget(null);
                setSearchOpen((open) => !open);
                setMobileNavOpen(false);
              }}
            >
              ⌕ Search
            </button>
            <span>
              {gainers
                ? "Gainers · Broadcast only"
                : recordings
                  ? "Recordings · Admin posts only"
                  : announcement
                    ? "Announcements · Admin posts only"
                    : room === "shortscout"
                      ? "Short selling"
                      : room === "social"
                        ? "Movies, life & everything else"
                        : "Trading & the markets"}
            </span>
            <div ref={setMobileActionsHost} className={styles.mobileNavActions} />
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
        )}
        <section
          className={styles.chat}
          inert={mobileReplies && ((!!replyTarget && !inlineDm) || mobileNavOpen)}
          aria-label={gainers ? "Gainers alerts" : shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"}
        >
          {!pane && (
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
                    <div className={styles.communityTitle}>
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
                        title={
                          gainers ? "Gainers alerts" : shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"
                        }
                      >
                        {gainers ? "G" : shortScoutRoom ? "SS" : "LB"}
                        <span aria-hidden="true">{gainers ? "↗" : shortScoutRoom ? "↘" : "🌴"}</span>
                      </span>
                    )}
                    <div className={`${styles.communityTitle} ${styles.roomHeaderTitle}`}>
                      <h1
                        title={
                          announcement || gainers
                            ? roomLabel
                            : room === "shortscout"
                              ? "ShortScout"
                              : room === "social"
                                ? "Social"
                                : "Longboard"
                        }
                      >
                        {announcement || gainers
                          ? roomLabel
                          : room === "shortscout"
                            ? "ShortScout"
                            : room === "social"
                              ? "Social"
                              : "Longboard"}
                      </h1>
                      {
                        <span
                          className={styles.onlineCount}
                          data-live={presenceReady && !roomPaused}
                          data-paused={roomPaused || undefined}
                          aria-live="polite"
                        >
                          <i aria-hidden="true" />
                          {roomPaused
                            ? "Paused"
                            : gainers
                              ? "Live Gainers alerts"
                              : announcement
                                ? "Admin posts only"
                                : presenceReady
                                  ? `${chatterCount} online`
                                  : "Connecting…"}
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
                  ⌕ <span>Search chat</span>
                </button>
                {member && (
                  <ChatActivityBell data={activity.data} error={activity.error} read={activity.read} />
                )}
                {featureChannel && (
                  <FeatureNotifications
                    showLabel
                    portalHost={mobileReplies || inlineDm ? mobileActionsHost : null}
                  />
                )}

                <ChatHeaderMenu>
                  {(close) => (
                    <>
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
                      <Link className={styles.menuItem} href="/chat/quad">
                        Quad view
                      </Link>
                      <button
                        type="button"
                        className={styles.menuItem}
                        onClick={() => {
                          close();
                          window.dispatchEvent(new Event("chat-refresh-app"));
                        }}
                      >
                        Refresh app
                      </button>
                      <button
                        type="button"
                        className={styles.menuItem}
                        onClick={() => {
                          close();
                          window.dispatchEvent(new Event("chat-open-install-guide"));
                        }}
                      >
                        Install on phone
                      </button>
                      {accountId && member && (
                        <button
                          type="button"
                          className={styles.menuItem}
                          onClick={() => {
                            close();
                            window.dispatchEvent(new Event("chat-open-profile-settings"));
                          }}
                        >
                          Profile settings
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
                          Phone notifications
                        </button>
                      )}
                      {inlineDm && (
                        <button
                          type="button"
                          className={styles.menuItem}
                          onClick={() => {
                            close();
                            setMobileNavOpen(mobileReplies);
                            requestAnimationFrame(() => {
                              const details =
                                dmSidebarHost?.querySelector<HTMLDetailsElement>("[data-dm-settings]") ??
                                dmSidebarHost?.querySelector<HTMLDetailsElement>("details");
                              if (details) {
                                details.open = true;
                                details.querySelector<HTMLElement>("summary")?.focus();
                              }
                            });
                          }}
                        >
                          DM settings
                        </button>
                      )}
                      <div className={styles.menuIdentity}>
                        <span>{signedIn ? "Signed in" : "Guest chat"}</span>
                        <strong>{displayName || "Welcome to Longboard"}</strong>
                      </div>
                      {!signedIn ? (
                        <Link className={styles.menuItem} href={loginHref}>
                          Sign in for private messages <span aria-hidden="true">↗</span>
                        </Link>
                      ) : !member ? (
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
                          Connect ShortScout →
                        </a>
                      ) : null}
                      {serverSession ? (
                        <button
                          className={styles.menuItem}
                          onClick={async () => {
                            try {
                              if (accountId) await disableCurrentChatPush(accountId);
                            } catch {
                              setError(
                                "Could not turn off this device's notifications. Please try signing out again.",
                              );
                              return;
                            }
                            const response = await fetch("/api/chat/login/logout", { method: "POST" });
                            if (response.ok) window.location.replace(loginHref);
                            else setError("Could not sign out. Please try again.");
                          }}
                        >
                          Sign out of chat
                        </button>
                      ) : null}
                      <div className={styles.menuSectionLabel}>Appearance</div>
                      <div role="group" aria-label="Chat theme">
                        {CHAT_THEMES.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={styles.menuItem}
                            aria-pressed={theme === option.value}
                            onClick={() => setTheme(option.value)}
                          >
                            <span>
                              <span aria-hidden="true">{option.icon}</span> {option.label}
                            </span>
                            <span aria-hidden="true">{theme === option.value ? "✓" : ""}</span>
                          </button>
                        ))}
                      </div>
                      <div className={styles.menuDivider} />
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
                          Admin controls <span aria-hidden="true">{adminOpen ? "−" : "+"}</span>
                        </button>
                      ) : null}
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
                          {gainers ? "Pop out Gainers" : "Pop out chat"} <span aria-hidden="true">↗</span>
                        </button>
                      ) : (
                        <Link className={styles.menuItem} href={`/chat?room=${room}`}>
                          {gainers ? "Return to Gainers" : "Open full page"} <span aria-hidden="true">↗</span>
                        </Link>
                      )}
                    </>
                  )}
                </ChatHeaderMenu>
              </div>
            </header>
          )}

          {isOwner && adminOpen && !inlineDm ? (
            <aside
              id="longboard-chat-admin-panel"
              className={styles.adminPanel}
              aria-label="Longboard Chat owner controls"
              aria-busy={Boolean(adminAction)}
            >
              <div className={styles.adminHeading}>
                <div>
                  <span>{roomLabel.toUpperCase()} · OWNER CONTROL</span>
                  <strong>{roomPaused ? "ROOM PAUSED" : "ROOM OPEN"}</strong>
                </div>
                <button
                  className={styles.adminClose}
                  type="button"
                  aria-label="Close owner controls"
                  onClick={() => setAdminOpen(false)}
                >
                  ×
                </button>
              </div>
              <p className={styles.adminCopy}>
                Only your authenticated Longboard account can use these controls. Pausing this room keeps its
                history readable and stops messages and reactions here.
              </p>
              {!roomPaused ? (
                <label className={styles.adminReason}>
                  <span>Optional public notice</span>
                  <input
                    value={adminReason}
                    maxLength={240}
                    placeholder="Chat temporarily paused by Longboard."
                    onChange={(event) => setAdminReason(event.target.value)}
                  />
                </label>
              ) : null}
              <div className={styles.adminActions}>
                <button
                  className={roomPaused ? styles.reopenButton : styles.pauseButton}
                  type="button"
                  disabled={Boolean(adminAction)}
                  onClick={() => void setRoomOpen(roomPaused)}
                >
                  {adminAction === "room" ? "WORKING…" : roomPaused ? "REOPEN CHAT" : "PAUSE CHAT"}
                </button>
                <button
                  className={styles.summaryButton}
                  type="button"
                  disabled={Boolean(adminAction)}
                  onClick={() => void summarizeNow()}
                >
                  {adminAction === "summary" ? "SUMMARIZING…" : "SUMMARIZE NOW"}
                </button>
              </div>
              <p className={styles.adminFeedback} data-state={adminState} aria-live="polite">
                {adminFeedback}
              </p>
              <ChatReportReview />
              <div className={styles.summaryList}>
                <span>PRIVATE DAILY SUMMARIES</span>
                {summaries.length ? (
                  summaries.slice(0, 3).map((summary) => (
                    <details key={summary.id}>
                      <summary>
                        {summary.summary_date} · {summary.message_count} messages
                      </summary>
                      <p>{summary.summary_text}</p>
                    </details>
                  ))
                ) : (
                  <p>No summaries yet.</p>
                )}
              </div>
            </aside>
          ) : null}

          <div ref={setDmConversationHost} className={styles.dmConversationHost} hidden={!inlineDm} />
          <div className={styles.searchPane} hidden={!searchOpen || inlineDm}>
            {(searchVisited || (searchOpen && !inlineDm)) && (
              <ChatSearch
                key={JSON.stringify([accountId, member?.id, room, allowedRooms])}
                room={room}
                allowedRooms={allowedRooms}
              />
            )}
          </div>
          {!pane?.conversationId && (
            <div className={styles.roomPane} hidden={searchOpen || inlineDm}>
              {roomDenied ? (
                <div className={styles.loading} role="status">
                  Access to this room could not be verified. Your draft is saved. Choose another room or try
                  again shortly.
                </div>
              ) : identityStatus === "checking" ? (
                <div className={styles.loading}>
                  {identityError || "Opening the room…"}
                  {identityError ? (
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => window.location.reload()}
                    >
                      Refresh
                    </button>
                  ) : null}
                </div>
              ) : identityStatus === "name" && !roomPaused ? (
                <div className={styles.gate}>
                  <form className={styles.gateForm} onSubmit={saveName}>
                    <h1 className={styles.gateTitle}>
                      {signedIn ? "Your member name." : "Pick a name."} <span>Join the room.</span>
                    </h1>
                    <p className={styles.gateCopy}>
                      {signedIn
                        ? "Link this name to your account to chat and receive private message requests across devices."
                        : "No account or login required for public chat. Sign in to send and receive private messages."}
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
                      {nameState === "loading" ? "JOINING…" : signedIn ? "LINK NAME & JOIN" : "JOIN CHAT"}
                    </button>
                    <p className={styles.feedback} data-error={Boolean(error)} aria-live="polite">
                      {error}
                    </p>
                  </form>
                </div>
              ) : (
                <>
                  <RoomMessagePins
                    key={JSON.stringify([accountId, member?.id, room])}
                    collapsible={!!pane}
                    pins={roomPins.pins}
                    controls={pinControls}
                    onOpen={(pin, trigger) => void openPinnedMessage(pin, trigger)}
                    error={roomPins.error || pinJumpError}
                  />
                  <div
                    ref={messagesRef}
                    onWheel={(event) => {
                      cancelOpening();
                      scrollIntent.current = chatPaneScrollIntent(event.currentTarget);
                    }}
                    onTouchStart={(event) => {
                      if (chatScrollPointer(event.target, true)) {
                        cancelOpening();
                        scrollIntent.current = chatPaneScrollIntent(event.currentTarget, "touch");
                      }
                    }}
                    onPointerDown={(event) => {
                      if (chatScrollPointer(event.target))
                        scrollIntent.current = chatPaneScrollIntent(event.currentTarget, "pointer");
                    }}
                    onKeyDown={(event) => {
                      if (chatScrollKey(event.key, event.target)) {
                        cancelOpening();
                        scrollIntent.current = chatPaneScrollIntent(event.currentTarget);
                      }
                    }}
                    onScroll={(event) => {
                      const node = event.currentTarget;
                      if (searchOpen || pane?.visible === false || !chatPaneVisible(node)) return;
                      const next = chatPaneFollowingScroll(
                        node,
                        pinnedToBottom.current,
                        scrollIntent.current,
                      );
                      if (pinnedToBottom.current !== next.following)
                        awaySeq.current = next.following ? Infinity : maxSeq;
                      pinnedToBottom.current = next.following;
                      farFromBottom.current =
                        node.scrollHeight - node.scrollTop - node.clientHeight > node.clientHeight * 1.5;
                      scrollIntent.current = next.intent;
                      if (next.direction) {
                        readIntent(event.target);
                        resumeLive.current = next.direction === "down" && next.following;
                        if (resumeLive.current && historyWindow.current) updates.invalidate("history");
                      }
                      // Re-render only when an input of the read marker changes, not on every scroll frame.
                      const signature = `${pinnedToBottom.current}:${chatPaneAtBottom(node)}:${farFromBottom.current}:${openingCancelled.current}:${openingMoved.current}`;
                      if (scrollSignature.current !== signature) {
                        scrollSignature.current = signature;
                        setRoomScrollVersion((value) => value + 1);
                      }
                    }}
                    className={styles.messages}
                    data-positioning={(!openingReady && !!member && identityStatus === "ready") || undefined}
                    role="log"
                    aria-label={`${roomLabel} messages`}
                    aria-busy={loading || paging || skippingLatest}
                  >
                    {roomPaused ? (
                      <div className={styles.pauseBanner} role="status">
                        <strong>CHAT PAUSED · HISTORY IS READ ONLY</strong>
                        <span>
                          {gainers
                            ? "Gainers alerts appear here automatically. This channel is read-only."
                            : recordings
                              ? "Only admins can post recordings. You can react, but replies are disabled."
                              : readOnlyAnnouncement
                                ? "Only admins can post in this announcement channel. New announcements appear in your notification bell."
                                : pauseNotice}
                        </span>
                      </div>
                    ) : null}
                    {!loading && historyPage.hasMore && (
                      <button type="button" disabled={paging} onClick={() => void pageHistory("before")}>
                        Earlier messages
                      </button>
                    )}
                    {loading ? (
                      <div className={styles.loading}>Loading the room…</div>
                    ) : messages.length === 0 ? (
                      <div className={styles.empty}>
                        <strong>
                          {historyWindow.current ? "No messages remain on this page." : "No messages yet."}
                        </strong>
                        <button
                          type="button"
                          className={styles.searchTab}
                          aria-pressed={searchOpen}
                          onClick={() => {
                            setRoomSelection((value) => value + 1);
                            setDmTarget(null);
                            setSearchOpen((open) => !open);
                            setMobileNavOpen(false);
                          }}
                        >
                          ⌕ Search
                        </button>
                        <span>
                          {gainers
                            ? "New Gainers alerts will appear here."
                            : recordings
                              ? "New recordings will appear here."
                              : announcement
                                ? "New announcements will appear here."
                                : room === "social"
                                  ? "Seen a good movie lately? Start the conversation."
                                  : `Start the ${roomLabel} conversation below.`}
                        </span>
                      </div>
                    ) : (
                      <>
                        {messages.map((message) => (
                          <RoomMessageRow
                            pinControls={pinControls}
                            key={message.id}
                            message={message}
                            room={room}
                            memberId={member?.id}
                            selfMember={member ?? undefined}
                            guestId={guestId}
                            themeReady={themeReady}
                            isAdmin={isAdmin}
                            roomPaused={roomPaused}
                            readOnlyAnnouncement={readOnlyAnnouncement}
                            unreadStart={unreadStart === message.id}
                            replyCount={replyCounts[message.id] ?? 0}
                            replyOpen={replyTarget === message.id}
                            reactionsActive={
                              !inlineDm && (!mobileReplies || (!replyTarget && !mobileNavOpen))
                            }
                            mentionNames={mentionNames}
                            onPrivateMessage={openPrivateMessage}
                            onReply={openMessageReplies}
                            onEdited={editMessage}
                            onDeleted={deleteMessage}
                          />
                        ))}
                      </>
                    )}
                    {historyPage.hasNewer && (
                      <button type="button" disabled={paging} onClick={() => void pageHistory("after")}>
                        Newer messages
                      </button>
                    )}
                  </div>
                  {(() => {
                    if (loading || !openingReady || searchOpen || inlineDm) return null;
                    const node = messagesRef.current;
                    const jump = jumpToLatestState({
                      messages,
                      awaySeq: awaySeq.current,
                      memberId: member?.id,
                      following: pinnedToBottom.current,
                      atBottom: !node || chatPaneAtBottom(node),
                      farFromBottom: farFromBottom.current,
                      hasNewer: historyPage.hasNewer,
                    });
                    return jump ? (
                      <div className={styles.jumpDock}>
                        <button
                          type="button"
                          className={styles.jumpPill}
                          disabled={skippingLatest}
                          onClick={jumpToLatest}
                        >
                          {jump.label} <span aria-hidden="true">↓</span>
                        </button>
                      </div>
                    ) : null;
                  })()}
                  {sentWindowRetry && (
                    <button type="button" onClick={() => void refreshSentWindow(true)}>
                      Show sent message
                    </button>
                  )}
                  {connectionError && (
                    <p className={styles.feedback} data-chat-connection data-error="true" role="status">
                      {connectionError}
                    </p>
                  )}
                  {identityStatus === "ready" && !roomPaused && !readOnlyAnnouncement ? (
                    <form className={styles.composerWrap} onSubmit={sendMessage}>
                      <AttachmentPicker uploads={uploads} disabled={sendState === "loading"} />
                      <div className={styles.composerRow}>
                        <MentionTextarea
                          inputRef={composerRef}
                          data-chat-composer
                          onPaste={uploads.paste}
                          enabled={Boolean(member)}
                          buddyEnabled={room === "main"}
                          className={styles.composer}
                          value={body}
                          maxLength={MAX_MESSAGE_LENGTH}
                          rows={2}
                          aria-label={`Message ${roomLabel}`}
                          aria-describedby={pane ? `feedback-${room}` : "longboard-chat-feedback"}
                          aria-invalid={sendState === "error"}
                          placeholder={`Write as ${displayName}…${room === "main" ? " Try @Buddy for a reply." : " What’s on your mind?"}`}
                          onValue={(value) => {
                            setBody(value);
                            setError("");
                            if (sendState === "error") setSendState("default");
                          }}
                        />
                        <div className={styles.composerActions}>
                          <VoiceRecorder key={room} uploads={uploads} disabled={sendState === "loading"} />
                          <GifComposer
                            onAttach={() => uploads.input.current?.click()}
                            disabled={sendState === "loading"}
                            onAdd={(url) => {
                              const next = [body.trim(), url].filter(Boolean).join("\n");
                              if (next.length > MAX_MESSAGE_LENGTH) return false;
                              setBody(next);
                              setError("");
                              return true;
                            }}
                          />
                          <button
                            className={styles.primaryButton}
                            type="submit"
                            disabled={sendState === "loading" || uploads.blocked}
                            data-state={sendState}
                          >
                            {sendState === "loading"
                              ? "SENDING…"
                              : sendState === "success"
                                ? "SENT ✓"
                                : "SEND"}
                          </button>
                        </div>
                      </div>
                      <ComposerLinkPreview body={body} />
                      <p
                        id={pane ? `feedback-${room}` : "longboard-chat-feedback"}
                        className={styles.feedback}
                        data-error={Boolean(error)}
                        aria-live="polite"
                      >
                        {feedback}
                        {!pane && (
                          <>
                            {feedback ? " · " : ""}Enter to send · Shift+Enter for a new line.{" "}
                            {recordings
                              ? "Recordings alert members of this community. Replies are disabled."
                              : announcement
                                ? "Announcements alert members of this community."
                                : room === "shortscout"
                                  ? "Use /summary for a private room recap. Messages are saved and visible to verified ShortScout members and chat admins."
                                  : "Use /summary for a private room recap. Messages are saved, searchable by members, and may be processed for AI search and private summaries."}{" "}
                            {room === "main" ? "Buddy replies only to @Buddy." : ""}
                          </>
                        )}
                      </p>
                    </form>
                  ) : !gainers ? (
                    <div className={styles.readOnlyFooter}>
                      <strong>
                        {readOnlyAnnouncement && !roomPaused ? "ADMIN POSTS ONLY" : "READ-ONLY MODE"}
                      </strong>
                      <span>
                        {recordings && !roomPaused
                          ? "You can react to recordings. Only admins can post. Replies are disabled."
                          : readOnlyAnnouncement && !roomPaused
                            ? "You can react to announcements. Only admins can post. New announcements appear in your notification bell."
                            : pauseNotice}
                      </span>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </section>
        {!roomDenied && !recordings && replyTarget && !inlineDm && (
          <ChatReplyPanel
            openingUnread={unreadThread?.parentId === replyTarget ? unreadThread : undefined}
            onUnreadVisible={(through) => {
              visibleReplyReadThrough.current = through;
              openingMoved.current = true;
              openingChildPending.current = false;
              settleOpening();
              setRoomScrollVersion((v) => v + 1);
            }}
            onSkipLatest={() => void skipLatest()}
            pinJump={pinReplyJump?.messageId === replyTarget ? pinReplyJump : undefined}
            pinControls={pinControls}
            notificationActive={
              pane?.visible !== false && pane?.active !== false && !searchOpen && !mobileNavOpen
            }
            isolated={!!pane}
            key={`${member?.id ?? "anonymous"}:${room}:${replyTarget}`}
            messageId={replyTarget}
            memberId={member?.id}
            selfMember={member ?? undefined}
            room={room}
            paused={roomPaused}
            readOnly={readOnlyAnnouncement}
            depth={replyDepth}
            onBack={backReplies}
            onOpen={openReplies}
            draft={
              replyDrafts.current[`${member?.id ?? "anonymous"}:${room}:${replyTarget}`] ??
              (replyDrafts.current[`${member?.id ?? "anonymous"}:${room}:${replyTarget}`] = {
                body: "",
                scroll: 0,
              })
            }
            onClose={closeReplies}
            onSent={(message) => setMessages((current) => mergeRoomMessage(current, message))}
          />
        )}
      </div>
    </main>
  );
}

export default function PublicChat(props: PublicChatProps) {
  const sharedUpdates = useChatUpdates();
  const sharedIdentity = useChatIdentity();
  const navigationOwner = useId();
  const dmSkipLatest = useRef<(() => void) | null>(null);
  const [cache] = useState(() => new ChatRoomCache(props.accountId ?? ""));
  const [selection, setSelection] = useState<{
    room: ChatRoom;
    snapshot: RoomSnapshot | null;
    initial: boolean;
  }>({ room: props.room, snapshot: null, initial: true });
  const [storedMember, setStoredMember] = useState(props.bootstrap?.member ?? null);
  const member =
    sharedIdentity &&
    sharedIdentity.accountId === props.accountId &&
    sharedIdentity.member &&
    sharedIdentity.member.id === storedMember?.id
      ? newerChatMember(storedMember, sharedIdentity.member)
      : storedMember;
  const setMember = useCallback(
    (next: ChatMember | null) => {
      setStoredMember((previous) => (next ? newerChatMember(previous, next) : null));
      if (next) cache.renameMember(next);
    },
    [cache],
  );
  const [dmView, setDmView] = useState<string | null>(props.pane?.conversationId ? "Direct messages" : null),
    [dmTarget, setDmTarget] = useState<{ id: string; name: string } | null>(null);
  const [roomSelection, setRoomSelection] = useState(0),
    [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dmSidebarHost, setDmSidebarHost] = useState<HTMLDivElement | null>(null),
    [dmConversationHost, setDmConversationHost] = useState<HTMLDivElement | null>(null);
  const navTrigger = useRef<HTMLButtonElement>(null);
  const room = selection.room;
  const [currentRooms, setCurrentRooms] = useState(props.allowedRooms);
  const roomsUpdated = useCallback(
    (rooms: ChatRoom[]) =>
      setCurrentRooms((previous) => (previous?.join() === rooms.join() ? previous : rooms)),
    [],
  );
  const revoked = useRef(false);
  const save = useCallback(
    (snapshot: RoomSnapshot) => {
      if (!revoked.current) cache.set(snapshot.bootstrap.room, snapshot);
    },
    [cache],
  );
  const clearSession = useCallback(() => {
    revoked.current = true;
    cache.clear();
    try {
      clearChatDrafts(window.sessionStorage);
    } catch {}
    setMember(null);
    setDmTarget(null);
    setDmView(null);
  }, [cache, setMember]);
  const select = useCallback(
    (next: ChatRoom) => {
      setSelection({ room: next, snapshot: cache.get(next), initial: false });
      setRoomSelection((v) => v + 1);
      setDmTarget(null);
      setDmView(null);
      setMobileNavOpen(false);
    },
    [cache],
  );
  useEffect(() => {
    if (props.pane) return;
    const restore = () => {
      const next = parseChatRoom(new URL(window.location.href).searchParams.get("room"));
      if (next && currentRooms?.includes(next) && next !== room) select(next);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [room, currentRooms, select, props.pane]);
  const previousRoom = useRef(props.room);
  useEffect(() => {
    if (previousRoom.current !== props.room) {
      previousRoom.current = props.room;
      select(props.room);
    }
  }, [props.room, select]);
  useEffect(() => () => cache.clear(), [cache]);
  const navigate = (next: ChatRoom) => {
    window.history.pushState(
      { ...window.history.state, chatReply: undefined },
      "",
      `/chat?room=${next}${props.popout ? "&popout=1" : ""}`,
    );
    select(next);
  };
  const onDmViewChange = useCallback((name: string | null) => {
    setDmView(name);
    if (name) setMobileNavOpen(false);
  }, []);
  const onTargetClosed = useCallback(() => setDmTarget(null), []);
  const bridge = {
    navigationOwner,
    dmSkipLatest,
    dmView,
    setDmView,
    roomSelection,
    setRoomSelection,
    dmTarget,
    setDmTarget,
    dmSidebarHost,
    setDmSidebarHost,
    dmConversationHost,
    setDmConversationHost,
    navTrigger,
    setMember,
    mobileNavOpen,
    setMobileNavOpen,
  };
  const bootstrap = selection.snapshot
    ? { ...selection.snapshot.bootstrap, member }
    : selection.initial && props.bootstrap?.room === room
      ? { ...props.bootstrap, member }
      : props.bootstrap
        ? { ...props.bootstrap, member, room, messages: [], reactions: [], counts: {} }
        : undefined;
  const realtime =
    !props.serverSession &&
    (props.realtimeRooms?.includes(room) ?? (room === props.room && !!props.roomRealtime));
  const contents = (
    <ChatSessionContext.Provider value={bridge}>
      <AttachmentMetadataProvider owner={revoked.current ? "" : (props.accountId ?? "")}>
        <MessageReactionProvider>
          <ChatActivityProvider memberId={member?.id}>
            {!props.pane && (
              <>
                {props.accountId && member && (
                  <ChatProfileSettings accountId={props.accountId} member={member} />
                )}
                <ChatInstallGuide signedIn={!!props.accountId} />
                <ChatAppControls version={props.appVersion ?? "development"} />
                {props.accountId && <ChatPushSettings accountId={props.accountId} />}
              </>
            )}
            <PublicChatContent
              key={room}
              cold={!selection.initial && !selection.snapshot}
              {...props}
              room={room}
              bootstrap={bootstrap}
              snapshot={selection.snapshot}
              onSnapshot={save}
              onNavigate={navigate}
              onRoomsUpdated={roomsUpdated}
              clearSession={clearSession}
            />
            {member && (!props.pane || props.pane.conversationId) && (
              <DirectInbox
                notificationActive={props.pane?.active !== false}
                skipLatestRef={dmSkipLatest}
                controlledConversation={props.pane?.conversationId}
                key={member.id}
                member={member}
                target={dmTarget}
                onTargetClosed={onTargetClosed}
                fallbackFocus={navTrigger}
                sidebarHost={dmSidebarHost}
                conversationHost={dmConversationHost}
                conversationVisible={!mobileNavOpen && props.pane?.visible !== false}
                roomSelection={roomSelection}
                onViewChange={onDmViewChange}
              />
            )}
          </ChatActivityProvider>
        </MessageReactionProvider>
      </AttachmentMetadataProvider>
    </ChatSessionContext.Provider>
  );
  return sharedUpdates ? (
    contents
  ) : (
    <ChatUpdatesProvider
      accountId={props.accountId}
      onUnauthorized={clearSession}
      room={room}
      serverSession={!!props.serverSession}
      pollingRoom={!realtime}
    >
      {contents}
    </ChatUpdatesProvider>
  );
}
