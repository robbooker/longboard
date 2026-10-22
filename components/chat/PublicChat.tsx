"use client";
import {
  revealPinnedMessage,
  watchPinnedMessageIntent,
  type PinnedMessageJump,
} from "@/lib/chatPinnedMessageJump";
import { takeEarlyDraft } from "@/lib/chatEarlyDraft";
import { useChatScrollIntent } from "./hooks/useChatScrollIntent";
import {
  chatPaneVisible,
  chatPaneLaidOut,
  chatPaneAtBottom,
  chatPaneFollowingScroll,
  chatPaneScrollIntent,
  chatScrollPointer,
  chatScrollKey,
  type ChatScrollIntent,
  watchChatPaneLayout,
} from "@/lib/chatScrollFollow";
import { openChatPopout } from "@/lib/chatPopout";
import { beginMobileSend, watchChatViewport } from "@/lib/chatMobileSend";
import { waitForAttachments } from "@/lib/chatAttachmentWaits";
import { historyAutoload } from "@/lib/chatHistoryAutoload";
import { useChatScrollOwner } from "./hooks/useChatScrollOwner";
import { resetChatRowWindow, watchChatRowWindow } from "@/lib/chatRowWindow";
import { useMobileKeyboardDismiss } from "./hooks/useMobileKeyboardDismiss";
import { chatTimingSendShown, chatTimingSendStart, useChatTimings } from "./room/useChatTimings";
import RoomMessagePins from "./RoomMessagePins";
import { useRoomMessagePins } from "./hooks/useRoomMessagePins";
import type { RoomMessagePin } from "@/lib/chatRoomMessagePins";
import { ChatRoomCache, type RoomSnapshot } from "@/lib/chatRoomCache";
import {
  chatDeviceOwner,
  chatDeviceStore,
  clearChatDeviceStore,
  deviceRemoval,
  deviceRoomData,
  deviceSeen,
  type DeviceContents,
  type DeviceSeen,
  type DeviceRoom,
} from "@/lib/chatDeviceStore";
import { ChatSessionContext, useChatSession } from "./ChatSession";
import { knownMessagesParam } from "@/lib/chatKnownMessages";
import { reconcileRoomMessages } from "@/lib/chatMessageIdentity";
import { jumpToLatestState } from "@/lib/chatJumpToLatest";
import { flashChatMessage } from "@/lib/chatJumpHighlight";
import { useChatRefreshGuard } from "./hooks/useChatRefreshGuard";
import { clearChatDrafts } from "@/lib/chatRefreshDrafts";
import { isAnnouncementRoom } from "@/lib/publicChat";
import {
  CHAT_PHONE_QUERY,
  chatPhoneDeepLink,
  chatPhoneScreen,
  withChatPhoneScreen,
} from "@/lib/chatPhoneNav";
import { ChatUpdatesProvider, useChatUpdates, useChatAccess, useChatIdentity } from "./ChatUpdates";
import AttachmentMetadataProvider from "./AttachmentMetadata";

import type { ChatBootstrap } from "@/lib/chatBootstrapTypes";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { parseSummaryCommand } from "@/lib/chatSummaryCommand";
import {
  CHAT_ROOMS,
  parseChatRoom,
  mergeRoomMessage,
  type ChatRoom,
  type PublicChatMessage,
  type PublicChatReaction,
  type PublicChatRoomState,
} from "@/lib/publicChat";
import { createClient } from "@/lib/supabase/client";
import type { ChatTheme } from "@/lib/chatTheme";
import * as ReactModule from "react";
import {
  FormEvent,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  useId,
  useInsertionEffect,
} from "react";
import type { ReplyDraft } from "./ChatReplyPanel";
import dynamic from "next/dynamic";
import DirectInbox from "./DirectInbox";
import ChatAppControls from "./ChatAppControls";
import ChatProfileSettings from "./ChatProfileSettings";
import { newerChatMember } from "@/lib/chatMemberName";
import ChatPushSettings from "./ChatPushSettings";
import ChatInstallGuide from "./ChatInstallGuide";
import ChatPushPromptSheet from "./ChatPushPrompt";
import { useAttachments } from "./hooks/useAttachments";
import { ChatActivityProvider, useSharedChatActivity } from "./ChatActivityContext";
import { useVisibleChatNotifications } from "./hooks/useVisibleChatNotifications";
import { useReplyThreads } from "./hooks/useReplyCounts";
import { useReplyNavigation } from "./hooks/useReplyNavigation";
import styles from "./PublicChat.module.css";
import AdminPanel from "./room/AdminPanel";
import { useRoomAdmin } from "./room/useRoomAdmin";
import type { ActionState, IdentityStatus } from "./room/types";
import { useChatTheme } from "./room/useChatTheme";
import { useOffline } from "./room/useOffline";
import { useRoomPresence } from "./room/useRoomPresence";
import RoomQuickSwitcher, { publishDmList } from "./room/RoomQuickSwitcher";
import RoomNav from "./room/RoomNav";
import ChatHeader from "./room/ChatHeader";
import NameGate from "./room/NameGate";
import RoomMessageList from "./room/RoomMessageList";
import RoomComposer, { MAX_MESSAGE_LENGTH } from "./room/RoomComposer";
import PhoneInfoSheet from "./room/PhoneInfoSheet";
import { roomBadgeCounts } from "@/lib/chatRoomNotify";
import { useRoomHistory } from "./room/useRoomHistory";
import { isNetworkError, isOutboxRow, useRoomOutbox } from "./room/useRoomOutbox";
import { MessageReactionProvider } from "./MessageReactions";

// Secondary tools are downloaded only when their visible gate first renders.
/** A reply reached from search or a message link: its thread opens at it. */
type ThreadJump = { parentId: string; messageId: string; request: number };
const ChatSearch = dynamic(() => import("./ChatSearch"), {
  ssr: false,
  loading: () => (
    <p className={styles.loading} role="status">
      Loading search…
    </p>
  ),
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
const COUNTER_THRESHOLD = 500;
/** The server accepts one room message per member every 1.5s. */
const ROOM_SEND_SPACING = 1600;
type GuestResponse = {
  guestId?: string;
  displayName?: string;
  message?: PublicChatMessage | string;
  reaction?: PublicChatReaction;
  room?: PublicChatRoomState;
  buddyError?: string;
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
  throw Object.assign(
    new Error(
      typeof result.message === "string" ? result.message : "The chat service did not respond. Try again.",
    ),
    { status: response.status },
  );
}

// Next 15's bundled React (a 19.2 canary) renders <Activity> but does not export it yet; React
// 19.2 itself exports it under the same element type.
const Activity = ((ReactModule as Record<string, unknown>)["Activity"] ??
  Symbol.for("react.activity")) as typeof ReactModule.Activity;
/** About one screen of message rows: what a room drawn at once renders for its first frame. */
const firstScreenRows = () => Math.min(24, Math.max(8, Math.ceil(window.innerHeight / 56)));
type RoomSelection = { room: ChatRoom; snapshot: RoomSnapshot | null; initial: boolean; id: number };
type KeptRoom = { selection: RoomSelection; at: number };
/** A kept (hidden) room older than this mounts afresh, as the page's room cache expires then. */
const KEPT_ROOM_MS = 300000;

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
  /** Plain /chat (no room, DM or thread named): a phone opens on the room list. */
  phoneList?: boolean;
};
function PublicChatContent({
  pane,
  initialTheme,
  hasSeparateShortScoutProfile = false,
  cold,
  snapshot,
  onSnapshot,
  deviceOwner = "",
  onDeviceSave,
  onNavigate,
  onRoomsUpdated,
  clearSession,
  viewId,
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
  phoneList = false,
}: PublicChatProps & {
  cold: boolean;
  snapshot: RoomSnapshot | null;
  onSnapshot: (snapshot: RoomSnapshot) => void;
  deviceOwner?: string;
  onDeviceSave?: (room: ChatRoom, owner: string, data: DeviceRoom | null, urgent?: boolean) => void;
  onNavigate: (room: ChatRoom) => void;
  onRoomsUpdated: (rooms: ChatRoom[]) => void;
  clearSession: () => void;
  /** Which room view this is (SHELL-KEEP: the page keeps the room left last mounted). */
  viewId?: number;
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
    phone,
    phoneRef,
    phoneBack,
    setDmSettingsHost,
    dmLinkPending,
    setDmGlobalHost,
  } = session;
  const updates = useChatUpdates()!;
  const recordings = room === "lb-recordings" || room === "ss-recordings";
  const announcement = isAnnouncementRoom(room);
  const gainers = room === "gainers";
  const readOnlyAnnouncement = gainers || (announcement && !isAdmin);
  const shortScoutRoom = room === "shortscout" || room === "ss-announcements" || room === "ss-recordings";
  const roomLabel = CHAT_ROOMS.find((option) => option.slug === room)!.label;
  const loginHref = `/chat/login?room=${room}${popout ? "&popout=1" : ""}`;
  const supabase = useMemo(() => createClient(), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [searchVisited, setSearchVisited] = useState(false);
  const sharedIdentity = useChatIdentity();
  const [member, setMember] = useState<ChatMember | null>(bootstrap?.member ?? null);
  useEffect(() => {
    publishMember(member);
  }, [member, publishMember]);
  const activity = useSharedChatActivity();
  const { data: activityData, read: readActivity } = activity;
  // ROOM-NOTIFY: sidebar and switcher badges follow each room's notification level.
  const roomBadges = useMemo(() => roomBadgeCounts(activityData), [activityData]);
  const lastRoomRead = useRef("");
  // Highest rendered message, so reaching the bottom can re-check the read position right away.
  const renderedThroughRef = useRef(0),
    recheckedThrough = useRef(0);
  const scrolledMention = useRef("");
  const [identityError, setIdentityError] = useState("");

  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>(
    bootstrap ? (bootstrap.member ? "ready" : "name") : "checking",
  );
  const [guestId, setGuestId] = useState(bootstrap?.member?.id ?? "");
  const [displayName, setDisplayName] = useState(bootstrap?.member?.display_name ?? "");
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

  // True while a kept room view is being shown again (SHELL-KEEP; set by a layout effect below).
  const showingAgain = useRef(false);
  useEffect(() => {
    // Showing a kept room again comes from a room selection, which already did this.
    if (showingAgain.current) return;
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
    // A phone's list is its home screen; only the slide-out navigation closes on its own.
    // (The ref: on the first render the phone check has run but this render predates it.)
    if (!phoneRef.current) setMobileNavOpen(false);
  }, [room, mobileReplies, phone, phoneRef, setMobileNavOpen]);
  // UI-PHONE-NAV: the info sheet (pins, members, favorite, search) and the list's top bar.
  // SIDEBAR-REST: the same sheet opens on a computer too ("info": room or conversation info;
  // "dm-settings": sounds and requests for all DMs), so the sidebar holds only rows.
  const [sheet, setSheet] = useState<"info" | "dm-settings" | null>(null);
  const infoOpen = sheet !== null;
  const [listBarHost, setListBarNode] = useState<HTMLDivElement | null>(null);
  // The list's top bar keeps its bell and menu while the room is hidden (SHELL-KEEP), so showing
  // the room again does not build them again; a bar that left the page lets them go.
  const setListBarHost = useCallback((node: HTMLDivElement | null) => {
    setListBarNode(node);
    if (!node) return;
    return () =>
      queueMicrotask(() => {
        if (!node.isConnected) setListBarNode((current) => (current === node ? null : current));
      });
  }, []);
  const infoTrigger = useRef<HTMLButtonElement>(null);
  const sheetReturn = useRef<HTMLElement | null>(null);
  const phoneVisited = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  useLayoutEffect(() => setHydrated(true), []);
  useEffect(() => {
    // Room or conversation info belongs to what is showing; it closes when that changes.
    setSheet((open) => (open === "info" ? null : open));
  }, [mobileNavOpen, phone, inlineDm]);
  const closeInfo = useCallback(() => setSheet(null), []);
  const infoWasOpen = useRef(false);
  useEffect(() => {
    // Focus returns to what opened the sheet once the page is no longer inert behind it.
    if (infoOpen) infoWasOpen.current = true;
    else if (infoWasOpen.current) {
      infoWasOpen.current = false;
      const back =
        sheetReturn.current?.isConnected && sheetReturn.current.getClientRects().length
          ? sheetReturn.current
          : null;
      sheetReturn.current = null;
      if (back) back.focus({ preventScroll: true });
      else if (!mobileNavOpen) infoTrigger.current?.focus({ preventScroll: true });
    }
  }, [infoOpen, mobileNavOpen]);
  useEffect(() => {
    if (mobileNavOpen && mobileReplies) {
      navWasOpen.current = true;
      // Back on a phone's list: the conversation just left keeps focus in the list.
      if (!phone) navRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      else if (phoneVisited.current)
        navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true });
    } else if (navWasOpen.current) {
      navWasOpen.current = false;
      if (phone) phoneVisited.current = true;
      navTrigger.current?.focus({ preventScroll: true });
    }
  }, [mobileNavOpen, mobileReplies, navTrigger, phone]);

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
      known: knownMessagesParam(messages),
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
  const { counts: replyCounts, threads: replyThreads } = useReplyThreads(
    room,
    inlineDm ? "" : messageIds.replies,
    bootstrap?.counts,
    { accountId, memberId: member?.id },
    bootstrap?.threads,
  );
  const [reactions, updateReactions] = useState<PublicChatReaction[]>(bootstrap?.reactions ?? []);
  const setReactions = useCallback((action: React.SetStateAction<PublicChatReaction[]>) => {
    messageVersion.current++;
    updateReactions(action);
  }, []);
  const [body, setBody] = useState(snapshot?.draft ?? "");
  // The composer swaps its mic for the send arrow while there is something to send.
  const hasDraft = Boolean(body.trim()) || uploads.files.length > 0;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Keep anything typed before the page took over (EARLY-TYPING).
    const early = takeEarlyDraft(`Message ${roomLabel}`);
    if (early !== null && early !== bodyRef.current) setBody(early);
    // Only the first render can follow typing that happened before hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const node = composerRef.current;
    if (!node || CSS.supports("field-sizing", "content")) return;
    // Fallback auto-grow; CSS min-height and max-height still bound the result.
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
  }, [body, identityStatus]);
  const [loading, setLoading] = useState(cold);
  // Messages created after the room finished loading slide in (UI-STATES); the opening page doesn't.
  const loadedAt = useRef(0);
  const offline = useOffline();
  useEffect(() => {
    loadedAt.current = loading ? 0 : Date.now();
  }, [loading, room]);
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
  // Preserve search state after first use; never mount a closed search initially.
  useEffect(() => {
    if (searchOpen && !inlineDm) setSearchVisited(true);
  }, [searchOpen, inlineDm]);
  const [error, setError] = useState("");
  // History and navigation failures show by the message list, not in the composer (A5),
  // so typing never hides them and a send error never overwrites them. Scoped to the room.
  const [listFailure, setListFailure] = useState<{ room: string; text: string } | null>(null);
  const listError = listFailure?.room === room ? listFailure.text : "";
  const listRoom = useRef(room);
  listRoom.current = room;
  const setListError = useCallback(
    (text: string | ((current: string) => string)) =>
      setListFailure((current) => {
        const scope = listRoom.current;
        const previous = current?.room === scope ? current.text : "";
        const next = typeof text === "function" ? text(previous) : text;
        return next ? { room: scope, text: next } : null;
      }),
    [],
  );
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
  // A failed text send stays in the list as "Not sent" with Retry and Delete.
  const retrySendRef = useRef<(message: PublicChatMessage) => void>(() => {});
  const retrySend = useCallback((message: PublicChatMessage) => retrySendRef.current(message), []);
  // Text typed offline waits on this device ("Waiting for connection") and sends when back online.
  const roomRef = useRef(room);
  roomRef.current = room;
  const outbox = useRoomOutbox({
    memberId: member?.id ?? null,
    room,
    author: { guestId: guestId || null, label: displayName },
    send: async (item) => {
      let result: GuestResponse | null = null;
      for (let attempt = 0; !result; attempt++) {
        try {
          result = await invokeGuest({
            room: item.target,
            action: "send",
            body: item.body,
            attachmentIds: [],
            clientId: item.clientId,
          });
        } catch (caught) {
          // Rooms allow one message every 1.5s; a queued burst waits its turn (same clientId).
          if ((caught as { status?: number }).status !== 429 || attempt >= 2) throw caught;
          await new Promise((resolve) => setTimeout(resolve, ROOM_SEND_SPACING));
        }
      }
      const sent = typeof result.message === "object" ? result.message : null;
      if (!sent?.id) throw new Error("That message was not sent.");
      return sent;
    },
    onSent: (item, sent) => {
      if (item.target !== roomRef.current) return;
      setMessages((current) => mergeRoomMessage(current, sent));
    },
  });
  const outboxDiscard = outbox.discard;
  const discardSend = useCallback(
    (id: string) => {
      if (isOutboxRow(id)) {
        const row = id.slice("outbox-".length);
        outboxDiscard(row);
        return;
      }
      setMessages((current) => current.filter((message) => message.id !== id));
    },
    [setMessages, outboxDiscard],
  );
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
  const historyWindow = useRef<string | null>(null);
  // Queued (offline) messages sit after the newest message; not while an older page is open.
  const outboxRows = outbox.rows;
  const outboxMessages = useMemo(() => {
    if (!outboxRows.length || historyPage.hasNewer) return messages;
    const confirmed = new Set(messages.map((message) => message.client_id).filter(Boolean));
    return [...messages, ...outboxRows.filter((row) => !confirmed.has(row.send_client_id))];
  }, [messages, outboxRows, historyPage.hasNewer]);
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
    openingMoved = useRef(false),
    // The owner request of the unread-opening jump, so a gesture can give up exactly that one.
    openingJump = useRef(0);
  const openingInstant = useRef(false);
  const behindPhoneList = useRef(false);
  behindPhoneList.current = phone && mobileNavOpen;
  const openingCancelled = useRef(false),
    openingReadThrough = useRef(0),
    openingSettled = useRef(""),
    openingScope = useRef(""),
    openingChildPending = useRef(false),
    openingIntentCleanup = useRef<(() => void) | null>(null),
    visibleReplyReadThrough = useRef(0);
  const pinJumpRequest = useRef(0),
    // The pin jump waiting in the scroll owner: its navigation request, trigger and owner request.
    pinScrollTarget = useRef<(PinnedMessageJump & { owner: number }) | null>(null);
  const pinHighlightCleanup = useRef<(() => void) | null>(null);
  const searchHighlightCleanup = useRef<(() => void) | null>(null);
  // A1: the scroll owner is the only thing that moves the list. Following, reading, the unread
  // opening, pins, search/deep-link hits and history pages all go through it.
  const scrollOwner = useChatScrollOwner(
    (jump, target, node) => {
      if (jump.kind === "message" && jump.reason === "pin") {
        const pending = pinScrollTarget.current;
        pinScrollTarget.current = null;
        if (!pending || pending.request !== pinJumpRequest.current) return true;
        pinHighlightCleanup.current?.();
        pinHighlightCleanup.current = revealPinnedMessage(node, target, pending.trigger);
        scrollIntent.current = null;
        return true;
      }
      if (jump.kind === "edge-row") scrollIntent.current = null;
      if (jump.kind === "message" && jump.reason === "search") {
        // Search results and message links: the row is centred by the owner, then marked briefly.
        searchHighlightCleanup.current?.();
        searchHighlightCleanup.current = flashChatMessage(target);
        return false;
      }
      if (jump.kind === "message" && jump.reason === "opening") {
        scrollIntent.current = null;
        openingMoved.current = true;
        if (!openingChildPending.current) settleOpening();
        setRoomScrollVersion((v) => v + 1);
        // D-198: when the unread tail fits on screen the reader is already at the newest message.
        // Follow from here, so new messages stay in view and the whole tail counts as read
        // (staying in "reading" saved only the first unread, so each visit reopened one later).
        const newest = !historyPage.hasNewer;
        requestAnimationFrame(() => {
          if (newest && !openingChildPending.current && node.isConnected && chatPaneAtBottom(node)) {
            scrollOwner.dispatch({ type: "follow" });
            // The opening page already reaches the newest message, so release its fixed window;
            // otherwise later messages fall outside the range and the room looks frozen.
            if (historyWindow.current) {
              historyWindow.current = null;
              openingAnchor.current = null;
              resumeLive.current = false;
              updates.invalidate("history");
            }
            setRoomScrollVersion((v) => v + 1);
          }
        });
      }
      return false;
    },
    () => {
      scrollIntent.current = null;
      // A new message is now on screen: re-check the read position once for it, without waiting
      // for another change (once per message, so panes that don't save reads can't loop).
      if (
        pane?.active !== false &&
        recheckedThrough.current !== renderedThroughRef.current &&
        !lastRoomRead.current.endsWith(`:${renderedThroughRef.current}`)
      ) {
        recheckedThrough.current = renderedThroughRef.current;
        setRoomScrollVersion((v) => v + 1);
      }
      if (pane?.active !== false) {
        // Not while the opening request is in flight: its landing spot is still to come, and a
        // pane deactivated before it arrives must ask again when it becomes active.
        if (!openingPending.current && !openingAnchor.current && !openingCancelled.current) settleOpening();
        if (latestReadPending.current) {
          latestReadConfirmed.current = latestReadPending.current;
          latestReadPending.current = 0;
          setRoomScrollVersion((v) => v + 1);
        }
      }
      latestIntentCleanup.current?.();
    },
  );
  const dropPinJump = useCallback(() => {
    const pending = pinScrollTarget.current;
    pinScrollTarget.current = null;
    if (pending) scrollOwner.dispatch({ type: "give-up", request: pending.owner, atBottom: false });
  }, [scrollOwner]);
  const pinIntent = useRef(false),
    pinIntentCleanup = useRef<(() => void) | null>(null);
  const [pinReplyJump, setPinReplyJump] = useState<PinnedMessageJump | null>(null);
  const cancelPinJump = useCallback(() => {
    if (!pinIntent.current) return;
    pinIntent.current = false;
    pinIntentCleanup.current?.();
    pinJumpRequest.current++;
    dropPinJump();
    pinHighlightCleanup.current?.();
    setPinReplyJump(null);
  }, [dropPinJump]);
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
      searchHighlightCleanup.current?.();
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
    if (scrollOwner.following()) awaySeq.current = Infinity;
    // Away without a recorded boundary (pin jump, paging): count from what was already loaded.
    else if (awaySeq.current === Infinity) awaySeq.current = previousMaxSeq.current;
    previousMaxSeq.current = maxSeq;
  }, [maxSeq, scrollOwner]);
  const settleOpening = () => {
    openingIntentCleanup.current?.();
    openingIntentCleanup.current = null;
    openingSettled.current = openingScope.current;
  };
  const quadPane = !!pane;
  const cancelOpening = useCallback(() => {
    openingIntentCleanup.current?.();
    openingIntentCleanup.current = null;
    if (!openingMoved.current) setUnreadStart(null);
    scrollOwner.dispatch({ type: "give-up", request: openingJump.current, atBottom: false });
    if (
      openingSettled.current !== openingScope.current &&
      (openingPending.current || !openingMoved.current)
    ) {
      // A Quad pane resting at the newest message keeps following when a click (any pointerdown
      // cancels the opening) or leaving the pane stops its opening; it asks again when active.
      const node = messagesRef.current;
      const resting = quadPane && !!node?.isConnected && chatPaneAtBottom(node);
      scrollOwner.dispatch({ type: resting ? "follow" : "read" });
    }
    openingCancelled.current = true;
    openingMoved.current = true;
  }, [scrollOwner, quadPane]);
  const messagesRef = useRef<HTMLDivElement>(null);
  // DEVICE-STORE: a room drawn at once from a kept copy (this page's or this device's) at its
  // newest message renders one screen of rows for the first frame, then the rest right after it
  // paints (a transition, so a tap meanwhile is not held up). The scroll owner holds the bottom.
  const [rowLimit, setRowLimit] = useState(() => {
    if (!snapshot || !messages.length || activityData.roomMessageCounts?.[room] !== 0) return Infinity;
    if (typeof window === "undefined" || pane) return Infinity;
    const url = new URL(window.location.href);
    if (url.hash.startsWith("#chat-message-") || url.searchParams.has("thread")) return Infinity;
    return firstScreenRows();
  });
  useEffect(() => {
    if (rowLimit === Infinity) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => startTransition(() => setRowLimit(Infinity)), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [rowLimit]);
  const messagesNow = useRef(messages);
  messagesNow.current = messages;
  const activityNow = useRef(activityData);
  activityNow.current = activityData;
  const chatRef = useRef<HTMLElement>(null);
  const openSheet = useCallback((mode: "info" | "dm-settings") => {
    const active = document.activeElement;
    sheetReturn.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setSheet(mode);
  }, []);
  const openInfo = useCallback(() => openSheet("info"), [openSheet]);
  const openDmSettings = useCallback(() => openSheet("dm-settings"), [openSheet]);
  // Swipe back from the left edge: the conversation follows the finger over the list.
  const swipe = useRef<{ pointer: number; x: number; width: number; dx: number } | null>(null);
  const swipeStyles = (dx: number | null, width = 1) => {
    const chat = chatRef.current,
      nav = navRef.current;
    if (!chat || !nav) return;
    if (dx === null) {
      for (const node of [chat, nav]) {
        node.style.removeProperty("transition");
        node.style.removeProperty("transform");
        node.style.removeProperty("visibility");
      }
      return;
    }
    for (const node of [chat, nav]) node.style.transition = "none";
    chat.style.transform = `translateX(${dx}px)`;
    nav.style.visibility = "visible";
    nav.style.transform = `translateX(${-28 + (28 * dx) / width}%)`;
  };
  const swipeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    swipe.current = {
      pointer: event.pointerId,
      x: event.clientX,
      width: chatRef.current?.offsetWidth || window.innerWidth,
      dx: 0,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const swipeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = swipe.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.dx = Math.max(0, event.clientX - drag.x);
    swipeStyles(drag.dx, drag.width);
  };
  const swipeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = swipe.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    swipe.current = null;
    if (drag.dx > drag.width * 0.3 && event.type === "pointerup") {
      // Keep the dragged position; the list effect below lets it finish the slide.
      for (const node of [chatRef.current, navRef.current]) node?.style.removeProperty("transition");
      phoneBack();
    } else swipeStyles(null);
  };
  useLayoutEffect(() => {
    if (mobileNavOpen) swipeStyles(null);
    // Only the list opening or closing settles the swipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileNavOpen]);
  const mobilePage = useRef<HTMLElement>(null);
  useMobileKeyboardDismiss(mobilePage);
  useEffect(() => (mobilePage.current ? watchChatViewport(mobilePage.current) : undefined), []);
  const loadedRoom = useRef<ChatRoom | null>(cold ? null : (bootstrap?.room ?? null));
  // P11: the server just rendered this room's messages, so the history watch skips its first
  // read. The read on going live (or the 2-second timer when there is no live connection)
  // still closes the gap since the server rendered.
  const serverRendered = useRef(!cold && !snapshot && bootstrap?.room === room);
  // DEVICE-STORE: false while the list shows only what this device kept (or nothing yet). Reads,
  // notification acknowledgements and device saves wait for the server's own copy.
  const [fresh, setFresh] = useState(serverRendered.current);
  const markFresh = useCallback(() => setFresh(true), []);
  const deviceState = useRef<{ owner: string; data: DeviceRoom | null } | null>(null);
  deviceState.current =
    !deviceOwner || !member || pane
      ? null
      : roomDenied
        ? { owner: deviceOwner, data: null }
        : fresh && !loading && !historyPage.hasNewer && roomStatus
          ? {
              owner: deviceOwner,
              data: { roomState: roomStatus, messages, reactions, counts: replyCounts, featureChannel },
            }
          : null;
  // What the device holds for this room, so a deletion is written at once (not in idle time).
  const deviceHeld = useRef<DeviceSeen>(snapshot ? deviceSeen(snapshot.bootstrap.messages) : new Map());
  const saveDevice = useCallback(
    (urgent = false) => {
      const state = deviceState.current;
      if (!state) return;
      if (state.data) deviceHeld.current = deviceSeen(deviceRoomData(state.data).messages);
      onDeviceSave?.(room, state.owner, state.data, urgent);
    },
    [onDeviceSave, room],
  );
  // Saved at most every 1.5 s while the list changes (the store batches writes to idle time),
  // when the tab hides and when the room closes.
  const deviceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const state = deviceState.current;
    if (!state) return;
    if (state.data && deviceRemoval(deviceHeld.current, deviceRoomData(state.data).messages)) {
      saveDevice(true);
      return;
    }
    if (deviceTimer.current) return;
    deviceTimer.current = setTimeout(() => {
      deviceTimer.current = null;
      saveDevice();
    }, 1500);
  }, [messages, reactions, fresh, loading, roomDenied, historyPage.hasNewer, saveDevice]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") saveDevice(true);
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", hidden);
      if (deviceTimer.current) clearTimeout(deviceTimer.current);
      deviceTimer.current = null;
      saveDevice();
    };
  }, [saveDevice]);
  const latestSnapshot = useRef<RoomSnapshot | null>(null);
  latestSnapshot.current =
    accountId && roomStatus
      ? {
          bootstrap: {
            accountId,
            room,
            member,
            roomState: roomStatus,
            // D-198: an older history window (after an unread or pin jump) would reopen as the
            // room's "latest" messages and briefly show yesterday; keep only the newest window.
            messages: historyPage.hasNewer ? [] : messages,
            reactions: historyPage.hasNewer ? [] : reactions,
            counts: historyPage.hasNewer ? {} : replyCounts,
            threads: historyPage.hasNewer ? {} : replyThreads,
            featureChannel,
          },
          draft: body,
          replyDrafts: replyDrafts.current,
          // Not read here: reading scrollTop while rendering forces a layout on every render.
          // Both savers below read the live position.
          scroll: snapshot?.scroll ?? 0,
          pinned: scrollOwner.following(),
        }
      : null;
  const savedScroll = useRef(snapshot?.scroll ?? 0);
  const saveSnapshot = useCallback(() => {
    if (!latestSnapshot.current) return;
    savedScroll.current = messagesRef.current?.scrollTop ?? latestSnapshot.current.scroll;
    onSnapshot({ ...latestSnapshot.current, scroll: savedScroll.current, pinned: scrollOwner.following() });
  }, [onSnapshot, scrollOwner]);
  const toggleSearch = useCallback(() => {
    setRoomSelection((value) => value + 1);
    setDmTarget(null);
    setSearchOpen((open) => !open);
    setMobileNavOpen(false);
  }, [setRoomSelection, setDmTarget, setMobileNavOpen]);
  // Ctrl/⌘K opens the quick switcher (QUICK-SWITCH); the full page only, not quad panes.
  useEffect(() => {
    if (pane) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSwitcherOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pane]);
  useLayoutEffect(
    () => () => {
      if (latestSnapshot.current)
        onSnapshot({
          ...latestSnapshot.current,
          // Not read from the list: closing (or hiding, SHELL-KEEP) runs while the next room is
          // drawn, and reading scrollTop then lays that room out early, before it is ready.
          scroll: savedScroll.current,
          pinned: scrollOwner.following(),
        });
    },
    [onSnapshot, scrollOwner],
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
    dropPinJump();
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
    // Unchanged when already so (a room shown again), which saves a render of the whole room.
    setHistoryPage((page) => (page.hasMore || page.hasNewer ? { hasMore: false, hasNewer: false } : page));
    openingPending.current = true;
    setOpeningReady(false);
    openingCancelled.current = false;
    openingMoved.current = false;
    openingAnchor.current = null;
    openingReadThrough.current = 0;
    scrollOwner.dispatch({ type: "reset" });
    const preset = initialOpening.current;
    initialOpening.current = undefined;
    // DEVICE-STORE: rooms the bell counts no unread messages in open at the newest message, which
    // is where the server's opening lands too, so a room already on screen (from this page or this
    // device) shows at once. The opening request below still runs: if it finds an unread message
    // after all (the count was a few seconds old), it moves there as before. Rooms with unread
    // messages, and rooms with nothing kept, wait for the server's landing spot as before.
    const instant =
      !preset && messagesNow.current.length > 0 && activityNow.current.roomMessageCounts?.[room] === 0;
    openingInstant.current = instant;
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
      scrollOwner.dispatch({ type: "read" });
      openingPending.current = false;
      openingSettled.current = scope;
      setOpeningReady(true);
      return;
    }
    // A room under the phone's list opens when it is tapped there: scrolling and tapping the list
    // (or leaving the app meanwhile) is not the reader moving in this room.
    const stopIntent = watchPinnedMessageIntent(() => {
      if (!behindPhoneList.current) cancelOpening();
    });
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
        openingJump.current = scrollOwner.dispatch({ type: "open", anchor: preset.messageId });
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
    if (instant) setOpeningReady(true);
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
          `/api/chat/history?room=${room}&${knownMessageIds.current}&around=${result.messageId}`,
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
        openingJump.current = scrollOwner.dispatch({ type: "open", anchor: result.messageId });
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
      if (instant) {
        // Already showing the newest message: the landing is confirmed; reads may count now.
        if (!result.messageId && !openingCancelled.current && scrollOwner.following()) settleOpening();
        setRoomScrollVersion((v) => v + 1);
      }
    })().catch((e) => {
      if (!controller.signal.aborted && intent === pinJumpRequest.current) {
        setListError(e instanceof Error ? e.message : "Chat unavailable");
        // Without a landing spot, open at the latest message rather than leaving the room unpositioned.
        openingPending.current = false;
        setOpeningReady(true);
      }
    });
    return cleanup;
  }, [
    cancelOpening,
    dropPinJump,
    scrollOwner,
    setListError,
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
  // After the opening's effect, so these timings see each opening's own marks (cancelled, anchor),
  // also when a kept room is shown again or React replays effects (SHELL-KEEP).
  useChatTimings({
    enabled: !pane,
    room,
    memberId: member?.id,
    rootRef: mobilePage,
    listRef: messagesRef,
    openingReady,
    hasMessages: messages.length > 0,
    shown: !inlineDm && !(phone && mobileNavOpen) && pane?.visible !== false,
    covered: !!(mobileReplies && replyTarget) || searchOpen,
    behindList: phone && mobileNavOpen && !inlineDm,
    openingAnchor,
    openingPending,
    openingCancelled,
  });
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
      scrollOwner.dispatch({ type: "give-up", request: openingJump.current, atBottom: false });
      scrollOwner.dispatch({ type: "read" });
      setOpeningReady(true);
      setPinJumpError("");
      if (pin.replyToId) {
        setPinReplyJump({ messageId: pin.messageId, request, trigger });
        openReplies(pin.messageId);
        return;
      }
      try {
        const response = await fetch(
          `/api/chat/history?room=${room}&${knownMessageIds.current}&anchor=${pin.messageId}`,
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
        dropPinJump();
        pinScrollTarget.current = {
          messageId: pin.messageId,
          request,
          trigger,
          owner: scrollOwner.dispatch({
            type: "jump",
            jump: { kind: "message", messageId: pin.messageId, align: "center", reason: "pin" },
          }),
        };
        setPinRevealRequest(request);
        replyTrigger.current = null;
        closeReplies();
        setMessages((current) => reconcileRoomMessages(current, result.messages));
        setReactions(result.reactions ?? []);
      } catch (error) {
        if (request === pinJumpRequest.current && navigation === pinNavigation.current.version) {
          dropPinJump();
          setPinJumpError(error instanceof Error ? error.message : "Could not open this pinned message.");
          updates.invalidate("room");
        }
      }
    },
    [
      room,
      closeReplies,
      openReplies,
      setMessages,
      setReactions,
      updates,
      cancelPinJump,
      dropPinJump,
      scrollOwner,
    ],
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
    // A Quad pane starts its opening on the press that activates it, so Skip there takes over a
    // pending opening (the pinJumpRequest bump below drops its result) instead of waiting for it.
    if (skippingLatest || loading || (!openingReady && !quadPane) || pane?.visible === false) return;
    cancelPinJump();
    scrollIntent.current = null;
    resumeLive.current = false;
    pinJumpRequest.current++;
    dropPinJump();
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
        scrollOwner.dispatch({ type: "read" });
        setSkippingLatest(false);
        latestIntentCleanup.current?.();
      }
    });
    // Keep the old position and read boundary until fresh latest history succeeds.
    // The read boundary is the newest message when Latest was pressed: a retry's newer
    // snapshot can include replies that arrived later and were never shown.
    let latestThrough: number | null = null;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const version = messageVersion.current;
        const response = await fetch(`/api/chat/history?room=${room}&${knownMessageIds.current}&latest=1`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load the most recent message. Please try again.");
        const result = await response.json();
        if (request !== skipRequest.current) return;
        latestThrough ??= Number(result.latestThrough) || 0;
        // A send, realtime row, edit, or history refresh may have overtaken this snapshot.
        if (version !== messageVersion.current) continue;
        const previousFailure = skipFailure.current;
        setListError((current) => (current === previousFailure ? "" : current));
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
        latestReadPending.current = latestThrough;
        historyWindow.current = null;
        setHistoryPage({ hasMore: false, hasNewer: false });
        setUnreadStart(null);
        setUnreadThread(null);
        scrollOwner.dispatch({ type: "follow" });
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
        setListError(skipFailure.current);
        // The opening this Skip took over will not finish; leave the pane where it is, as a
        // failed opening does.
        if (openingPending.current) {
          cancelOpening();
          openingPending.current = false;
          setOpeningReady(true);
        }
      }
    } finally {
      if (request === skipRequest.current) setSkippingLatest(false);
    }
  }, [
    dropPinJump,
    scrollOwner,
    setListError,
    inlineDm,
    session.dmSkipLatest,
    skippingLatest,
    loading,
    openingReady,
    quadPane,
    cancelOpening,
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
    if (!force && !scrollOwner.following()) return;
    const request = ++skipRequest.current;
    const version = messageVersion.current;
    if (force) scrollOwner.dispatch({ type: "follow" });
    try {
      const response = await fetch(`/api/chat/history?room=${room}&${knownMessageIds.current}`, {
        cache: "no-store",
      });
      const page = await response.json();
      if (request !== skipRequest.current || !scrollOwner.following()) return;
      if (!response.ok || version !== messageVersion.current)
        throw Error("Message sent. The latest history could not load. Use Show sent message to retry.");
      historyWindow.current = null;
      openingAnchor.current = null;
      scrollIntent.current = null;
      resumeLive.current = false;
      setUnreadStart(null);
      setHistoryPage({ hasMore: false, hasNewer: false });
      setSentWindowRetry(false);
      setListError("");
      setMessages((current) => reconcileRoomMessages(current, page.messages));
      setReactions(page.reactions ?? []);
    } catch (error) {
      if (request === skipRequest.current) {
        setSentWindowRetry(true);
        setListError(
          error instanceof Error ? error.message : "Message sent. Use Show sent message to retry.",
        );
      }
    }
  }
  // A page load moves the reader to its edge; wait a moment before another scroll can load more.
  const autoloadPause = useRef(0);
  async function pageHistory(direction: "before" | "after") {
    if (paging || loading) return;
    latestIntentCleanup.current?.();
    latestReadPending.current = 0;
    latestReadConfirmed.current = 0;
    cancelOpening();
    scrollOwner.dispatch({ type: "read" });
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
        `/api/chat/history?room=${room}&${knownMessageIds.current}&${direction}=${cursor}`,
        { cache: "no-store" },
      );
      const page = await response.json();
      if (request !== skipRequest.current) return;
      if (!response.ok) throw Error("Could not load this page. Try again.");
      if (!page.messages?.some((row: PublicChatMessage) => !row.removed)) {
        setListError("This page changed. Use Latest to refresh the conversation.");
        return;
      }
      historyWindow.current = page.range ?? null;
      openingAnchor.current = null;
      scrollOwner.dispatch({
        type: "jump",
        jump: { kind: "edge-row", edge: direction === "before" ? "last" : "first", reason: "page" },
      });
      setHistoryPage({ hasMore: !!page.hasMore, hasNewer: !!page.hasNewer });
      setListError("");
      setMessages((current) => reconcileRoomMessages(current, page.messages));
      setReactions(page.reactions ?? []);
    } catch (e) {
      if (request === skipRequest.current)
        setListError(e instanceof Error ? e.message : "Could not load messages.");
    } finally {
      if (busy === pageBusy.current) setPaging(false);
      autoloadPause.current = Date.now() + 1000;
    }
  }
  // On the live tail, move instantly; skipLatest still refreshes the tail and read boundary.
  const jumpToLatest = useCallback(() => {
    const node = messagesRef.current;
    if (!inlineDm && node && !loading && openingReady && !historyWindow.current && !historyPage.hasNewer) {
      cancelPinJump();
      scrollIntent.current = null;
      resumeLive.current = false;
      scrollOwner.dispatch({ type: "follow" });
      awaySeq.current = Infinity;
      farFromBottom.current = false;
      node.scrollTop = node.scrollHeight;
      setRoomScrollVersion((value) => value + 1);
    }
    void skipLatest();
  }, [inlineDm, loading, openingReady, historyPage.hasNewer, cancelPinJump, skipLatest, scrollOwner]);
  const registerSkipLatest = pane?.onSkipLatest;
  useEffect(() => {
    // Not gated on openingReady: the press that activates a Quad pane starts its opening, and
    // disabling Skip under the pointer would swallow that same click (BUG-QUAD-FIRST-CLICK).
    registerSkipLatest?.(inlineDm || (!loading && !skippingLatest) ? jumpToLatest : null);
    return () => registerSkipLatest?.(null);
  }, [registerSkipLatest, inlineDm, loading, skippingLatest, jumpToLatest]);
  useVisibleChatNotifications({
    container: messagesRef,
    enabled:
      !!member &&
      identityStatus === "ready" &&
      !loading &&
      openingReady &&
      fresh &&
      !searchOpen &&
      !inlineDm &&
      !dmLinkPending &&
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

  useEffect(() => {
    const openingThrough = !openingCancelled.current && openingMoved.current ? openingReadThrough.current : 0;
    const renderedThrough = messages.reduce((max, message) => Math.max(max, message.unread_seq ?? 0), 0);
    renderedThroughRef.current = renderedThrough;
    // Keep the existing sequence marker independent from exact notification acknowledgements.
    // Checked before the at-bottom test below, which reads layout.
    if (
      pane?.visible === false ||
      pane?.active === false ||
      latestReadPending.current ||
      openingPending.current ||
      !openingReady ||
      !fresh ||
      !member ||
      loading ||
      loadedRoom.current !== room ||
      identityStatus !== "ready" ||
      searchOpen ||
      inlineDm ||
      dmLinkPending ||
      document.hidden ||
      document.querySelector("dialog[open]")
    )
      return;
    // At the bottom of the newest window everything rendered has been on screen (D-198). Rendered
    // rows came from the server and read_chat_room clamps to the room's newest message, so no
    // client cap is needed (waiting for the bell's count left fresh messages unread for ~5 s).
    const normalThrough =
      !!messagesRef.current && chatPaneAtBottom(messagesRef.current) && !historyPage.hasNewer
        ? Math.max(renderedThrough, openingThrough)
        : openingThrough;
    // A confirmed Latest read never moves the marker back: if the room already read further (the
    // at-bottom read can land first), it is done.
    const sentPrefix = `${member?.id}:${room}:`,
      sentThrough = lastRoomRead.current.startsWith(sentPrefix)
        ? Number(lastRoomRead.current.slice(sentPrefix.length))
        : 0;
    if (latestReadConfirmed.current && latestReadConfirmed.current <= sentThrough)
      latestReadConfirmed.current = 0;
    const roomThrough =
      latestReadConfirmed.current ||
      visibleReplyReadThrough.current ||
      (sendReadHold.current
        ? 0
        : readIntentThrough.current
          ? Math.min(normalThrough, readIntentThrough.current)
          : normalThrough);
    if (!roomThrough) return;
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
    scrollOwner,
    readActivity,
    member,
    loading,
    identityStatus,
    room,
    searchOpen,
    inlineDm,
    dmLinkPending,
    openingReady,
    fresh,
    roomScrollVersion,
    messages,
    pane?.visible,
    pane?.active,
    historyPage.hasNewer,
  ]);
  // Search results and message links (#chat-message-<id>): the room moves to the message and marks
  // it briefly. A message older than the loaded page loads with the messages around it; a reply
  // opens its thread at the reply. The reader can then page either way, and Jump to latest returns.
  const messageJump = useRef(0);
  const [threadJump, setThreadJump] = useState<ThreadJump | null>(null);
  useEffect(() => {
    if (threadJump && threadJump.parentId !== replyTarget) setThreadJump(null);
  }, [threadJump, replyTarget]);
  const jumpToMessage = useCallback(
    async (messageId: string) => {
      const request = ++messageJump.current;
      const current = () => request === messageJump.current && listRoom.current === room;
      cancelPinJump();
      openingCancelled.current = true;
      openingMoved.current = true;
      openingPending.current = false;
      scrollIntent.current = null;
      resumeLive.current = false;
      latestIntentCleanup.current?.();
      latestReadPending.current = 0;
      latestReadConfirmed.current = 0;
      scrollOwner.dispatch({ type: "give-up", request: openingJump.current, atBottom: false });
      setOpeningReady(true);
      const jump = () => {
        // A room message shows in the room: an open thread (full screen on a phone) closes, as for pins.
        replyTrigger.current = null;
        closeReplies();
        scrollOwner.dispatch({
          type: "jump",
          jump: { kind: "message", messageId, align: "center", reason: "search" },
        });
      };
      if (messagesRef.current?.querySelector(`[id="chat-message-${CSS.escape(messageId)}"]`)) {
        jump();
        if (messagesRef.current) scrollOwner.layout(messagesRef.current);
        return;
      }
      setUnreadStart(null);
      setUnreadThread(null);
      try {
        const response = await fetch(
          `/api/chat/history?room=${room}&${knownMessageIds.current}&around=${encodeURIComponent(messageId)}`,
          { cache: "no-store" },
        );
        if (!current()) return;
        if (response.status === 404) {
          // Not a room-level message: it may be a reply, which lives in its thread.
          const thread = await fetch(
            `/api/chat/thread?room=${room}&messageId=${encodeURIComponent(messageId)}`,
            { cache: "no-store" },
          );
          const data = thread.ok ? await thread.json() : null;
          if (!current()) return;
          const parentId = data?.parent?.reply_to_id;
          if (!parentId) throw Error("This message is no longer available.");
          setThreadJump({ parentId, messageId, request });
          openReplies(parentId);
          return;
        }
        if (!response.ok) throw Error("Could not open this message. Try again.");
        const page = await response.json();
        if (!current()) return;
        const rows: PublicChatMessage[] = page.messages ?? [];
        if (!rows.some((row) => row.id === messageId && !row.removed))
          throw Error("This message is no longer available.");
        skipRequest.current++;
        setSkippingLatest(false);
        historyWindow.current = page.range ?? null;
        openingAnchor.current = null;
        // Newer messages beyond this page count as unseen only once they arrive.
        awaySeq.current = rows.reduce((max, row) => Math.max(max, row.unread_seq ?? 0), 0);
        scrollOwner.dispatch({ type: "read" });
        jump();
        setHistoryPage({ hasMore: !!page.hasMore, hasNewer: !!page.hasNewer });
        setListError("");
        setMessages((existing) => reconcileRoomMessages(existing, rows));
        setReactions(page.reactions ?? []);
      } catch (e) {
        if (current()) setListError(e instanceof Error ? e.message : "Could not open this message.");
      }
    },
    [room, cancelPinJump, scrollOwner, openReplies, closeReplies, setListError, setMessages, setReactions],
  );
  useEffect(() => {
    if (pane) return;
    const reveal = () => {
      const id = window.location.hash.slice(1);
      if (loading || !id.startsWith("chat-message-") || scrolledMention.current === id) return;
      scrolledMention.current = id;
      void jumpToMessage(id.slice(13));
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [loading, pane, jumpToMessage]);
  // A search result in this room: close search first, so the list is on screen when it moves.
  const [searchJump, setSearchJump] = useState<{ id: string; request: number } | null>(null);
  useEffect(() => {
    if (!searchJump || searchOpen || loading) return;
    setSearchJump(null);
    void jumpToMessage(searchJump.id);
  }, [searchJump, searchOpen, loading, jumpToMessage]);
  const openSearchResult = useCallback(
    (result: { id: string; room_slug: string }) => {
      if (result.room_slug === room) {
        setSearchOpen(false);
        setSearchJump((previous) => ({ id: result.id, request: (previous?.request ?? 0) + 1 }));
        return;
      }
      if (pane) return;
      // Another room: open it with the message link, which that room follows once it loads.
      onNavigate(result.room_slug as ChatRoom);
      const url = new URL(window.location.href);
      url.hash = `chat-message-${result.id}`;
      window.history.replaceState(window.history.state, "", url);
    },
    [room, pane, onNavigate],
  );

  const { theme, setTheme, themeReady } = useChatTheme(initialTheme);

  useEffect(() => {
    let cancelled = false;
    const stop = updates.watch(
      async () => {
        const response = await updates.read(`/api/chat?room=${room}`);
        const result = await response.json();
        if (!cancelled && response.ok && typeof result.isOpen === "boolean") setRoomStatus(result);
        // Pause/reopen is published to room channels, so the timed check can relax while live.
        // EVENT-STREAM step 3: once pause/reopen is numbered and the room is in step, a missed one
        // is caught up from the cursor, so the check only confirms every five minutes.
      },
      ["status"],
      false,
      10000,
      60000,
      "rooms",
      room,
      "state",
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [room, updates]);

  const admin = useRoomAdmin({ room, roomLabel, isAdmin, pane: !!pane, setRoomStatus });
  const { isOwner, adminOpen, setAdminOpen, adminAction } = admin;
  // SHELL-KEEP: the room left last stays mounted, hidden, for an instant switch back (PublicChat
  // below). Hiding it runs every effect's cleanup and showing it runs them again, as an unmount and
  // a mount would; what lives in state is reset here, so the room opens again as a fresh mount
  // does: at the newest message or the first unread one (after the server confirms the landing),
  // with panels and errors closed, and with reads and device saves waiting for the server's copy.
  // The draft and the reply drafts stay, as the room cache keeps them.
  // The opening is asked for again when the room shows (layout effects run before the opening's
  // effect): not on hiding, since a hidden list still gets the scroll its hiding causes.
  // Set when the room is hidden (below); never by React's development-only effect replay.
  const wasHidden = useRef(false);
  useLayoutEffect(() => {
    showingAgain.current = wasHidden.current;
    if (wasHidden.current) {
      wasHidden.current = false;
      // As on a mount: nothing (moving to the bottom included) settles the opening before it runs.
      openingSettled.current = "";
      openingPending.current = pane?.active !== false;
      // Its timing hooks run before the opening's effect; they see a new opening, as on a mount.
      openingCancelled.current = false;
      openingMoved.current = false;
      openingAnchor.current = null;
      // Hidden, it was marked not ready (so its timing hooks wait for this opening). With no unread
      // messages it shows at once at the newest message (the opening's effect decides the same);
      // with unread ones the list waits for the server's landing spot, as on a mount.
      if (messagesNow.current.length > 0 && activityNow.current.roomMessageCounts?.[room] === 0)
        setOpeningReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const page = mobilePage.current;
    return () => {
      // Only when hidden (not on closing, nor on React's development-only effect replay).
      if (page?.style.display !== "none") return;
      wasHidden.current = true;
      setOpeningReady(false);
      setFresh(false);
      // Shown again, it draws one screen of rows first and the rest right after, as a kept copy
      // does on a mount (only its newest page is ever shown again).
      if (!pane) setRowLimit(firstScreenRows());
      // Shown again with a message link (a search result from another room), it follows the link.
      scrolledMention.current = "";
      setSearchOpen(false);
      setSwitcherOpen(false);
      setSheet(null);
      setAdminOpen(false);
      setError("");
      setPinJumpError("");
      setListFailure(null);
      setConnectionIssue(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // Sign-in is required, so a name is all that's missing. Guest sessions no longer exist.
        setNameDraft(savedName);
        setIdentityStatus("name");
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

  useRoomHistory({
    updates,
    room,
    inlineDm,
    loginHref,
    shortScoutRoom,
    scrollOwner,
    clearSession,
    setMessages,
    setReactions,
    messageVersion,
    knownMessageIds,
    openingAnchor,
    historyWindow,
    resumeLive,
    serverRendered,
    loadedRoom,
    setConnectionIssue,
    setLoading,
    setAccessDenied,
    setHistoryPage,
    onServerTruth: markFresh,
  });

  const { chatterCount, presenceReady, onlineMemberIds } = useRoomPresence({
    guestId,
    identityStatus,
    supabase,
    room,
    conversationId: pane?.conversationId,
  });

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
    // The opening request is out; only a room already drawn at its newest message (DEVICE-STORE's
    // instant opening) keeps the bottom meanwhile.
    if (openingPending.current && !openingInstant.current) return;
    // A background pane still holds the bottom; jumps wait until it is the active one.
    const settle = () => {
      if (pane?.active !== false || scrollOwner.following()) scrollOwner.layout(node);
    };
    // An open ••• menu holds the list still, so late reactions or images can't slide the
    // message (and its menu) out from under a tap; the list catches up when the menu closes.
    // Rows above still change height meanwhile, so keep the visible row where it is.
    const menuOpen = () => !!node.querySelector("details[open]");
    const stop = watchChatPaneLayout(node, () => {
      if (!menuOpen()) settle();
      else if (pane?.active !== false) scrollOwner.hold(node);
    });
    // UI-PHONE-NAV: a room opened from under the phone's list starts its slide off-screen, so the
    // watch above skips it and nothing calls it again once it is in (no size or visibility
    // change). If it has not landed yet, put it at its landing spot now, so it slides in there.
    // (A room already landed keeps the spot the reader left it at.)
    if (
      phone &&
      openingSettled.current !== openingScope.current &&
      !chatPaneVisible(node) &&
      chatPaneLaidOut(node)
    )
      settle();
    const toggled = (event: Event) => {
      if (event.target instanceof HTMLDetailsElement && !menuOpen()) settle();
    };
    node.addEventListener("toggle", toggled, true);
    return () => {
      stop();
      node.removeEventListener("toggle", toggled, true);
    };
  }, [
    scrollOwner,
    loading,
    identityStatus,
    roomStatus?.isOpen,
    searchOpen,
    replyTarget,
    mobileReplies,
    mobileNavOpen,
    phone,
    inlineDm,
    openingReady,
    skippingLatest,
    pane?.visible,
    pane?.active,
    pinRevealRequest,
  ]);

  // LIST-ANCHOR: only rows near the screen render; the list node remounts with the room's branch.
  const rowWindow = useRef<{ node: HTMLElement; stop: () => void } | null>(null);
  useEffect(() => {
    const node = messagesRef.current;
    if (rowWindow.current?.node === node) return;
    rowWindow.current?.stop();
    rowWindow.current = node ? { node, stop: watchChatRowWindow(node) } : null;
  });
  // Showing or hiding every row's reactions, and the viewer's clock (day dividers, grouping),
  // change every row's height, far rows included: lay them all out again before they are seen.
  const reactionsActive = !inlineDm && (!mobileReplies || (!replyTarget && !mobileNavOpen));
  useLayoutEffect(() => {
    if (messagesRef.current) resetChatRowWindow(messagesRef.current);
  }, [reactionsActive, themeReady]);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      rowWindow.current?.stop();
      rowWindow.current = null;
    },
    [],
  );

  const roomPaused = roomStatus?.isOpen === false;
  const roomCaption = gainers
    ? "Gainers · Broadcast only"
    : recordings
      ? "Recordings · Admin posts only"
      : announcement
        ? "Announcements · Admin posts only"
        : room === "shortscout"
          ? "Short selling"
          : room === "social"
            ? "Movies, life & everything else"
            : "Trading & the markets";
  const pauseNotice = roomStatus?.notice || "Chat temporarily paused by Longboard.";
  const roomTitle =
    announcement || gainers
      ? roomLabel
      : room === "shortscout"
        ? "ShortScout"
        : room === "social"
          ? "Social"
          : "Longboard";
  const roomPresence = roomPaused ? "Paused" : presenceReady ? `${chatterCount} online` : "Connecting…";

  const feedback = useMemo(() => {
    if (error) return error;
    // Only /summary reports success here; a room message confirms itself by appearing.
    if (sendState === "success") return "Message sent.";
    return body.length > COUNTER_THRESHOLD ? `${body.length} / ${MAX_MESSAGE_LENGTH}` : "";
  }, [body.length, error, sendState]);

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

    // A pre-sign-in guest token, if this browser still has one, links that guest's old messages.
    const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
    setNameState("loading");
    setError("");
    try {
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

    if (!member) {
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

    if (!uploads.ids.length && (!navigator.onLine || outbox.queueFirst)) {
      // No connection (or older messages still waiting): queue it so it goes, in order, when back.
      const mobileSend = beginMobileSend(event.currentTarget.querySelector("textarea"), messagesRef.current);
      if (outbox.queue(nextBody, crypto.randomUUID())) {
        scrollOwner.dispatch({ type: "follow" });
        setBody("");
        setError("");
        mobileSend.confirmed();
        return;
      }
      mobileSend.cancel();
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
      send_client_id: clientId,
    };
    if (!uploads.ids.length) chatTimingSendStart(clientId, event.timeStamp);
    const mobileSend = beginMobileSend(event.currentTarget.querySelector("textarea"), messagesRef.current);
    if (historyWindow.current) {
      sendReadHold.current = true;
      readIntentThrough.current = 0;
    }
    scrollOwner.dispatch({ type: "follow" });
    setMessages((current) => [...current, optimistic]);
    setBody("");

    setError("");
    setSendState("loading");
    const attachmentIds = uploads.ids;
    const failure = await deliverRoomMessage(optimistic, attachmentIds);
    if (!failure) {
      uploads.clear();
      messageRetry.current = null;
      mobileSend.confirmed();
      setSendState("default");
      return;
    }
    mobileSend.cancel();
    if (!attachmentIds.length) {
      // Text-only: keep it in place as "Not sent" so it doesn't look like it vanished.
      messageRetry.current = null;
      setSendState("default");
      return;
    }
    // With attachments the files stay in the composer, so the text goes back with them.
    setMessages((current) => current.filter((message) => message.id !== optimisticId));
    // The composer stays editable while sending, so never overwrite a newer draft.
    const newer = bodyRef.current.trim();
    if (newer) {
      setBody(`${nextBody}\n${bodyRef.current}`);
      setError(`${failure} Your unsent message was put back above your new text.`);
    } else {
      setBody(nextBody);
      setError(failure);
    }
    setSendState("error");
  }

  /** Posts a pending room message. Returns the failure reason, or null once it is sent. */
  async function deliverRoomMessage(
    pending: PublicChatMessage,
    attachmentIds: string[],
  ): Promise<string | null> {
    try {
      await waitForAttachments(attachmentIds);
      const result = await invokeGuest({
        room,
        action: "send",
        body: pending.body,
        attachmentIds,
        clientId: pending.send_client_id,
      });
      const sent = typeof result.message === "object" ? result.message : null;
      if (!sent?.id) throw new Error("That message was not sent.");
      setMessages((current) =>
        mergeRoomMessage(
          current.filter((message) => message.id !== pending.id),
          sent,
        ),
      );
      chatTimingSendShown(pending.send_client_id, sent.id, room);
      if (historyWindow.current) void refreshSentWindow();
      return null;
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "That message was not sent.";
      // Lost connection mid-send: move it to the outbox (same clientId) instead of "Not sent".
      if (
        !attachmentIds.length &&
        pending.send_client_id &&
        isNetworkError(caught) &&
        outbox.queue(pending.body, pending.send_client_id, pending.created_at)
      ) {
        setMessages((current) => current.filter((message) => message.id !== pending.id));
        return reason;
      }
      if (!attachmentIds.length)
        setMessages((current) =>
          current.map((message) =>
            message.id === pending.id ? { ...message, send_error: reason } : message,
          ),
        );
      return reason;
    }
  }
  retrySendRef.current = (message) => {
    if (!message.pending || !message.send_error || !message.send_client_id) return;
    if (isOutboxRow(message.id)) {
      // Queued messages retry together, oldest first.
      outbox.retry();
      return;
    }
    if (roomPaused) {
      setError(pauseNotice);
      return;
    }
    setMessages((current) =>
      current.map((row) => (row.id === message.id ? { ...row, send_error: undefined } : row)),
    );
    // The same clientId makes a retry idempotent: it can never post twice.
    void deliverRoomMessage(message, []);
  };

  const openPopout = useCallback(() => {
    setPopoutState("loading");
    const opened = openChatPopout(room);
    if (!opened) {
      setError("Your browser blocked the chat window. Allow popups and try again.");
      setPopoutState("error");
      return;
    }
    setPopoutState("success");
    timerRef.current = setTimeout(() => setPopoutState("default"), 1400);
  }, [room]);

  return (
    <main
      ref={mobilePage}
      className={`${styles.page} ${fontVariableClass}`}
      data-pane={!!pane}
      data-popout={popout}
      data-theme={theme}
      data-room={shortScoutRoom ? "shortscout" : room}
      data-chat-view={viewId}
    >
      <div
        className={styles.shell}
        data-reply-open={!!replyTarget && !inlineDm}
        data-nav-open={mobileNavOpen}
        data-dm-open={inlineDm}
        data-phone={phone || undefined}
        // Before the first check a phone already shows the list for plain /chat (no flash).
        data-phone-start={!phone && !hydrated && !pane && !popout && phoneList ? "list" : undefined}
      >
        {switcherOpen && !pane && (
          <RoomQuickSwitcher
            allowedRooms={allowedRooms}
            roomCounts={roomBadges}
            onClose={() => setSwitcherOpen(false)}
            onSelectRoom={(slug) => {
              setRoomSelection((value) => value + 1);
              setDmTarget(null);
              setSearchOpen(false);
              setMobileNavOpen(false);
              if (slug === room) return;
              saveSnapshot();
              onNavigate(slug);
            }}
            onSelectDm={(id) => {
              setSearchOpen(false);
              setMobileNavOpen(false);
              window.dispatchEvent(new CustomEvent("chat-open-dm", { detail: id }));
            }}
          />
        )}
        {!pane && (
          <RoomNav
            navRef={navRef}
            room={room}
            roomCaption={roomCaption}
            roomPaused={roomPaused}
            roomDenied={roomDenied}
            gainers={gainers}
            announcement={announcement}
            popout={popout}
            member={member}
            allowedRooms={allowedRooms}
            isAdmin={isAdmin}
            canLinkShortScout={canLinkShortScout}
            roomCounts={roomBadges}
            presenceReady={presenceReady}
            chatterCount={chatterCount}
            mobileReplies={mobileReplies}
            mobileNavOpen={mobileNavOpen}
            replyOpen={!!replyTarget}
            inlineDm={inlineDm}
            searchOpen={searchOpen}
            navigationBusy={sendState === "loading" || !!adminAction}
            saveSnapshot={saveSnapshot}
            onNavigate={onNavigate}
            onToggleSearch={toggleSearch}
            setSearchOpen={setSearchOpen}
            setMobileNavOpen={setMobileNavOpen}
            setRoomSelection={setRoomSelection}
            setDmTarget={setDmTarget}
            setDmSidebarHost={setDmSidebarHost}
            phone={phone}
            setListBarHost={setListBarHost}
            sheetOpen={infoOpen}
          />
        )}
        <section
          ref={chatRef}
          className={styles.chat}
          inert={infoOpen || (mobileReplies && ((!!replyTarget && !inlineDm) || mobileNavOpen))}
          aria-label={gainers ? "Gainers alerts" : shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"}
        >
          {!pane && (
            <ChatHeader
              inlineDm={inlineDm}
              navTrigger={navTrigger}
              room={room}
              roomLabel={roomLabel}
              dmView={dmView}
              gainers={gainers}
              announcement={announcement}
              shortScoutRoom={shortScoutRoom}
              roomPaused={roomPaused}
              presenceReady={presenceReady}
              chatterCount={chatterCount}
              popout={popout}
              popoutState={popoutState}
              openPopout={openPopout}
              loading={loading}
              openingReady={openingReady}
              skippingLatest={skippingLatest}
              jumpToLatest={jumpToLatest}
              searchOpen={searchOpen}
              mobileNavOpen={mobileNavOpen}
              member={member}
              accountId={accountId}
              displayName={displayName}
              identityStatus={identityStatus}
              featureChannel={featureChannel}
              activityData={activity.data}
              activityError={activity.error}
              readActivity={activity.read}
              isOwner={isOwner}
              adminOpen={adminOpen}
              setAdminOpen={setAdminOpen}
              hasSeparateShortScoutProfile={hasSeparateShortScoutProfile}
              canLinkShortScout={canLinkShortScout}
              serverSession={serverSession}
              loginHref={loginHref}
              theme={theme}
              setTheme={setTheme}
              saveSnapshot={saveSnapshot}
              onNavigate={onNavigate}
              setRoomSelection={setRoomSelection}
              setDmTarget={setDmTarget}
              setSearchOpen={setSearchOpen}
              setMobileNavOpen={setMobileNavOpen}
              setIdentityStatus={setIdentityStatus}
              setError={setError}
              setNameState={setNameState}
              phone={phone}
              phoneBack={phoneBack}
              infoOpen={sheet === "info"}
              openInfo={openInfo}
              openDmSettings={openDmSettings}
              infoTrigger={infoTrigger}
              listBarHost={listBarHost}
            />
          )}
          {phone && (
            // Swipe in from the left edge to go back to the list (UI-PHONE-NAV).
            <div
              className={styles.phoneEdge}
              aria-hidden="true"
              onPointerDown={swipeStart}
              onPointerMove={swipeMove}
              onPointerUp={swipeEnd}
              onPointerCancel={swipeEnd}
            />
          )}
          {offline && (
            <p className={styles.offlineBar} role="status" data-chat-offline>
              You’re offline. Messages you send now will go when you’re back.
            </p>
          )}

          {isOwner && adminOpen && !inlineDm ? (
            <AdminPanel roomLabel={roomLabel} roomPaused={roomPaused} admin={admin} />
          ) : null}

          <div ref={setDmConversationHost} className={styles.dmConversationHost} hidden={!inlineDm} />
          <div className={styles.searchPane} hidden={!searchOpen || inlineDm}>
            {(searchVisited || (searchOpen && !inlineDm)) && (
              <ChatSearch
                key={JSON.stringify([accountId, member?.id, room, allowedRooms])}
                room={room}
                allowedRooms={allowedRooms}
                onOpen={openSearchResult}
                canOpen={(slug) => slug === room || (!pane && allowedRooms.includes(slug as ChatRoom))}
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
                <NameGate
                  onSubmit={saveName}
                  nameDraft={nameDraft}
                  setNameDraft={setNameDraft}
                  nameState={nameState}
                  setNameState={setNameState}
                  error={error}
                  setError={setError}
                />
              ) : (
                <>
                  {/* A phone shows pinned messages in the room's info sheet. */}
                  {!phone && (
                    <RoomMessagePins
                      key={JSON.stringify([accountId, member?.id, room])}
                      collapsible={!!pane}
                      pins={roomPins.pins}
                      controls={pinControls}
                      onOpen={(pin, trigger) => void openPinnedMessage(pin, trigger)}
                      error={roomPins.error || pinJumpError}
                    />
                  )}
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
                      scrollOwner.remember(node);
                      const next = chatPaneFollowingScroll(
                        node,
                        scrollOwner.following(),
                        scrollIntent.current,
                      );
                      if (scrollOwner.following() !== next.following) {
                        awaySeq.current = next.following ? Infinity : maxSeq;
                        scrollOwner.dispatch({ type: next.following ? "follow" : "read" });
                      }
                      farFromBottom.current =
                        node.scrollHeight - node.scrollTop - node.clientHeight > node.clientHeight * 1.5;
                      scrollIntent.current = next.intent;
                      if (next.direction) {
                        readIntent(event.target);
                        resumeLive.current = next.direction === "down" && next.following;
                        if (resumeLive.current && historyWindow.current) updates.invalidate("history");
                        const autoload = historyAutoload(node, next.direction, {
                          ...historyPage,
                          busy: paging || loading || Date.now() < autoloadPause.current,
                        });
                        if (autoload) void pageHistory(autoload);
                      }
                      // Re-render only when an input of the read marker changes, not on every scroll frame.
                      const signature = `${scrollOwner.following()}:${chatPaneAtBottom(node)}:${farFromBottom.current}:${openingCancelled.current}:${openingMoved.current}`;
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
                      <button
                        type="button"
                        className={styles.historyButton}
                        disabled={paging}
                        onClick={() => void pageHistory("before")}
                      >
                        {paging ? "Loading…" : "Earlier messages"}
                      </button>
                    )}
                    <RoomMessageList
                      loading={loading}
                      messages={outboxMessages}
                      limit={rowLimit}
                      windowed={!!historyWindow.current}
                      searchOpen={searchOpen}
                      onToggleSearch={toggleSearch}
                      room={room}
                      roomLabel={roomLabel}
                      gainers={gainers}
                      recordings={recordings}
                      announcement={announcement}
                      themeReady={themeReady}
                      unreadStart={unreadStart}
                      loadedAt={loadedAt.current}
                      pinControls={pinControls}
                      member={member}
                      guestId={guestId}
                      isAdmin={isAdmin}
                      roomPaused={roomPaused}
                      readOnlyAnnouncement={readOnlyAnnouncement}
                      replyCounts={replyCounts}
                      replyThreads={replyThreads}
                      replyTarget={replyTarget}
                      reactionsActive={reactionsActive}
                      mentionNames={mentionNames}
                      onPrivateMessage={openPrivateMessage}
                      onReply={openMessageReplies}
                      onEdited={editMessage}
                      onDeleted={deleteMessage}
                      onRetrySend={retrySend}
                      onDiscardSend={discardSend}
                    />
                    {historyPage.hasNewer && (
                      <button
                        type="button"
                        className={styles.historyButton}
                        disabled={paging}
                        onClick={() => void pageHistory("after")}
                      >
                        {paging ? "Loading…" : "Newer messages"}
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
                      following: scrollOwner.following(),
                      // Read only when it decides anything (not following the newest page):
                      // reading it lays the list out in the middle of a render.
                      atBottom:
                        !node || historyPage.hasNewer || scrollOwner.following() || chatPaneAtBottom(node),
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
                  {listError && (
                    <p className={styles.feedback} data-chat-list-error data-error="true" role="status">
                      {listError}
                    </p>
                  )}
                  {connectionError && (
                    <p className={styles.feedback} data-chat-connection data-error="true" role="status">
                      {connectionError}
                    </p>
                  )}
                  {identityStatus === "ready" && !roomPaused && !readOnlyAnnouncement ? (
                    <RoomComposer
                      onSubmit={sendMessage}
                      uploads={uploads}
                      composerRef={composerRef}
                      body={body}
                      setBody={setBody}
                      hasDraft={hasDraft}
                      sendState={sendState}
                      setSendState={setSendState}
                      error={error}
                      setError={setError}
                      feedback={feedback}
                      messages={messages}
                      member={member}
                      displayName={displayName}
                      room={room}
                      roomLabel={roomLabel}
                      pane={!!pane}
                      recordings={recordings}
                      announcement={announcement}
                    />
                  ) : !gainers ? (
                    <div className={styles.readOnlyFooter}>
                      <strong>
                        {readOnlyAnnouncement && !roomPaused ? "Admin posts only" : "Read-only"}
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
        {!pane && infoOpen && (
          <PhoneInfoSheet
            phone={phone}
            dm={sheet === "dm-settings" ? "settings" : inlineDm}
            title={
              sheet === "dm-settings" ? "DM settings" : inlineDm ? (dmView ?? "Direct message") : roomTitle
            }
            subtitle={
              sheet === "dm-settings"
                ? "Sounds and message requests for all your DMs"
                : inlineDm
                  ? "Direct message"
                  : `${roomCaption} · ${roomPresence}`
            }
            member={member}
            room={room}
            roomLabel={roomLabel}
            pins={roomPins.pins}
            pinControls={pinControls}
            pinError={roomPins.error || pinJumpError}
            onlineIds={onlineMemberIds}
            presenceReady={presenceReady}
            isOwner={isOwner}
            adminOpen={adminOpen}
            setAdminOpen={setAdminOpen}
            onClose={closeInfo}
            onOpenPin={(pin) => {
              // The info button takes focus back, so the pinned message can take it from there.
              if (infoTrigger.current) void openPinnedMessage(pin, infoTrigger.current);
            }}
            onSelectMember={(target) => setDmTarget(target)}
            onSearch={() => {
              setRoomSelection((value) => value + 1);
              setDmTarget(null);
              setSearchOpen(true);
            }}
            onLatest={jumpToLatest}
            setDmSettingsHost={setDmSettingsHost}
            setDmGlobalHost={setDmGlobalHost}
          />
        )}
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
            pinJump={pinReplyJump?.messageId === replyTarget ? pinReplyJump : undefined}
            focusReply={threadJump?.parentId === replyTarget ? threadJump.messageId : undefined}
            pinControls={pinControls}
            notificationActive={
              pane?.visible !== false && pane?.active !== false && !searchOpen && !mobileNavOpen
            }
            isolated={!!pane}
            key={`${member?.id ?? "anonymous"}:${room}:${replyTarget}${threadJump?.parentId === replyTarget ? `:${threadJump.request}` : ""}`}
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

const RoomView = memo(PublicChatContent);

export default function PublicChat(props: PublicChatProps) {
  const sharedUpdates = useChatUpdates();
  const sharedIdentity = useChatIdentity();
  const navigationOwner = useId();
  const dmSkipLatest = useRef<(() => void) | null>(null);
  const [cache] = useState(() => new ChatRoomCache(props.accountId ?? ""));
  const [selection, setSelection] = useState<RoomSelection>({
    room: props.room,
    snapshot: null,
    initial: true,
    id: 0,
  });
  // SHELL-KEEP: the room left last stays mounted (hidden) for an instant switch back.
  const [kept, setKept] = useState<KeptRoom | null>(null);
  const selectionId = useRef(0);
  const keptNow = useRef(kept);
  keptNow.current = kept;
  const selectionNow = useRef(selection);
  selectionNow.current = selection;
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
  // BUG-DM-OPEN-READS-ROOM: a /chat?dm= link (what a DM push notification opens) shows the DM only
  // once the inbox list has loaded. Until the link resolves the room underneath is not what the
  // member is looking at, so it is not marked read.
  const [dmLink, setDmLink] = useState(
    () =>
      !props.pane && typeof window !== "undefined" && new URL(window.location.href).searchParams.has("dm"),
  );
  useEffect(() => {
    if (dmView !== null) setDmLink(false);
  }, [dmView]);
  const onLinkedConversation = useCallback((opened: boolean) => {
    if (!opened) setDmLink(false);
  }, []);
  const [roomSelection, setRoomSelection] = useState(0),
    [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dmSidebarHost, setDmSidebarSlot] = useState<HTMLDivElement | null>(null),
    [dmConversationHost, setDmConversationHost] = useState<HTMLDivElement | null>(null),
    [dmSettingsHost, setDmSettingsHost] = useState<HTMLDivElement | null>(null),
    [dmGlobalHost, setDmGlobalHost] = useState<HTMLDivElement | null>(null);
  // UI-PHONE-NAV: on a phone the room list (the mobile navigation) is the home screen and
  // mobileNavOpen means "showing the list". History entries say which screen they show.
  const [phone, setPhone] = useState(false);
  const phoneRef = useRef(false);
  // Plain /chat opens on the list; after the first check the page is in a conversation.
  const initialPhoneList = useRef(props.phoneList === true);
  useEffect(() => {
    initialPhoneList.current = false;
  }, []);
  useLayoutEffect(() => {
    if (props.pane || props.popout) return;
    const media = window.matchMedia(CHAT_PHONE_QUERY);
    let first = true;
    const update = () => {
      phoneRef.current = media.matches;
      setPhone(media.matches);
      if (!media.matches || !first) return;
      first = false;
      // The first time this page is a phone: put the list under the conversation, so back
      // from a deep link or notification returns to it. A reload keeps the entries it has.
      if (!chatPhoneScreen(window.history.state)) {
        const deepLink = !initialPhoneList.current || chatPhoneDeepLink(window.location.href);
        window.history.replaceState(withChatPhoneScreen(window.history.state, "list"), "");
        if (deepLink) window.history.pushState(withChatPhoneScreen(window.history.state, "conversation"), "");
      }
      setMobileNavOpen(chatPhoneScreen(window.history.state) !== "conversation");
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [props.pane, props.popout]);
  useEffect(() => {
    if (props.pane || props.popout) return;
    const restore = () => {
      // Hash-only entries carry no state; they stay on the screen that is showing.
      const screen = chatPhoneScreen(window.history.state);
      if (phoneRef.current && screen) setMobileNavOpen(screen === "list");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [props.pane, props.popout]);
  // Opening a conversation from the list adds one history entry, so back returns to the list.
  // The entry carries the room's own URL (/chat?room=…), as on a computer.
  useEffect(() => {
    if (!phone || mobileNavOpen || chatPhoneScreen(window.history.state) === "conversation") return;
    const open = selection.room;
    const roomUrl =
      new URL(window.location.href).searchParams.get("room") === open ? undefined : `/chat?room=${open}`;
    window.history.pushState(withChatPhoneScreen(window.history.state, "conversation"), "", roomUrl);
  }, [phone, mobileNavOpen, selection.room]);
  const phoneBack = useCallback(() => {
    if (chatPhoneScreen(window.history.state) === "conversation") window.history.back();
    else setMobileNavOpen(true);
  }, []);
  const navTrigger = useRef<HTMLButtonElement>(null);
  const room = selection.room;
  const [currentRooms, setCurrentRooms] = useState(props.allowedRooms);
  // DEVICE-STORE: this member's recent rooms and DMs kept on the device (lib/chatDeviceStore.ts).
  // Read once in idle time after the page starts; a switch to a room held here draws at once.
  const deviceOwner = props.pane ? "" : chatDeviceOwner(props.accountId, member?.id);
  const deviceRooms = useRef(new Map<ChatRoom, DeviceRoom>());
  const [deviceContents, setDeviceContents] = useState<DeviceContents | null>(null);
  const roomsNow = useRef(currentRooms);
  roomsNow.current = currentRooms;
  const roomsUpdated = useCallback(
    (rooms: ChatRoom[]) =>
      setCurrentRooms((previous) => (previous?.join() === rooms.join() ? previous : rooms)),
    [],
  );
  const revoked = useRef(false);
  useEffect(() => {
    const store = deviceOwner ? chatDeviceStore() : null;
    if (!store) return;
    let live = true;
    const start = () => {
      const rooms = roomsNow.current;
      void store.load(deviceOwner, rooms).then((contents) => {
        if (!live || revoked.current) return;
        if (rooms) store.retainRooms(deviceOwner, rooms);
        deviceRooms.current = contents.rooms;
        setDeviceContents(contents);
      });
    };
    const handle =
      "requestIdleCallback" in window
        ? window.requestIdleCallback(start, { timeout: 1000 })
        : setTimeout(start, 200);
    return () => {
      live = false;
      if ("cancelIdleCallback" in window) window.cancelIdleCallback(handle as number);
      clearTimeout(handle as ReturnType<typeof setTimeout>);
      deviceRooms.current = new Map();
      setDeviceContents(null);
    };
  }, [deviceOwner]);
  useEffect(() => {
    if (!deviceOwner || !currentRooms) return;
    chatDeviceStore()?.retainRooms(deviceOwner, currentRooms);
    for (const slug of deviceRooms.current.keys())
      if (!currentRooms.includes(slug)) deviceRooms.current.delete(slug);
  }, [deviceOwner, currentRooms]);
  /** Server-fresh newest messages of a room (null: the member can no longer read it). */
  const persistRoom = useCallback(
    (slug: ChatRoom, owner: string, data: DeviceRoom | null, urgent = false) => {
      if (revoked.current || !deviceOwner || owner !== deviceOwner) return;
      const store = chatDeviceStore();
      if (!data) {
        deviceRooms.current.delete(slug);
        store?.dropRoom(deviceOwner, slug);
        return;
      }
      const stored = deviceRoomData(data);
      if (stored.messages.length) deviceRooms.current.set(slug, stored);
      else deviceRooms.current.delete(slug);
      store?.putRoom(deviceOwner, slug, data, urgent);
    },
    [deviceOwner],
  );
  const save = useCallback(
    (snapshot: RoomSnapshot) => {
      if (!revoked.current) cache.set(snapshot.bootstrap.room, snapshot);
    },
    [cache],
  );
  const clearSession = useCallback(() => {
    revoked.current = true;
    cache.clear();
    deviceRooms.current = new Map();
    setDeviceContents(null);
    keptNow.current = null;
    setKept(null);
    void clearChatDeviceStore();
    try {
      clearChatDrafts(window.sessionStorage);
    } catch {}
    setMember(null);
    setDmTarget(null);
    setDmView(null);
  }, [cache, setMember]);
  const deviceSnapshot = useCallback(
    (next: ChatRoom): RoomSnapshot | null => {
      const stored = deviceOwner && !revoked.current ? deviceRooms.current.get(next) : undefined;
      if (!stored || !props.accountId || (roomsNow.current && !roomsNow.current.includes(next))) return null;
      return {
        bootstrap: {
          accountId: props.accountId,
          room: next,
          member: null,
          roomState: stored.roomState,
          messages: stored.messages,
          reactions: stored.reactions,
          counts: stored.counts,
          featureChannel: stored.featureChannel,
        },
        draft: "",
        scroll: 0,
        pinned: true,
      };
    },
    [deviceOwner, props.accountId],
  );
  const select = useCallback(
    (next: ChatRoom, closeNavigation = true) => {
      const leaving = selectionNow.current;
      const snapshot = cache.get(next);
      const previous = keptNow.current;
      if (leaving.room === next) {
        // Same room: the same mounted view (as before, when the view was keyed by room).
        setSelection({ ...leaving, snapshot: snapshot ?? deviceSnapshot(next), initial: false });
      } else {
        // Back to the room left last: show its kept view again (no new mount) while its kept copy
        // is the room's newest messages, recent, and the room is still allowed.
        const reuse =
          previous?.selection.room === next &&
          !revoked.current &&
          !!snapshot?.bootstrap.messages.length &&
          performance.now() - previous.at < KEPT_ROOM_MS &&
          (!roomsNow.current || roomsNow.current.includes(next));
        setSelection(
          reuse
            ? previous.selection
            : {
                room: next,
                snapshot: snapshot ?? deviceSnapshot(next),
                initial: false,
                id: ++selectionId.current,
              },
        );
        // The page's first room view is never kept: it hydrates the server's HTML, which it must do
        // outside an <Activity> (React hydrates those later, after the page's data has changed).
        const keep =
          !props.pane && !revoked.current && leaving.id !== 0
            ? { selection: leaving, at: performance.now() }
            : null;
        keptNow.current = keep;
        setKept(keep);
      }
      setRoomSelection((v) => v + 1);
      setDmTarget(null);
      setDmView(null);
      setDmLink(false);
      if (closeNavigation) setMobileNavOpen(false);
    },
    [cache, deviceSnapshot, props.pane],
  );
  useEffect(() => {
    if (props.pane) return;
    const restore = () => {
      // Back to a phone's list keeps the last conversation mounted underneath (draft, scroll).
      if (phoneRef.current && chatPhoneScreen(window.history.state) === "list") return;
      const next = parseChatRoom(new URL(window.location.href).searchParams.get("room"));
      // On a phone the entry's own screen (list or conversation) decides what shows.
      if (next && currentRooms?.includes(next) && next !== room) select(next, !phoneRef.current);
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
  useEffect(() => {
    if (kept && currentRooms && !currentRooms.includes(kept.selection.room)) setKept(null);
  }, [kept, currentRooms]);
  const mobileNavOpenNow = useRef(mobileNavOpen);
  mobileNavOpenNow.current = mobileNavOpen;
  // Stable, like the rest of what the room views get: a kept (hidden) room view then skips the
  // page's re-renders (SHELL-KEEP).
  const navigate = useCallback(
    (next: ChatRoom) => {
      const href = `/chat?room=${next}${props.popout ? "&popout=1" : ""}`;
      if (phoneRef.current) {
        // Phone: one conversation entry above the list; switching from one room to another
        // replaces it, so back always returns to the list.
        const state = withChatPhoneScreen({ ...window.history.state, chatReply: undefined }, "conversation");
        if (mobileNavOpenNow.current) window.history.pushState(state, "", href);
        else window.history.replaceState(state, "", href);
      } else window.history.pushState({ ...window.history.state, chatReply: undefined }, "", href);
      select(next);
    },
    [props.popout, select],
  );
  const onDmViewChange = useCallback((name: string | null) => {
    setDmView(name);
    if (name) setMobileNavOpen(false);
  }, []);
  const onTargetClosed = useCallback(() => setDmTarget(null), []);
  // SHELL-KEEP: the DM list renders into one lasting node that moves into the navigation of the
  // room view on screen, so a room switch moves it instead of building it again.
  const [dmSidebarNode] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );
  const setDmSidebarHost = useCallback(
    (slot: HTMLDivElement | null) => {
      if (!slot || !dmSidebarNode) {
        setDmSidebarSlot(slot);
        return;
      }
      slot.appendChild(dmSidebarNode);
      setDmSidebarSlot(dmSidebarNode);
      return () => {
        if (dmSidebarNode.parentNode !== slot) return;
        slot.removeChild(dmSidebarNode);
        setDmSidebarSlot(null);
      };
    },
    [dmSidebarNode],
  );
  const bridge = useMemo(
    () => ({
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
      phone,
      phoneRef,
      phoneBack,
      setDmSettingsHost,
      dmLinkPending: dmLink && !!member,
      setDmGlobalHost,
    }),
    [
      navigationOwner,
      dmView,
      roomSelection,
      dmTarget,
      dmSidebarHost,
      setDmSidebarHost,
      dmConversationHost,
      setMember,
      mobileNavOpen,
      phone,
      phoneBack,
      dmLink,
      member,
    ],
  );
  // Each room view's bootstrap, rebuilt only when what it is made of changes.
  const viewBootstraps = useRef(
    new Map<
      number,
      { member: ChatMember | null; from: ChatBootstrap | undefined; value: ChatBootstrap | undefined }
    >(),
  );
  const roomView = (view: RoomSelection, shown: boolean) => {
    const from = view.snapshot?.bootstrap ?? props.bootstrap;
    let made = viewBootstraps.current.get(view.id);
    if (!made || made.member !== member || made.from !== from) {
      const value = view.snapshot
        ? { ...view.snapshot.bootstrap, member }
        : view.initial && props.bootstrap?.room === view.room
          ? { ...props.bootstrap, member }
          : props.bootstrap
            ? { ...props.bootstrap, member, room: view.room, messages: [], reactions: [], counts: {} }
            : undefined;
      made = { member, from, value };
      viewBootstraps.current.set(view.id, made);
    }
    for (const id of viewBootstraps.current.keys())
      if (id !== selection.id && id !== kept?.selection.id) viewBootstraps.current.delete(id);
    const bootstrap = made.value;
    const content = (
      <RoomView
        viewId={view.id}
        cold={!view.initial && !view.snapshot}
        {...props}
        room={view.room}
        bootstrap={bootstrap}
        snapshot={view.snapshot}
        onSnapshot={save}
        deviceOwner={deviceOwner}
        onDeviceSave={persistRoom}
        onNavigate={navigate}
        onRoomsUpdated={roomsUpdated}
        clearSession={clearSession}
      />
    );
    return view.id === 0 ? (
      <ReactModule.Fragment key={0}>{content}</ReactModule.Fragment>
    ) : (
      <Activity key={view.id} mode={shown ? "visible" : "hidden"}>
        {content}
      </Activity>
    );
  };
  // The room on screen comes first in the document, so lookups by id or label find it, not the
  // kept one. It is the one moved: shown again (or new) it has no layout yet, so moving it is
  // cheap; React moving the room just hidden would move its whole laid-out page. Insertion effects
  // run after this commit's DOM changes and before anything is laid out.
  const shownView = selection.id,
    keptView = kept?.selection.id;
  useInsertionEffect(() => {
    if (keptView === undefined || keptView === shownView) return;
    const shown = document.querySelector(`main[data-chat-view="${shownView}"]`),
      hidden = document.querySelector(`main[data-chat-view="${keptView}"]`);
    if (
      shown &&
      hidden &&
      shown.parentNode === hidden.parentNode &&
      hidden.compareDocumentPosition(shown) & Node.DOCUMENT_POSITION_FOLLOWING
    )
      hidden.parentNode!.insertBefore(shown, hidden);
  }, [shownView, keptView]);
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
                {props.accountId && <ChatPushPromptSheet />}
              </>
            )}
            {/* In mount order, so React never moves a room view (moving one is costly); the
                effect above puts the one on screen first in the document instead. */}
            {kept && kept.selection.id < selection.id && roomView(kept.selection, false)}
            {roomView(selection, true)}
            {kept && kept.selection.id > selection.id && roomView(kept.selection, false)}
            {member && (!props.pane || props.pane.conversationId) && (
              <DirectInbox
                notificationActive={props.pane?.active !== false}
                skipLatestRef={dmSkipLatest}
                controlledConversation={props.pane?.conversationId}
                key={member.id}
                member={member}
                deviceOwner={deviceOwner}
                deviceContents={deviceContents}
                target={dmTarget}
                onTargetClosed={onTargetClosed}
                fallbackFocus={navTrigger}
                sidebarHost={dmSidebarHost}
                conversationHost={dmConversationHost}
                conversationVisible={!mobileNavOpen && props.pane?.visible !== false}
                settingsHost={props.pane ? undefined : dmSettingsHost}
                globalSettingsHost={props.pane ? undefined : dmGlobalHost}
                showDrafts={phone}
                roomSelection={roomSelection}
                onViewChange={onDmViewChange}
                onLinkedConversation={props.pane ? undefined : onLinkedConversation}
                onConversations={props.pane ? undefined : publishDmList}
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
