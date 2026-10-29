"use client";
import { chatTypingDmChannel } from "@/lib/chatTyping";
import TypingIndicator from "./TypingIndicator";
import { useTypingSender } from "./room/useTyping";
import { useVisibleChatNotifications } from "./hooks/useVisibleChatNotifications";
import { useChatScrollIntent } from "./hooks/useChatScrollIntent";
import ComposerLinkPreview from "./ComposerLinkPreview";
import ComposerSend from "./ComposerSend";
import composerStyles from "./ChatComposer.module.css";
import {
  chatPaneVisible,
  chatPaneFollowingScroll,
  chatPaneScrollIntent,
  chatScrollPointer,
  chatScrollKey,
  type ChatScrollIntent,
  watchChatPaneLayout,
} from "@/lib/chatScrollFollow";
import ChatFavorite from "./ChatFavorite";
import ChatPins from "./ChatPins";
import {
  mergeConfirmedMessages,
  pendingForScope,
  reconcilePendingMessages,
  type PendingChatMessage,
} from "@/lib/chatPendingMessages";
import { ChatDmCache } from "@/lib/chatDmCache";
import { chatDeviceStore, type DeviceContents } from "@/lib/chatDeviceStore";
import MessageReactions from "./MessageReactions";

import { beginMobileSend } from "@/lib/chatMobileSend";
import { waitForAttachments } from "@/lib/chatAttachmentWaits";
import {
  addToOutbox,
  browserOutboxStore,
  flushOutbox,
  isNetworkError,
  outboxKey,
  readOutbox,
  removeFromOutbox,
  withOutboxLock,
  type OutboxItem,
} from "@/lib/chatOutbox";
import { useChatRefreshGuard } from "./hooks/useChatRefreshGuard";
import VoiceRecorder from "./VoiceRecorder";
import {
  canReply,
  type ChatMember,
  type DirectConversation,
  type DirectMessage,
} from "@/lib/chatDirectMessages";
import { handleChatKeyDown } from "@/lib/chatKeyboard";
import { chatTimestamp, chatTimestampTitle } from "@/lib/chatTimestamp";
import type { ChatUpdateCoordinator } from "@/lib/chatUpdateCoordinator";
import {
  FormEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useId,
  Fragment,
} from "react";
import { createPortal } from "react-dom";
import { readChatDraft } from "@/lib/chatRefreshDrafts";
import { AttachmentPicker } from "./ChatAttachments";
import { GifComposer } from "./ChatGif";
import ChatMessageBody from "./ChatMessageBody";
import { useChatUpdates, useChatSelfName } from "./ChatUpdates";
import DirectAttachments from "./DirectAttachments";
import styles from "./DirectInbox.module.css";
import SendingMark from "./SendingMark";
import ChatIcon from "./ChatIcon";
import { chatMessagePlacement } from "@/lib/chatTimestamp";
import { resetChatRowWindow, watchChatRowWindow } from "@/lib/chatRowWindow";
import DirectMessageActions from "./DirectMessageActions";
import UnreadStart from "./UnreadStart";
import { watchPinnedMessageIntent } from "@/lib/chatPinnedMessageJump";
import DirectMessageCopy from "./DirectMessageCopy";
import { ClarityOriginalNote, ClarityReview } from "./ClarityReview";
import { ClarityDictate, type ClarityDictateHandle } from "./ClarityDictate";
import { useClarity } from "./hooks/useClarity";
import clarityStyles from "./ClarityReview.module.css";
import { useDmSound } from "./hooks/useDmSound";
import { isDmChoice } from "@/lib/dmSound";
import { useAttachments } from "./hooks/useAttachments";
import { FoldHeading, useSidebarFolds } from "./SidebarFold";

const EMPTY_DIRECT_MESSAGES: DirectMessage[] = [];
type Target = { id: string; name: string };
type InboxResult = {
  conversations?: DirectConversation[];
  messages?: DirectMessage[];
  hasMore?: boolean;
  hasNewer?: boolean;
  conversationId?: string;
  message?: DirectMessage | null;
};
class InboxError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function requestInbox(
  body?: Record<string, unknown>,
  query = "",
  updates?: ChatUpdateCoordinator | null,
): Promise<InboxResult> {
  const response = await (!body && updates
    ? updates.read(`/api/chat/inbox${query}`)
    : fetch(
        `/api/chat/inbox${query}`,
        body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : { cache: "no-store" },
      ));
  const result = await response.json();
  if (!response.ok)
    throw new InboxError(result.error || "Your inbox could not load. Please try again.", response.status);
  return result;
}

function waitingRow(ownerId: string, item: OutboxItem): PendingChatMessage {
  return {
    ownerId,
    scope: `conversation:${item.target}`,
    clientId: item.clientId,
    action: "send",
    targetId: item.target,
    body: item.body,
    attachmentIds: [],
    createdAt: item.createdAt,
    status: "waiting",
    stored: true,
  };
}

export default function DirectInbox({
  notificationActive = true,
  skipLatestRef,
  controlledConversation,
  member,
  target,
  onTargetClosed,
  fallbackFocus,
  sidebarHost,
  conversationHost,
  conversationVisible = true,
  roomSelection = 0,
  onViewChange,
  onLinkedConversation,
  onConversations,
  settingsHost,
  globalSettingsHost,
  showDrafts = false,
  deviceOwner = "",
  deviceContents = null,
  foldable = false,
}: {
  /** D-324: the list's "Direct messages" heading folds the list (the chat's left column only). */
  foldable?: boolean;
  /** DEVICE-STORE: this member's device copy (account:member), or "" when not kept. */
  deviceOwner?: string;
  /** The conversation list this device kept (no message text), once read (lib/chatDeviceStore.ts). */
  deviceContents?: DeviceContents | null;
  /** SIDEBAR-REST: sounds and message requests for all DMs render in the DM settings sheet
   * (null: the sheet is closed); undefined keeps them in the list. */
  globalSettingsHost?: HTMLElement | null;
  /** UI-PHONE-NAV: a phone shows the open conversation's settings in its info sheet (null: closed). */
  settingsHost?: HTMLElement | null;
  /** UI-PHONE-NAV: list rows show an unsent draft ("Draft: …") before the last message. */
  showDrafts?: boolean;
  /** The current DM list, for the quick switcher; reuses what this inbox already loaded. */
  onConversations?: (rows: Array<{ id: string; name: string; unread: number }>) => void;
  notificationActive?: boolean;
  skipLatestRef?: RefObject<(() => void) | null>;
  controlledConversation?: string;
  member: ChatMember;
  target: Target | null;
  onTargetClosed: () => void;
  fallbackFocus?: RefObject<HTMLButtonElement | null>;
  sidebarHost?: HTMLElement | null;
  conversationHost?: HTMLElement | null;
  conversationVisible?: boolean;
  roomSelection?: number;
  onViewChange?: (name: string | null) => void;
  /** The ?dm= link (if any) was checked against the loaded list: whether it opened a conversation. */
  onLinkedConversation?: (opened: boolean) => void;
}) {
  const generatedId = useId();
  const inputId = controlledConversation ? `dm-${generatedId}` : "dm-body";
  const sounds = useDmSound(member.id, !controlledConversation);
  const sidebarFolds = useSidebarFolds(member.id);
  const listFolded = foldable && sidebarFolds.folded.has("dms");
  const observeSounds = sounds.observe;
  const updates = useChatUpdates();
  const selfName = useChatSelfName(member.id, member) ?? member.display_name;
  const inbox = useCallback(
    (body?: Record<string, unknown>, query = "") => requestInbox(body, query, updates),
    [updates],
  );
  const [open, setOpen] = useState(false);
  const [stateOwner, setStateOwner] = useState(member.id);
  const [conversationRows, setConversations] = useState<DirectConversation[]>([]);
  const conversations = stateOwner === member.id ? conversationRows : [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recipientState, setRecipient] = useState<Target | null>(null);
  const recipient = stateOwner === member.id ? recipientState : null;
  const [messageRows, setMessages] = useState<DirectMessage[]>([]);
  const messages = stateOwner === member.id ? messageRows : EMPTY_DIRECT_MESSAGES;
  const messagesRef = useRef<DirectMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraftState] = useState("");
  const draftRef = useRef("");
  const setDraft = useCallback((value: string) => {
    draftRef.current = value;
    setDraftState(value);
  }, []);
  const cache = useRef(new ChatDmCache(member.id));
  // DEVICE-STORE: only this member's copy is ever used (the owner names account and member).
  // Only the conversation list is kept, never message text: a DM deleted on either side must not
  // draw again from this device before the server answers.
  const deviceKeep = deviceOwner && deviceOwner.endsWith(`:${member.id}`) ? deviceOwner : "";
  const keptList = deviceKeep && deviceContents?.owner === deviceKeep ? deviceContents.dms : null;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const [unreadStart, setUnreadStart] = useState<string | null>(null);
  const opening = useRef(false),
    openingTarget = useRef<string | null>(null),
    openingCancelled = useRef(false);
  const hasNewerRef = useRef(false),
    gapCursor = useRef<number | null>(null);
  const [hasNewer, setHasNewer] = useState(false);
  const [readVisibility, setReadVisibility] = useState(0);
  const cancelOpening = () => {
    if (openingTarget.current) setUnreadStart(null);
    // A gesture alone is not reading: only real upward movement (onScroll) stops following,
    // so a no-op wheel/touch while the pane is still opening keeps it at the newest message.
    openingCancelled.current = true;
    openingTarget.current = null;
  };
  const nearBottom = useRef(true);
  const scrollIntent = useRef<ChatScrollIntent | null>(null);
  useChatScrollIntent(scrollIntent);
  const skipIntentCleanup = useRef<(() => void) | null>(null),
    skipReveal = useRef(false);
  useEffect(() => () => skipIntentCleanup.current?.(), []);
  const skipPending = useRef<{ id: string; selection: number } | null>(null),
    skipFailure = useRef("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [acceptsRequests, setAcceptsRequests] = useState(member.accepts_requests);
  const [listReady, setListReady] = useState(false);
  const openRef = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const voiceStart = useRef<(() => void) | null>(null);
  const focusedConversation = useRef<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const selected = useRef<string | null>(null);
  const readId = useRef("");
  const loadVersion = useRef(0);
  const historyLoaded = useRef(false);
  // Opening belongs to a selection, not to message refresh/edit/ACK revisions.
  const openingVersion = useRef(0);
  const openingUpdates = useRef<DirectMessage[]>([]);
  const listVersion = useRef(0);
  const [outbox, setOutbox] = useState<PendingChatMessage[]>([]);
  const outboxRef = useRef<PendingChatMessage[]>([]);
  const inFlight = useRef(new Set<string>());
  const owner = useRef(member.id);
  owner.current = member.id;
  const scopeRef = useRef<string | null>(null);
  const draftVersion = useRef(0),
    consumedDraft = useRef("");
  const scope =
    stateOwner !== member.id
      ? null
      : recipient
        ? `request:${recipient.id}`
        : activeId
          ? `conversation:${activeId}`
          : null;
  scopeRef.current = scope;
  const localRows = pendingForScope(outbox, member.id, scope);
  const requestQueued = Boolean(recipient && localRows.length);
  const updateOutbox = useCallback((change: (rows: PendingChatMessage[]) => PendingChatMessage[]) => {
    outboxRef.current = change(outboxRef.current);
    setOutbox(outboxRef.current);
  }, []);
  const alive = useRef(true);
  const active = conversations.find((c) => c.id === activeId);
  const uploads = useAttachments({ conversationId: activeId });
  const dmTypingChannel = !recipient && active && canReply(active) ? chatTypingDmChannel(active.id) : null;
  const onDmTyping = useTypingSender(dmTypingChannel);
  // Liz <-> Rob "Make clearer": the server decides availability (404 for every other DM).
  const dictation = useRef<ClarityDictateHandle>(null);
  const [dictating, setDictating] = useState(false);
  const clarity = useClarity(
    active && !active.system && active.status === "accepted" && !recipient ? active.id : null,
    draft,
  );
  useChatRefreshGuard(
    member.id,
    scope,
    draft,
    setDraft,
    uploads.blocked ||
      uploads.files.length > 0 ||
      busy ||
      // An open or running "Make clearer" review isn't saved across a reload.
      !!clarity.review ||
      clarity.busy ||
      // Waiting (offline) rows are kept on the device, so a reload doesn't lose them.
      outbox.some((row) => row.status !== "sent" && row.status !== "waiting") ||
      report !== null,
    () => {
      if (controlledConversation || !open || !activeId) return;
      const url = new URL(window.location.href);
      url.searchParams.set("dm", activeId);
      url.searchParams.delete("thread");
      window.history.replaceState(window.history.state, "", url);
    },
  );
  const badge = conversations.reduce((sum, c) => sum + (c.unavailable ? 0 : c.unread), 0);
  useEffect(() => {
    onConversations?.(
      conversations
        .filter((c) => !c.unavailable && c.status !== "declined")
        .map((c) => ({ id: c.id, name: c.otherName, unread: c.unread })),
    );
  }, [conversations, onConversations]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    onViewChange?.(open ? (recipient?.name ?? active?.otherName ?? "Direct messages") : null);
  }, [open, recipient?.name, active?.otherName, onViewChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    cache.current.reset(member.id);
    setStateOwner(member.id);
    outboxRef.current = [];
    setOutbox([]);
    setMessages([]);
    messagesRef.current = [];
    setConversations([]);
    setActiveId(null);
    selected.current = null;
    setRecipient(null);
    setDraft("");
    setListReady(false);
    loadVersion.current++;
    openingVersion.current++;
    listVersion.current++;
    draftVersion.current++;
  }, [member.id, setDraft]);
  useEffect(() => {
    // The kept list draws until the server's arrives; it is replaced, never merged.
    if (!keptList?.length || listReady) return;
    setConversations((current) => (current.length ? current : keptList));
  }, [keptList, listReady]);
  const observedNames = useRef(new Map<string, string>());
  useEffect(() => {
    observedNames.current.clear();
  }, [member.id]);
  const latestList = useRef<Promise<DirectConversation[]> | null>(null);
  const loadList = useCallback(
    async (run: { promise?: Promise<DirectConversation[]> }) => {
      const version = ++listVersion.current;
      let result: InboxResult;
      try {
        result = await inbox();
      } catch (e) {
        if (e instanceof InboxError && [401, 403].includes(e.status) && owner.current === member.id) {
          cache.current.reset(member.id);
          messagesRef.current = [];
          setMessages([]);
          setConversations([]);
          setDraft("");
          loadVersion.current++;
          openingVersion.current++;
        }
        throw e;
      }
      if (!alive.current || owner.current !== member.id) return [];
      if (version !== listVersion.current) {
        const newer = latestList.current;
        return newer && newer !== run.promise ? newer : [];
      }
      const rows = result.conversations ?? [];
      const namesChanged = rows.some(
        (row) =>
          observedNames.current.has(row.otherId) && observedNames.current.get(row.otherId) !== row.otherName,
      );
      observedNames.current = new Map(rows.map((row) => [row.otherId, row.otherName]));
      if (namesChanged) {
        window.dispatchEvent(new Event("chat-pins-changed"));
        window.dispatchEvent(new Event("chat-favorite-changed"));
        window.dispatchEvent(new CustomEvent("chat-peer-names-changed", { detail: { memberId: member.id } }));
      }
      observeSounds(rows);
      const allowed = new Set(
        rows.filter((c) => !c.unavailable && !c.blockedByMe && c.status !== "declined").map((c) => c.id),
      );
      cache.current.retain(allowed);
      if (deviceKeep) chatDeviceStore()?.putDms(deviceKeep, rows);
      if (selected.current && !allowed.has(selected.current)) {
        messagesRef.current = [];
        setMessages([]);
        setDraft("");
        loadVersion.current++;
        openingVersion.current++;
        setLoading(false);
      }
      setConversations(rows);
      setListReady(true);
      return rows;
    },
    [inbox, observeSounds, member.id, setDraft, deviceKeep],
  );
  const refreshList = useCallback(() => {
    // A newer refresh supersedes this one; its callers get that newer list rather than an
    // empty one, so a lookup (e.g. "Message Bob privately") never mistakes "superseded" for
    // "no conversation" and falls back to a duplicate request.
    const run: { promise?: Promise<DirectConversation[]> } = {};
    const promise = loadList(run);
    run.promise = promise;
    latestList.current = promise;
    return promise;
  }, [loadList]);
  const refreshMessages = useCallback(
    async (id: string) => {
      if (opening.current || skipPending.current?.id === id) return;
      const version = ++loadVersion.current;
      let result: InboxResult;
      try {
        // An old context page is not contiguous with the newest page. Refresh its exact IDs
        // until explicit forward pagination closes that gap.
        const ids = hasNewerRef.current ? messagesRef.current.map((row) => row.id) : [];
        if (ids.length) {
          const pages: InboxResult[] = [];
          for (let i = 0; i < ids.length; i += 100)
            pages.push(await inbox(undefined, `?conversation=${id}&ids=${ids.slice(i, i + 100).join(",")}`));
          result = { messages: pages.flatMap((page) => page.messages ?? []) };
        } else {
          const after = id !== "room-summaries" ? messagesRef.current.at(-1)?.seq : undefined;
          result = await inbox(undefined, `?conversation=${id}${after ? `&after=${after}` : ""}`);
        }
      } catch (e) {
        if (
          e instanceof InboxError &&
          [401, 403, 404].includes(e.status) &&
          alive.current &&
          owner.current === member.id
        ) {
          if (e.status === 401) cache.current.reset(member.id);
          else cache.current.delete(id);
          if (owner.current === member.id && selected.current === id && version === loadVersion.current) {
            messagesRef.current = [];
            setMessages([]);
            setDraft("");
            setLoading(false);
          }
        }
        throw e;
      }
      if (
        !alive.current ||
        owner.current !== member.id ||
        selected.current !== id ||
        version !== loadVersion.current
      )
        return;
      // Refresh previously paged messages too; edits/deletes must not leave old text on screen.
      const newestIds = new Set((result.messages ?? []).map((message) => message.id));
      const olderIds =
        id === "room-summaries"
          ? []
          : messagesRef.current.filter((message) => !newestIds.has(message.id)).map((message) => message.id);
      const pages: Promise<InboxResult>[] = [];
      for (let i = 0; i < olderIds.length; i += 100)
        pages.push(inbox(undefined, `?conversation=${id}&ids=${olderIds.slice(i, i + 100).join(",")}`));
      let olderPages: InboxResult[];
      try {
        olderPages = await Promise.all(pages);
      } catch (e) {
        if (e instanceof InboxError && [401, 403, 404].includes(e.status) && owner.current === member.id) {
          cache.current.delete(id);
          if (selected.current === id && version === loadVersion.current) {
            messagesRef.current = [];
            setMessages([]);
            setDraft("");
            setLoading(false);
          }
        }
        throw e;
      }
      if (
        !alive.current ||
        owner.current !== member.id ||
        selected.current !== id ||
        version !== loadVersion.current
      )
        return;
      const confirmed = [...(result.messages ?? []), ...olderPages.flatMap((page) => page.messages ?? [])];
      if (result.hasNewer !== undefined) {
        hasNewerRef.current = Boolean(result.hasNewer);
        setHasNewer(Boolean(result.hasNewer));
        gapCursor.current = result.hasNewer ? (result.messages?.at(-1)?.seq ?? null) : null;
      }
      setMessages((current) => {
        if (owner.current !== member.id || selected.current !== id) return current;
        const merged = mergeConfirmedMessages(current, confirmed).sort((a, b) => a.seq - b.seq);
        // Nothing changed: keep the list as it is, so its rows do not render again.
        const next =
          merged.length === current.length && merged.every((message, index) => message === current[index])
            ? current
            : merged;
        messagesRef.current = next;
        return next;
      });
      updateOutbox((rows) => reconcilePendingMessages(rows, member.id, `conversation:${id}`, confirmed));
      if (!historyLoaded.current) {
        setHasMore(Boolean(result.hasMore));
        historyLoaded.current = true;
      }
      setLoading(false);
    },
    [inbox, member.id, updateOutbox, setDraft],
  );

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        await refreshList();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Inbox unavailable.");
      }
    };
    const stop = updates?.watch(refresh, ["inbox"], false, 10000, 60000, "direct");
    if (!updates) void refresh();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [updates, refreshList]);
  useEffect(() => {
    if (!activeId || !open || !conversationVisible) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        await refreshMessages(activeId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Messages unavailable.");
      }
    };
    const stop = updates?.watch(refresh, ["inbox"], false, 10000, 60000, "direct");
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [updates, activeId, open, conversationVisible, refreshMessages]);

  const snapshotState = useRef({ conversations, loading });
  snapshotState.current = { conversations, loading };
  const saveSnapshot = useCallback(() => {
    const id = selected.current;
    if (
      id &&
      owner.current === member.id &&
      (!snapshotState.current.loading || messagesRef.current.length > 0)
    ) {
      const row = snapshotState.current.conversations.find((c) => c.id === id);
      if (row && !row.unavailable && !row.blockedByMe && row.status !== "declined")
        cache.current.put(member.id, id, {
          messages: messagesRef.current,
          hasMore: hasMoreRef.current,
          draft: draftRef.current,
          scrollTop: scroll.current?.scrollTop ?? 0,
        });
    }
  }, [member.id]);
  useEffect(() => {
    if (!controlledConversation) {
      saveSnapshot();
      setOpen(false);
    }
  }, [roomSelection, saveSnapshot, controlledConversation]);
  const selectConversation = useCallback(
    (id: string | null) => {
      if (id && id === selected.current && openRef.current) {
        void refreshMessages(id).catch((e) => setError(e.message));
        return;
      }
      saveSnapshot();
      skipIntentCleanup.current?.();
      skipReveal.current = false;
      skipPending.current = null;
      const warm = id ? cache.current.get(member.id, id) : undefined;
      focusedConversation.current = null;
      messagesRef.current = warm?.messages ?? [];
      opening.current = Boolean(id);
      openingTarget.current = null;
      setUnreadStart(null);
      openingCancelled.current = false;
      hasNewerRef.current = false;
      gapCursor.current = null;
      setHasNewer(false);
      nearBottom.current = true;
      scrollIntent.current = null;
      scopeRef.current = id ? `conversation:${id}` : null;
      draftVersion.current++;
      selected.current = id;
      loadVersion.current++;
      openingVersion.current++;
      openingUpdates.current = [];
      readId.current = "";
      readSeq.current = 0;
      historyLoaded.current = false;
      setActiveId(id);
      setMessages(warm?.messages ?? []);
      setHasMore(warm?.hasMore ?? false);
      setRecipient(null);
      setDraft(warm?.draft ?? "");
      setReport(null);
      setError("");
      setNotice("");
      setLoading(Boolean(id));
      if (id) {
        const version = openingVersion.current;
        void (async () => {
          let anchor: string | null = null;
          if (id !== "room-summaries") {
            const response = await fetch(`/api/chat/opening?conversation=${id}`, { cache: "no-store" });
            if (!response.ok)
              throw new Error("Could not find your unread messages. Reopen this conversation to retry.");
            anchor = (await response.json()).messageId;
          }
          // Fetch fresh history after the marker snapshot, bypassing coordinator caches.
          const page = await requestInbox(
            undefined,
            `?conversation=${id}${anchor ? `&around=${anchor}` : ""}`,
          );
          if (
            !alive.current ||
            owner.current !== member.id ||
            selected.current !== id ||
            openingVersion.current !== version
          )
            return;
          if (anchor && !page.messages?.some((row) => row.id === anchor)) anchor = null;
          openingTarget.current = openingCancelled.current ? null : anchor;
          setUnreadStart(openingTarget.current);
          // Once the reader cancels the unread jump, real movement alone decides following.
          nearBottom.current = openingCancelled.current ? nearBottom.current : !anchor;
          const confirmed = mergeConfirmedMessages(page.messages ?? [], openingUpdates.current).sort(
            (a, b) => a.seq - b.seq,
          );
          openingUpdates.current = [];
          messagesRef.current = confirmed;
          setMessages(confirmed);
          hasNewerRef.current = Boolean(page.hasNewer);
          gapCursor.current = page.hasNewer ? (page.messages?.at(-1)?.seq ?? null) : null;
          setHasNewer(Boolean(page.hasNewer));
          setHasMore(Boolean(page.hasMore));
          historyLoaded.current = true;
          opening.current = false;
          setLoading(false);
        })().catch((e) => {
          if (selected.current === id && openingVersion.current === version) {
            setError(e.message);
            setLoading(false); /* Keep reads paused on a failed snapshot. */
          }
        });
      }
    },
    [refreshMessages, saveSnapshot, member.id, setDraft],
  );
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setOpen(true);
    selectConversation(null);
    // Refresh before composing, so an existing request cannot become a second one.
    void refreshList()
      .then((rows) => {
        if (!alive.current || cancelled) return;
        const existing = rows.find((c) => c.otherId === target.id);
        if (existing) selectConversation(existing.id);
        else setRecipient(target);
      })
      .catch((e) => {
        if (alive.current && !cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [target, refreshList, selectConversation]);
  useEffect(() => {
    let cancelled = false;
    if (controlledConversation) return;
    const openFromNotification = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const known = snapshotState.current.conversations.find(
        (c) => c.id === id && !c.unavailable && !c.blockedByMe && c.status !== "declined",
      );
      if (known) {
        setOpen(true);
        selectConversation(id);
        void refreshList().catch((e) => setError(e.message));
      } else
        void refreshList()
          .then((rows) => {
            if (!cancelled && rows.some((c) => c.id === id)) {
              setOpen(true);
              selectConversation(id);
            }
          })
          .catch((e) => setError(e.message));
    };
    window.addEventListener("chat-open-dm", openFromNotification);
    return () => {
      cancelled = true;
      window.removeEventListener("chat-open-dm", openFromNotification);
    };
  }, [refreshList, selectConversation, controlledConversation]);
  useEffect(() => {
    if (controlledConversation) return;
    const show = () => {
      setOpen(true);
      void refreshList()
        .then(() => selectConversation("room-summaries"))
        .catch((e) => setError(e.message));
    };
    window.addEventListener("chat-summary-delivered", show);
    return () => window.removeEventListener("chat-summary-delivered", show);
  }, [refreshList, selectConversation, controlledConversation]);
  const linkedDm = useRef(false);
  useEffect(() => {
    if (linkedDm.current || !listReady) return;
    linkedDm.current = true;
    const id = controlledConversation ?? new URL(window.location.href).searchParams.get("dm");
    if (
      id &&
      snapshotState.current.conversations.some(
        (row) => row.id === id && !row.unavailable && !row.blockedByMe && row.status !== "declined",
      )
    ) {
      setOpen(true);
      selectConversation(id);
      onLinkedConversation?.(true);
    } else onLinkedConversation?.(false);
  }, [listReady, selectConversation, controlledConversation, onLinkedConversation]);
  const composerKey = recipient
    ? `request:${recipient.id}`
    : active && canReply(active)
      ? `conversation:${active.id}`
      : null;
  useEffect(() => {
    if (!open) {
      focusedConversation.current = null;
      return;
    }
    if (
      controlledConversation ||
      !conversationVisible ||
      !composerKey ||
      report !== null ||
      busy ||
      focusedConversation.current === composerKey ||
      document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]')
    )
      return;
    const frame = requestAnimationFrame(() => {
      if (composer.current && !composer.current.disabled) {
        composer.current.focus({ preventScroll: true });
        focusedConversation.current = composerKey;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, composerKey, busy, report, conversationVisible, controlledConversation]);
  useVisibleChatNotifications({
    container: scroll,
    enabled:
      notificationActive &&
      open &&
      conversationVisible &&
      !!activeId &&
      activeId !== "room-summaries" &&
      !loading &&
      !opening.current &&
      !report,
    scope: { kind: "dm", conversationId: activeId ?? "" },
    canonicalIds: messages.filter((message) => !message.deleted_at).map((message) => message.id),
    selector: "[data-message-id]",
    attribute: "data-message-id",
  });
  const lastMessage = messages[messages.length - 1];
  // LIST-ANCHOR: only rows near the screen render; the scroller remounts with the conversation.
  const rowWindow = useRef<{ node: HTMLElement; stop: () => void } | null>(null);
  useEffect(() => {
    const node = scroll.current;
    if (rowWindow.current?.node === node) return;
    rowWindow.current?.stop();
    rowWindow.current = node ? { node, stop: watchChatRowWindow(node) } : null;
  });
  // Showing or hiding every row's reactions changes every row's height, far rows included.
  useLayoutEffect(() => {
    if (scroll.current) resetChatRowWindow(scroll.current);
  }, [open, conversationVisible]);
  useEffect(
    () => () => {
      rowWindow.current?.stop();
      rowWindow.current = null;
    },
    [],
  );
  // Reads only move forward (the server keeps the greatest), so a row older than the last one
  // read sends nothing: scrolling back through history no longer posts a read per row.
  const readSeq = useRef(0);
  const seqById = useRef(new Map<string, number>());
  seqById.current = useMemo(() => new Map(messages.map((message) => [message.id, message.seq])), [messages]);
  const newerRead = useCallback((id: string) => {
    const seq = seqById.current.get(id);
    return id !== readId.current && !(seq !== undefined && seq <= readSeq.current);
  }, []);
  const lastReadableRow = useCallback((pane: HTMLElement) => {
    // Direct children only: searching every row's whole subtree cost more than the rest.
    const bounds = pane.getBoundingClientRect(),
      rows = Array.prototype.filter.call(pane.children, (child: Element) =>
        child.hasAttribute("data-message-id"),
      ) as HTMLElement[];
    let low = 0,
      high = rows.length - 1,
      last = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (rows[middle].getBoundingClientRect().top < bounds.bottom) {
        last = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    for (let index = last; index >= 0; index--) {
      const node = rows[index];
      if (node.getBoundingClientRect().bottom <= bounds.top) break;
      const row = hasNewerRef.current
        ? messagesRef.current.find((message) => message.id === node.dataset.messageId)
        : null;
      if (!hasNewerRef.current || (row && gapCursor.current !== null && row.seq <= gapCursor.current))
        return node.dataset.messageId;
    }
    return undefined;
  }, []);
  useEffect(() => {
    if (
      !open ||
      !conversationVisible ||
      !activeId ||
      !lastMessage ||
      document.hidden ||
      opening.current ||
      openingTarget.current ||
      skipReveal.current ||
      loading
    )
      return;
    const pane = scroll.current;
    if (!pane) return;
    const id = lastReadableRow(pane);
    if (!id || !newerRead(id)) return;
    const before = readSeq.current;
    readId.current = id;
    readSeq.current = Math.max(before, seqById.current.get(id) ?? 0);
    void inbox({ action: "read", target: activeId, clientId: id })
      .then(() => {
        window.dispatchEvent(new Event("chat-activity-refresh"));
        return refreshList();
      })
      .catch(() => {
        if (readId.current === id) {
          readId.current = "";
          readSeq.current = before;
        }
      });
  }, [
    open,
    conversationVisible,
    activeId,
    lastMessage,
    refreshList,
    inbox,
    loading,
    readVisibility,
    lastReadableRow,
    newerRead,
  ]);
  useLayoutEffect(() => {
    const pane = scroll.current;
    if (!pane || !open || !conversationVisible || opening.current || loading) return;
    return watchChatPaneLayout(pane, () => {
      const target = openingTarget.current;
      if (target) {
        const row = pane.querySelector<HTMLElement>(`[data-message-id="${target}"]`);
        if (row) {
          resetChatRowWindow(pane);
          pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top;
          openingTarget.current = null;
          nearBottom.current = false;
          scrollIntent.current = null;
        }
      } else if (nearBottom.current && !hasNewerRef.current) {
        pane.scrollTop = pane.scrollHeight;
        scrollIntent.current = null;
        skipReveal.current = false;
        skipPending.current = null;
        skipIntentCleanup.current?.();
      }
      setReadVisibility((value) => value + 1);
    });
  }, [activeId, open, loading, conversationVisible]);

  const skipLatest = useCallback(async () => {
    if (!activeId || !open || !conversationVisible || loading || busy || opening.current) return;
    const id = activeId,
      request = { id, selection: openingVersion.current };
    const current = () =>
      alive.current &&
      owner.current === member.id &&
      selected.current === id &&
      openingVersion.current === request.selection &&
      skipPending.current === request;
    // Request ownership is independent of message revisions advanced by send acknowledgements.
    loadVersion.current++;
    skipPending.current = request;
    setLoading(true);
    skipIntentCleanup.current?.();
    skipIntentCleanup.current = watchPinnedMessageIntent(() => {
      if (skipPending.current === request) {
        skipPending.current = null;
        skipReveal.current = false;
        loadVersion.current++;
        nearBottom.current = false;
        setLoading(false);
        skipIntentCleanup.current?.();
      }
    });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const version = loadVersion.current;
        const page = await requestInbox(undefined, `?conversation=${id}`);
        if (!current()) return;
        if (version !== loadVersion.current) continue;
        const previousFailure = skipFailure.current;
        setError((value) => (value === previousFailure ? "" : value));
        skipFailure.current = "";
        openingCancelled.current = true;
        openingTarget.current = null;
        setUnreadStart(null);
        hasNewerRef.current = false;
        gapCursor.current = null;
        setHasNewer(false);
        nearBottom.current = true;
        scrollIntent.current = null;
        skipReveal.current = true;
        messagesRef.current = page.messages ?? [];
        setMessages(page.messages ?? []);
        setHasMore(Boolean(page.hasMore));
        historyLoaded.current = true;
        setReadVisibility((value) => value + 1);
        return;
      }
      throw new Error("Messages changed while loading the latest history. Please try again.");
    } catch (e) {
      if (current()) {
        skipFailure.current = e instanceof Error ? e.message : "Could not load the most recent message.";
        setError(skipFailure.current);
      }
    } finally {
      if (current()) setLoading(false);
      if (skipPending.current === request && !skipReveal.current) {
        skipPending.current = null;
        skipIntentCleanup.current?.();
      }
    }
  }, [activeId, open, conversationVisible, loading, busy, member.id]);
  useEffect(() => {
    if (!skipLatestRef) return;
    skipLatestRef.current = () => void skipLatest();
    return () => {
      skipLatestRef.current = null;
    };
  }, [skipLatestRef, skipLatest]);

  async function newer() {
    const id = activeId,
      version = loadVersion.current;
    if (!id || busy || !messages.length) return;
    setBusy(true);
    try {
      const page = await inbox(
        undefined,
        `?conversation=${id}&after=${gapCursor.current ?? messages.at(-1)!.seq}`,
      );
      if (selected.current !== id || version !== loadVersion.current) return;
      hasNewerRef.current = Boolean(page.hasNewer);
      gapCursor.current = page.hasNewer ? (page.messages?.at(-1)?.seq ?? null) : null;
      setHasNewer(Boolean(page.hasNewer));
      nearBottom.current = false;
      scrollIntent.current = null;
      setMessages((current) =>
        mergeConfirmedMessages(current, page.messages ?? []).sort((a, b) => a.seq - b.seq),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Newer messages could not load.");
    } finally {
      setBusy(false);
    }
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (busy || !activeId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await inbox({ action, target: activeId, ...extra });
      await refreshList();
      if (action === "report") {
        setReport(null);
        setNotice("Report saved for Longboard review. You can also block this member.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  /** Text DMs (no files, no "Make clearer") can wait in the device outbox while offline. */
  const canWait = (row: PendingChatMessage) =>
    row.action === "send" && !row.attachmentIds.length && !row.clarity;
  function storeWaiting(row: PendingChatMessage) {
    const store = browserOutboxStore();
    return (
      !!store &&
      addToOutbox(store, {
        kind: "dm",
        target: row.targetId,
        body: row.body,
        clientId: row.clientId,
        createdAt: row.createdAt,
        memberId: row.ownerId,
      })
    );
  }
  async function deliver(row: PendingChatMessage): Promise<"sent" | "waiting" | "failed" | "skipped"> {
    if (inFlight.current.has(row.clientId) || row.ownerId !== member.id) return "skipped";
    if (row.action === "send" && !conversations.some((c) => c.id === row.targetId && canReply(c)))
      return "skipped";
    const mobileSend = beginMobileSend(
      scopeRef.current === row.scope && openRef.current ? composer.current : null,
      scroll.current,
      () => scopeRef.current === row.scope && openRef.current,
    );
    inFlight.current.add(row.clientId);
    updateOutbox((rows) =>
      rows.map((item) =>
        item.clientId === row.clientId ? { ...item, status: "sending", error: undefined } : item,
      ),
    );
    try {
      await waitForAttachments(row.attachmentIds);
      const result = await inbox({
        action: row.action,
        target: row.targetId,
        body: row.body,
        attachmentIds: row.attachmentIds,
        clientId: row.clientId,
        ...(row.clarity ? { clarity: row.clarity } : {}),
      });
      if (row.clarity) void clarity.refresh();
      if (row.stored) {
        const store = browserOutboxStore();
        if (store) removeFromOutbox(store, row.ownerId, row.clientId);
      }
      if (!alive.current || owner.current !== row.ownerId) {
        mobileSend.cancel();
        return "sent";
      }
      const id = result.conversationId ?? (row.action === "send" ? row.targetId : null);
      updateOutbox((rows) =>
        rows.map((item) =>
          item.clientId === row.clientId
            ? {
                ...item,
                status: "sent",
                serverId: result.message?.id,
                ...(id ? { scope: `conversation:${id}` } : {}),
              }
            : item,
        ),
      );
      if (row.action === "request" && id && scopeRef.current === row.scope && openRef.current) {
        setConversations((rows) =>
          rows.some((c) => c.id === id)
            ? rows
            : [
                ...rows,
                {
                  id,
                  status: "pending",
                  incoming: false,
                  otherId: row.targetId,
                  otherName: recipient?.name ?? "Direct message",
                  blockedByMe: false,
                  unavailable: false,
                  lastBody: row.body,
                  updatedAt: row.createdAt,
                  unread: 0,
                },
              ],
        );
        selectConversation(id);
      }
      if (row.action === "request" && !result.message)
        updateOutbox((rows) => rows.filter((item) => item.clientId !== row.clientId));
      if (id && selected.current === id && result.message) {
        if (opening.current)
          openingUpdates.current = mergeConfirmedMessages(openingUpdates.current, [result.message]);
        loadVersion.current++;
        setMessages((current) => {
          if (selected.current !== id || owner.current !== row.ownerId) return current;
          const merged = mergeConfirmedMessages(current, [
            { ...result.message!, client_id: result.message!.client_id ?? row.clientId },
          ]).sort((a, b) => a.seq - b.seq);
          messagesRef.current = merged;
          return merged;
        });
        updateOutbox((rows) =>
          reconcilePendingMessages(rows, row.ownerId, `conversation:${id}`, [
            { ...result.message!, client_id: row.clientId },
          ]),
        );
      }
      if (selected.current === id && openRef.current) mobileSend.confirmed();
      else mobileSend.cancel();
      void refreshList().catch(() => {});
      if (id && selected.current === id) void refreshMessages(id).catch(() => {});
      window.dispatchEvent(new Event("chat-activity-refresh"));
      return "sent";
    } catch (e) {
      mobileSend.cancel();
      // No connection: wait on the device (same clientId) and send when the signal returns.
      if (canWait(row) && isNetworkError(e) && storeWaiting(row)) {
        if (alive.current && owner.current === row.ownerId)
          updateOutbox((rows) =>
            rows.map((item) =>
              item.clientId === row.clientId
                ? { ...item, status: "waiting", stored: true, error: undefined }
                : item,
            ),
          );
        return "waiting";
      }
      if (alive.current && owner.current === row.ownerId)
        updateOutbox((rows) =>
          rows.map((item) =>
            item.clientId === row.clientId
              ? {
                  ...item,
                  status: "failed",
                  error: e instanceof Error ? e.message : "Your message could not be sent.",
                }
              : item,
          ),
        );
      return "failed";
    } finally {
      inFlight.current.delete(row.clientId);
    }
  }
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;
  const flushing = useRef(false),
    flushAgain = useRef(false);
  /** Sends waiting DMs one at a time, oldest first; stops at the first one that doesn't go. */
  const flushWaiting = useCallback(async () => {
    const store = browserOutboxStore();
    const id = owner.current;
    if (!store || !navigator.onLine || !readOutbox(store, id).some((item) => item.kind === "dm")) return;
    if (flushing.current) {
      flushAgain.current = true;
      return;
    }
    flushing.current = true;
    try {
      do {
        flushAgain.current = false;
        await withOutboxLock(`longboard-chat-outbox:${id}:dm`, async () => {
          const result = await flushOutbox({
            store,
            memberId: id,
            kind: "dm",
            send: async (item) => {
              let row = outboxRef.current.find((r) => r.clientId === item.clientId);
              if (!row) {
                // Queued by another tab since we last looked: show it here too.
                const added = waitingRow(id, item);
                updateOutbox((rows) => [...rows, added]);
                row = added;
              }
              const outcome = await deliverRef.current(row);
              if (outcome !== "sent") throw new Error(outcome);
            },
          });
          const stopped = result.stopped;
          if (stopped && (stopped.error as Error).message === "failed")
            // The refused one shows "Not sent" with Retry; later ones wait behind it.
            updateOutbox((rows) =>
              rows.map((row) =>
                row.status === "waiting" && row.ownerId === id && row.clientId !== stopped.item.clientId
                  ? { ...row, status: "failed", error: "Waiting for the message above to send." }
                  : row,
              ),
            );
        });
      } while (flushAgain.current && navigator.onLine && owner.current === id);
    } finally {
      flushing.current = false;
    }
  }, [updateOutbox]);
  // Restore waiting DMs saved on this device (after a reload, or sent by another tab) and send
  // them when online. Nothing runs while the device outbox is empty.
  const syncWaiting = useCallback(() => {
    const store = browserOutboxStore();
    const id = owner.current;
    const saved = store ? readOutbox(store, id).filter((item) => item.kind === "dm") : [];
    const ids = new Set(saved.map((item) => item.clientId));
    if (!saved.length && !outboxRef.current.some((row) => row.stored)) return;
    updateOutbox((rows) => {
      const known = new Set(rows.map((row) => row.clientId));
      const kept = rows.filter((row) => !row.stored || row.status !== "waiting" || ids.has(row.clientId));
      const restored = saved.filter((item) => !known.has(item.clientId)).map((item) => waitingRow(id, item));
      return restored.length || kept.length !== rows.length ? [...kept, ...restored] : rows;
    });
  }, [updateOutbox]);
  useEffect(() => {
    syncWaiting();
    const key = outboxKey(member.id);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) syncWaiting();
    };
    const onOnline = () => void flushWaiting();
    const onVisible = () => {
      if (document.visibilityState === "visible") void flushWaiting();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [member.id, syncWaiting, flushWaiting]);
  // Conversations must be known before a waiting DM can go (deliver checks the member can reply).
  const replyableCount = conversations.filter(canReply).length;
  useEffect(() => {
    if (listReady && replyableCount) void flushWaiting();
  }, [listReady, replyableCount, flushWaiting]);
  /** Retry on a saved row resends the saved queue in order, starting with the oldest. */
  function retryWaiting() {
    updateOutbox((rows) =>
      rows.map((row) =>
        row.stored && row.status === "failed" ? { ...row, status: "waiting", error: undefined } : row,
      ),
    );
    void flushWaiting();
  }
  function discardWaiting(row: PendingChatMessage) {
    const store = browserOutboxStore();
    if (store) removeFromOutbox(store, row.ownerId, row.clientId);
    updateOutbox((rows) => rows.filter((item) => item.clientId !== row.clientId));
  }
  function send(event: FormEvent) {
    event.preventDefault();
    // With a review open, the plain Send button means "send my original" and keeps the review record.
    queueSend(draft.trim(), clarity.review ? clarity.payload(false) : null);
  }
  function queueSend(body: string, clarityPayload: NonNullable<PendingChatMessage["clarity"]> | null) {
    if (
      busy ||
      (!recipient && (opening.current || hasNewerRef.current)) ||
      uploads.blocked ||
      (!body && !uploads.ids.length) ||
      (!recipient && (!active || !canReply(active))) ||
      !scope ||
      requestQueued ||
      consumedDraft.current === `${scope}:${draftVersion.current}:${uploads.ids.join(",")}`
    )
      return;
    consumedDraft.current = `${scope}:${draftVersion.current}:${uploads.ids.join(",")}`;
    const row: PendingChatMessage = {
      ownerId: member.id,
      scope,
      clientId: crypto.randomUUID(),
      action: recipient ? "request" : "send",
      targetId: recipient?.id ?? active!.id,
      body,
      attachmentIds: [...uploads.ids],
      createdAt: new Date().toISOString(),
      status: "sending",
      ...(clarityPayload && !recipient ? { clarity: clarityPayload } : {}),
    };
    // Offline, or older DMs still waiting: queue it on the device so it goes, in order, later.
    const waitFirst =
      canWait(row) &&
      (!navigator.onLine ||
        outboxRef.current.some((item) => item.ownerId === member.id && item.status === "waiting")) &&
      storeWaiting(row);
    if (waitFirst) {
      row.status = "waiting";
      row.stored = true;
    }
    clarity.cancel();
    // D-198: sending always returns to the newest message (as rooms do), even after landing on an
    // unread message or a small scroll; the layout watcher then keeps the new row in view.
    nearBottom.current = true;
    scrollIntent.current = null;
    updateOutbox((rows) => [...rows, row]);
    setDraft("");
    uploads.clear();
    setError("");
    // Focus belongs to this submit event, never a delayed network response.
    composer.current?.focus({ preventScroll: true });
    if (waitFirst) void flushWaiting();
    else void deliver(row);
  }
  async function older() {
    if (!activeId || !messages[0] || busy) return;
    cancelOpening();
    nearBottom.current = false;
    scrollIntent.current = null;
    const id = activeId;
    setBusy(true);
    try {
      const result = await inbox(undefined, `?conversation=${id}&before=${messages[0].seq}`);
      if (!alive.current || owner.current !== member.id || selected.current !== id) return;
      setMessages((current) =>
        mergeConfirmedMessages(current, result.messages ?? []).sort((a, b) => a.seq - b.seq),
      );
      updateOutbox((rows) =>
        reconcilePendingMessages(rows, member.id, `conversation:${id}`, result.messages ?? []),
      );
      setHasMore(Boolean(result.hasMore));
    } catch (e) {
      if (e instanceof InboxError && [401, 403, 404].includes(e.status) && owner.current === member.id) {
        cache.current.delete(id);
        if (selected.current === id) {
          messagesRef.current = [];
          setMessages([]);
          setDraft("");
        }
      }
      setError(e instanceof Error ? e.message : "Earlier messages could not load.");
    } finally {
      setBusy(false);
    }
  }
  function close() {
    const conversationButton = sidebarHost?.querySelector<HTMLButtonElement>('button[aria-current="page"]');
    saveSnapshot();
    openRef.current = false;
    setOpen(false);
    onTargetClosed();
    (conversationButton?.getClientRects().length ? conversationButton : fallbackFocus?.current)?.focus({
      preventScroll: true,
    });
  }

  // The open conversation's settings live in its info sheet, not in the list.
  // (null: the sheet is closed, so they show nowhere.)
  const inSettingsHost = (node: ReactNode) =>
    settingsHost === undefined ? node : settingsHost ? createPortal(node, settingsHost) : null;
  const globalSettings = (
    <>
      <label className={styles.setting}>
        <input
          type="checkbox"
          checked={sounds.preferences.enabled}
          onChange={(event) => sounds.save({ ...sounds.preferences, enabled: event.target.checked })}
        />{" "}
        Enable DM sounds
      </label>
      <label>
        Default sound
        <select
          aria-label="Default DM sound"
          value={sounds.preferences.defaultTone}
          onChange={(event) =>
            sounds.save({
              ...sounds.preferences,
              defaultTone: event.target.value === "pulse" ? "pulse" : "chime",
            })
          }
        >
          <option value="chime">Chime</option>
          <option value="pulse">Pulse</option>
        </select>
      </label>
      <button type="button" disabled={!sounds.preferences.enabled} onClick={() => void sounds.test()}>
        Test DM sound
      </button>
      <p>
        Saved for your account in this browser. Enable sounds and test once to allow audio. Alerts work while
        chat is active, or when you return—not when the browser is closed.
      </p>
      {sounds.message && <p role="status">{sounds.message}</p>}
      <label className={styles.setting}>
        <input
          type="checkbox"
          checked={acceptsRequests}
          disabled={busy}
          onChange={async (event) => {
            const value = event.target.checked;
            setBusy(true);
            setError("");
            try {
              await inbox({ action: "settings", value });
              setAcceptsRequests(value);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Settings could not save.");
            } finally {
              setBusy(false);
            }
          }}
        />{" "}
        Allow new message requests
      </label>
    </>
  );
  const savedDraft = (id: string) => {
    if (id === activeId) return draft.trim();
    try {
      return readChatDraft(window.sessionStorage, member.id, `conversation:${id}`).trim();
    } catch {
      return "";
    }
  };
  const conversationList = (
    <aside className={styles.sidebar} aria-label="Private conversations">
      <h2 className={styles.sectionTitle}>
        {foldable ? (
          // The total already shows on this heading, open or folded; DMs carry no @mentions.
          <FoldHeading
            group="dms"
            label="Direct messages"
            folded={listFolded}
            onToggle={(value) => sidebarFolds.setFolded("dms", value)}
          >
            {badge > 0 && (
              <span className={styles.badge} aria-label={`${badge} unread messages or requests`}>
                {badge}
              </span>
            )}
          </FoldHeading>
        ) : (
          <>
            Direct messages{" "}
            {badge > 0 && (
              <span className={styles.badge} aria-label={`${badge} unread messages or requests`}>
                {badge}
              </span>
            )}
          </>
        )}
      </h2>
      {globalSettingsHost === undefined ? (
        <details className={styles.soundSettings}>
          <summary>DM settings</summary>
          {globalSettings}
        </details>
      ) : (
        globalSettingsHost &&
        createPortal(
          <div className={styles.soundSettings} data-dm-global>
            {globalSettings}
            {!open && error && (
              <p role="alert" className={styles.hint}>
                {error}
              </p>
            )}
          </div>,
          globalSettingsHost,
        )
      )}
      {open &&
        active &&
        !active.system &&
        inSettingsHost(
          <details className={styles.soundSettings} data-dm-settings open={settingsHost ? true : undefined}>
            <summary>{active.otherName} · conversation settings</summary>
            {active && !active.system && !active.unavailable && active.status !== "declined" && (
              <div className={styles.conversationSound}>
                <label>
                  Conversation sound
                  <select
                    aria-label="Conversation DM sound"
                    value={sounds.preferences.conversations[active.id] ?? "default"}
                    onChange={(event) => {
                      const choice = event.target.value;
                      if (isDmChoice(choice))
                        sounds.save({
                          ...sounds.preferences,
                          conversations: { ...sounds.preferences.conversations, [active.id]: choice },
                        });
                    }}
                  >
                    <option value="default">Use default</option>
                    <option value="chime">Chime</option>
                    <option value="pulse">Pulse</option>
                    <option value="mute">Mute this conversation</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={
                    !sounds.preferences.enabled || sounds.preferences.conversations[active.id] === "mute"
                  }
                  onClick={() => void sounds.test(active.id)}
                >
                  Test conversation sound
                </button>
              </div>
            )}
            {active.status === "accepted" && !active.unavailable && !active.blockedByMe && (
              <ChatPins
                key={`pin:${member.id}:${active.id}`}
                memberId={member.id}
                target={{ kind: "dm", conversationId: active.id }}
                label={active.otherName}
              />
            )}
            {active.status === "accepted" && !active.unavailable && !active.blockedByMe && (
              <ChatFavorite
                key={`${member.id}:${active.id}`}
                memberId={member.id}
                target={{ kind: "dm", conversationId: active.id }}
                label={active.otherName}
              />
            )}
            <div className={styles.tools}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(active.blockedByMe ? "unblock" : "block")}
              >
                {active.blockedByMe ? "Unblock" : "Block"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setReport("");
                  onViewChange?.(active.otherName);
                }}
              >
                Report
              </button>
            </div>
          </details>,
        )}
      {listFolded ? null : !listReady && !conversations.length ? (
        <p className={styles.hint}>Loading your conversations…</p>
      ) : conversations.length === 0 ? (
        <p className={styles.hint}>
          Your conversations will appear here. Tap a member’s name in the room to send a request.
        </p>
      ) : null}
      {(listFolded ? [] : (["Requests", "Conversations"] as const)).map((group) => {
        const rows = conversations.filter(
          (c) => (c.status === "pending" && c.incoming && !c.unavailable) === (group === "Requests"),
        );
        return rows.length ? (
          <section key={group}>
            <h3 className={styles.group}>{group}</h3>
            {rows.map((c) => (
              <button
                type="button"
                key={c.id}
                className={styles.item}
                data-active={open && activeId === c.id}
                aria-current={open && activeId === c.id ? "page" : undefined}
                disabled={busy}
                onClick={() => {
                  setOpen(true);
                  selectConversation(c.id);
                  onViewChange?.(c.otherName);
                }}
              >
                <span className={styles.itemName}>
                  {c.otherName}
                  {c.unread > 0 && !c.unavailable ? (
                    <span className={styles.badge} aria-label={`${c.unread} unread messages or requests`}>
                      {c.unread}
                    </span>
                  ) : null}
                </span>
                <span className={styles.preview}>
                  {showDrafts && savedDraft(c.id) ? (
                    <>
                      <span className={styles.draftTag}>Draft:</span> {savedDraft(c.id)}
                    </>
                  ) : c.unavailable ? (
                    "Messaging unavailable"
                  ) : c.status === "pending" ? (
                    c.incoming ? (
                      "Wants to message you"
                    ) : (
                      "Request sent · awaiting acceptance"
                    )
                  ) : c.status === "declined" ? (
                    "Request closed"
                  ) : (
                    c.lastBody
                  )}
                </span>
              </button>
            ))}
          </section>
        ) : null;
      })}
    </aside>
  );
  // The list reads only these fields of the conversation; a refreshed conversation list (after
  // every read receipt) brings new objects with the same values, which must not re-render it.
  const rowId = active?.id,
    rowOtherName = active?.otherName,
    rowSystem = active?.system,
    rowStatus = active?.status,
    rowUnavailable = active?.unavailable;
  const rowConversation = useMemo(
    () =>
      rowId && rowStatus
        ? {
            id: rowId,
            otherName: rowOtherName,
            system: rowSystem,
            status: rowStatus,
            unavailable: !!rowUnavailable,
          }
        : undefined,
    [rowId, rowOtherName, rowSystem, rowStatus, rowUnavailable],
  );
  const onMessageChanged = useCallback(
    (updated: DirectMessage) => {
      if (!rowId || selected.current !== rowId) return;
      if (opening.current) openingUpdates.current = mergeConfirmedMessages(openingUpdates.current, [updated]);
      loadVersion.current++;
      setMessages((current) =>
        current.map((item) =>
          item.id === updated.id && (item.revision ?? 0) <= (updated.revision ?? 0)
            ? { ...updated, client_id: updated.client_id ?? item.client_id }
            : item,
        ),
      );
      void refreshList().catch((e) => setError(e.message));
      window.dispatchEvent(new Event("chat-activity-refresh"));
      if (updated.deleted_at)
        requestAnimationFrame(() => {
          if (selected.current === rowId)
            (composer.current ?? conversationHost?.querySelector<HTMLButtonElement>("button"))?.focus({
              preventScroll: true,
            });
        });
    },
    [rowId, refreshList, conversationHost],
  );
  // Each row's element is kept while what it shows is unchanged. React skips an element it has
  // already rendered, so a keystroke, an arrival or a read in a long DM (a DM keeps every page it
  // loads, often 1,000+ rows) renders only the rows that changed. The row stays a plain keyed
  // <article> in the same child slots as a sending row (BUG-DM-SWIPE-ACK), so a confirmed send
  // still updates its node in place.
  const rowElements = useRef(new Map<string, { inputs: unknown[]; element: ReactNode }>());
  const messageList = useMemo(() => {
    const cache = rowElements.current,
      seen = new Set<string>();
    const rows = messages
      .filter((message) => !message.deleted_at)
      .map((message, index, list) => {
        // GROUP-REST: the same sender again within 5 minutes, same day, no unread marker between,
        // continues their group (one name line). DM rows have a sender, not a member, id.
        const previous = list[index - 1],
          placement = chatMessagePlacement(
            previous && { created_at: previous.created_at, member_id: previous.sender_id },
            { created_at: message.created_at, member_id: message.sender_id },
            { breakGroup: unreadStart === message.id },
          ),
          day = placement.day,
          continued = placement.continued,
          own = message.sender_id === member.id,
          key = own && message.client_id ? message.client_id : message.id,
          unread = unreadStart === message.id,
          reactionsActive = open && conversationVisible,
          original = own ? clarity.originals[message.id] : undefined,
          name = own ? selfName : rowConversation?.otherName,
          inputs = [
            message,
            own,
            name,
            rowConversation,
            unread,
            reactionsActive,
            original,
            onMessageChanged,
            continued,
          ];
        seen.add(key);
        let cached = cache.get(key);
        if (!cached || cached.inputs.some((input, at) => input !== inputs[at])) {
          cached = {
            inputs,
            element: (
              <article
                data-unread-start={unread || undefined}
                className={styles.message}
                data-message-id={message.id}
                data-send-state={own ? "sent" : undefined}
                data-own={own}
                data-continued={continued || undefined}
              >
                {unread && <UnreadStart />}
                <div className={styles.messageIdentity}>
                  <span className={styles.senderName}>{name}</span>
                  <time dateTime={message.created_at} title={chatTimestampTitle(message.created_at)}>
                    {chatTimestamp(message.created_at)}
                    {message.edited_at && !message.deleted_at ? " · edited" : ""}
                  </time>
                </div>
                <div className={styles.headerActions}>
                  <DirectMessageCopy body={message.body} />
                  <span data-dm-reaction-host />
                  {rowConversation && !rowConversation.system && own && !message.deleted_at && (
                    <DirectMessageActions
                      message={message}
                      conversationId={rowConversation.id}
                      canEdit={!rowConversation.unavailable && rowConversation.status !== "declined"}
                      onChanged={onMessageChanged}
                    />
                  )}
                </div>
                <div className={styles.messageBody}>
                  {message.deleted_at ? (
                    <p className={styles.deleted}>Message deleted</p>
                  ) : (
                    <>
                      <ChatMessageBody body={message.body} />
                      {rowConversation && !rowConversation.system && (
                        <DirectAttachments
                          ids={message.attachment_ids}
                          media={message.attachment_media}
                          conversationId={rowConversation.id}
                        />
                      )}
                      {own && original && <ClarityOriginalNote original={original} />}
                    </>
                  )}
                </div>
                {rowConversation && !rowConversation.system && !message.deleted_at && (
                  <div className={styles.messageFooter}>
                    <MessageReactions
                      compact
                      active={reactionsActive}
                      target={{ kind: "dm", conversationId: rowConversation.id, messageId: message.id }}
                      disabled={rowConversation.unavailable || rowConversation.status !== "accepted"}
                    />
                  </div>
                )}
              </article>
            ),
          };
          cache.set(key, cached);
        }
        return (
          <Fragment key={key}>
            {day && (
              <div className={styles.dayDivider} role="separator" aria-label={day}>
                <span>{day}</span>
              </div>
            )}
            {cached.element}
          </Fragment>
        );
      });
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
    return rows;
  }, [
    messages,
    unreadStart,
    member.id,
    selfName,
    rowConversation,
    open,
    conversationVisible,
    clarity.originals,
    onMessageChanged,
  ]);
  // One keyed list (BUG-DM-SWIPE-ACK): an own confirmed message keeps its send clientId as
  // its React key, and both row shapes share child slots, so the ACK updates the touched
  // DOM node in place instead of replacing it mid-gesture.
  const confirmedKeys = new Set<string>();
  for (const message of messages) {
    confirmedKeys.add(message.id);
    if (message.client_id) confirmedKeys.add(message.client_id);
  }
  const pendingRows = localRows
    .filter((row) => !confirmedKeys.has(row.clientId) && !(row.serverId && confirmedKeys.has(row.serverId)))
    .map((row) => (
      <Fragment key={row.clientId}>
        {null}
        <article
          className={styles.message}
          data-own="true"
          data-client-id={row.clientId}
          data-send-state={row.status}
        >
          {null}
          <div className={styles.messageIdentity}>
            <span className={styles.senderName}>{selfName}</span>
            <time dateTime={row.createdAt}>
              {row.status === "sending" ? <SendingMark /> : chatTimestamp(row.createdAt)}
            </time>
          </div>
          <div className={styles.headerActions}>
            <DirectMessageCopy body={row.body} />
          </div>
          <div className={styles.messageBody}>
            <>
              <ChatMessageBody body={row.body} />
              {row.attachmentIds.length > 0 && (
                <p className={styles.deliveryFiles}>
                  {row.attachmentIds.length} attached {row.attachmentIds.length === 1 ? "file" : "files"}{" "}
                  retained for delivery
                </p>
              )}
            </>
          </div>
          <div className={styles.deliveryStatus} role="status">
            {row.status === "sending"
              ? null
              : row.status === "sent"
                ? "Sent"
                : row.status === "waiting"
                  ? "Waiting for connection. It will send when you’re back online."
                  : "Not sent"}
            {row.status === "waiting" && (
              <button type="button" onClick={() => discardWaiting(row)}>
                Delete
              </button>
            )}
            {row.status === "failed" && (
              <>
                <p>{row.error}</p>
                <button
                  type="button"
                  disabled={busy || (!recipient && (!active || !canReply(active)))}
                  onClick={() => void (row.stored ? retryWaiting() : deliver(row))}
                >
                  Retry message
                </button>
              </>
            )}
          </div>
        </article>
      </Fragment>
    ));
  const conversationView = (
    <section className={styles.conversation} aria-label="Selected conversation">
      {active || recipient ? (
        <>
          {recipient ? (
            <>
              <div className={styles.requestIntro}>
                <h3>Start with a request.</h3>
                <p>Send one message to {recipient.name}. You can keep chatting after they accept.</p>
              </div>
              {localRows.length > 0 && (
                <div className={styles.messages} aria-live="polite">
                  {pendingRows}
                </div>
              )}
            </>
          ) : (
            <>
              <div
                className={styles.messages}
                ref={scroll}
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
                onScroll={() => {
                  const pane = scroll.current;
                  if (!open || !conversationVisible || !pane || !chatPaneVisible(pane)) return;
                  const next = chatPaneFollowingScroll(pane, nearBottom.current, scrollIntent.current);
                  nearBottom.current = next.following;
                  scrollIntent.current = next.intent;
                  // Re-render only when a newer row could be read, not on every scroll frame: the
                  // whole conversation re-rendered per frame, which froze long DMs on phones.
                  // Scrolling up only shows older rows, which a read never counts.
                  if (next.direction === "up") return;
                  const readable = lastReadableRow(pane);
                  if (readable && newerRead(readable)) setReadVisibility((value) => value + 1);
                }}
                aria-live="polite"
                aria-busy={loading}
              >
                {hasMore ? (
                  <button className={styles.older} disabled={busy || loading} onClick={() => void older()}>
                    Load earlier messages
                  </button>
                ) : null}
                {loading ? (
                  <div className={styles.loadingSkeleton} role="status" aria-label="Loading messages">
                    <span />
                    <span />
                    <span />
                    <p>Loading messages…</p>
                  </div>
                ) : null}
                {[
                  ...messageList,
                  hasNewer && (
                    <button
                      key="load-newer"
                      className={styles.older}
                      disabled={busy || loading}
                      onClick={() => void newer()}
                    >
                      Load newer messages
                    </button>
                  ),
                  ...pendingRows,
                ]}
              </div>
              {active?.unavailable ? (
                <p className={styles.banner}>
                  {active.blockedByMe
                    ? "You blocked this member. No new messages can be sent."
                    : "Messaging is unavailable for this conversation."}
                </p>
              ) : active?.status === "pending" ? (
                <div className={styles.banner}>
                  {active.incoming ? (
                    <>
                      <p>Accept this request to reply. You can also decline or block.</p>
                      <div className={styles.requestActions}>
                        <button disabled={busy} onClick={() => void act("accept")}>
                          Accept request
                        </button>
                        <button disabled={busy} onClick={() => void act("decline")}>
                          Decline
                        </button>
                      </div>
                    </>
                  ) : (
                    "Request sent. You can send more messages after it is accepted."
                  )}
                </div>
              ) : active?.status === "declined" ? (
                <p className={styles.banner}>This request is closed.</p>
              ) : null}
            </>
          )}
          {active?.system && (
            <p className={styles.banner}>
              Private summaries for you. Use /summary in a room to request another.
            </p>
          )}
          {report !== null ? (
            <form
              className={styles.composer}
              onSubmit={(e) => {
                e.preventDefault();
                void act("report", { body: report });
              }}
            >
              <label htmlFor="dm-report">Why are you reporting this conversation?</label>
              <textarea
                id="dm-report"
                maxLength={1000}
                required
                value={report}
                onChange={(e) => setReport(e.target.value)}
              />
              <p className={styles.hint}>Longboard can review reported messages.</p>
              <div className={styles.requestActions}>
                <button disabled={busy || !report.trim()}>Submit report</button>
                <button type="button" onClick={() => setReport(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (recipient && !requestQueued) || (!recipient && active && canReply(active)) ? (
            <form className={styles.composer} onSubmit={send} onInput={onDmTyping}>
              {active && dmTypingChannel && (
                <TypingIndicator
                  channel={dmTypingChannel}
                  selfId={member.id}
                  // Only the other person in this DM, named as the inbox names them.
                  resolveName={(id) => (id === active.otherId.toLowerCase() ? active.otherName : null)}
                  clearKey={messages.findLast((message) => message.sender_id !== member.id)?.id ?? null}
                />
              )}
              <label className={composerStyles.srOnly} htmlFor={inputId}>
                {recipient ? "Your message request" : "Private message"}
              </label>
              {clarity.enabled && active && (
                // Started from the + menu; only in-progress controls show here.
                <div className={clarityStyles.tools}>
                  <ClarityDictate
                    ref={dictation}
                    onBusyChange={setDictating}
                    conversationId={active.id}
                    disabled={busy}
                    onText={(text) => {
                      draftVersion.current++;
                      setDraft(draftRef.current.trim() ? `${draftRef.current.trimEnd()} ${text}` : text);
                      requestAnimationFrame(() => composer.current?.focus());
                    }}
                    onError={setError}
                  />
                  {clarity.busy && !clarity.review && (
                    <span className={clarityStyles.status} role="status">
                      Reviewing…
                    </span>
                  )}
                  {clarity.busy && (
                    <button type="button" className={clarityStyles.link} onClick={clarity.cancel}>
                      Cancel review
                    </button>
                  )}
                </div>
              )}
              {clarity.error && <p className={clarityStyles.error}>{clarity.error}</p>}
              {clarity.review && (
                <ClarityReview
                  review={clarity.review}
                  busy={clarity.busy}
                  sending={busy}
                  onChange={clarity.setSuggestion}
                  onRegenerate={() => void clarity.regenerate()}
                  onUseOriginal={() => queueSend(clarity.review!.draft.trim(), clarity.payload(false))}
                  onSend={() => queueSend(clarity.review!.suggestion.trim(), clarity.payload(true))}
                  onCancel={clarity.cancel}
                />
              )}
              {!recipient && <AttachmentPicker uploads={uploads} disabled={busy} />}
              {recipient && (
                <p className={styles.hint}>Files can be shared after your request is accepted.</p>
              )}
              <div className={composerStyles.bar}>
                <GifComposer
                  buttonClassName={composerStyles.add}
                  maxLength={2000}
                  disabled={busy}
                  onAttach={recipient ? undefined : () => uploads.input.current?.click()}
                  extras={[
                    ...(!recipient && (draft.trim() || uploads.files.length)
                      ? [
                          {
                            key: "voice",
                            label: (
                              <>
                                <ChatIcon name="mic" /> Voice message
                              </>
                            ),
                            onSelect: () => voiceStart.current?.(),
                          },
                        ]
                      : []),
                    ...(clarity.enabled && active
                      ? [
                          {
                            key: "dictate",
                            label: (
                              <>
                                <ChatIcon name="mic" /> Dictate
                              </>
                            ),
                            disabled: dictating,
                            onSelect: () => dictation.current?.start(),
                          },
                          {
                            key: "clearer",
                            label: "✨ Make clearer",
                            disabled: clarity.busy || !draft.trim(),
                            onSelect: () => void clarity.makeClearer(),
                          },
                        ]
                      : []),
                  ]}
                  onAdd={(url) => {
                    const next = [draft.trim(), url].filter(Boolean).join("\n");
                    if (next.length > 2000) return false;
                    draftVersion.current++;
                    setDraft(next);
                    requestAnimationFrame(() => composer.current?.focus());
                    return true;
                  }}
                />
                <div className={composerStyles.field}>
                  <textarea
                    data-chat-composer
                    ref={composer}
                    onKeyDown={handleChatKeyDown}
                    className={composerStyles.input}
                    rows={1}
                    id={inputId}
                    maxLength={2000}
                    required={!uploads.ids.length}
                    onPaste={recipient ? undefined : uploads.paste}
                    value={draft}
                    disabled={busy}
                    placeholder={recipient ? "Introduce yourself…" : "Write a private message…"}
                    onChange={(e) => {
                      draftVersion.current++;
                      setDraft(e.target.value);
                    }}
                  />
                  <ComposerSend
                    label={recipient ? "Send request" : "Send message"}
                    title={hasNewer ? "Load newer messages before replying" : undefined}
                    hidden={!draft.trim() && !uploads.files.length}
                    disabled={
                      busy ||
                      (!recipient && (loading || opening.current || hasNewer)) ||
                      uploads.blocked ||
                      (!draft.trim() && !uploads.ids.length)
                    }
                  />
                  {!recipient && (
                    <VoiceRecorder
                      key={activeId}
                      uploads={uploads}
                      disabled={busy}
                      micClassName={composerStyles.mic}
                      hideMic={Boolean(draft.trim()) || uploads.files.length > 0}
                      startRef={voiceStart}
                    />
                  )}
                </div>
              </div>
              <small className={styles.composerNote} data-count={draft.length > 1600 || undefined}>
                {draft.length > 1600 ? `${draft.length} / 2,000 · ` : ""}
                <span className={styles.enterHint}>Enter to send · Shift+Enter for a new line</span>
              </small>
              <ComposerLinkPreview body={draft} />
            </form>
          ) : null}
        </>
      ) : (
        <div className={styles.empty}>
          <span aria-hidden="true">✉</span>
          <h3>A conversation of your own.</h3>
          <p>Choose a conversation, or tap a member’s name in the public room to send a private request.</p>
        </div>
      )}
    </section>
  );
  const feedback = (
    <div className={styles.feedback} role={error ? "alert" : "status"}>
      {error || notice}
    </div>
  );
  return (
    <>
      {sidebarHost &&
        createPortal(
          <div className={styles.navigationList}>
            {conversationList}
            {!open && error && (
              <p role="alert" className={styles.hint}>
                {error}
              </p>
            )}
          </div>,
          sidebarHost,
        )}
      {conversationHost &&
        open &&
        createPortal(
          <section
            data-quad={!!controlledConversation}
            className={styles.embedded}
            aria-label="Private conversation"
            onKeyDown={(event) => {
              if (
                !controlledConversation &&
                event.key === "Escape" &&
                !busy &&
                !document.querySelector("dialog[open]")
              )
                close();
            }}
          >
            {conversationView}
            {feedback}
          </section>,
          conversationHost,
        )}
    </>
  );
}
