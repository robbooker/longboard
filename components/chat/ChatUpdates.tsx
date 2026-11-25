"use client";
import { ChatUpdateCoordinator, type ChatAccessUpdate } from "@/lib/chatUpdateCoordinator";
import type { ChatRoom } from "@/lib/publicChat";
import { withBrowserSupabase } from "@/lib/supabase/lazyClient";
import { realtimeRoomEventChangesThreads } from "@/lib/chatRealtimeRoom";
import { useAblyRoomEvents } from "./hooks/useAblyRoomEvents";
import {
  CHAT_POSTGRES_HIDDEN_DROP_MS,
  ChatPostgresWatch,
  type ChatPostgresChannel,
  type ChatPostgresLive,
} from "@/lib/chatPostgresWatch";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  chatSelfName,
  newerChatMember,
  validChatMember,
  type ChatMemberNameUpdate,
} from "@/lib/chatMemberName";
import type { ChatMember } from "@/lib/chatDirectMessages";
/**
 * This window's timer phase (CoordinatorEnvironment.phase): random, unless this tab's session
 * pins it. Browser tests that count reads (chat-event-stream) pin it so the five-minute stream
 * confirm lands outside the windows they measure instead of at a random moment inside one.
 */
export const CHAT_UPDATE_PHASE_KEY = "longboard-chat-update-phase";
function chatUpdatePhase() {
  try {
    const pinned = Number(window.sessionStorage.getItem(CHAT_UPDATE_PHASE_KEY) || NaN);
    if (pinned >= 0 && pinned < 1) return pinned;
  } catch {}
  return Math.random();
}
type RoomEvent = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };
const NO_POSTGRES: ChatPostgresLive = { rooms: false, direct: false };
/**
 * #496: how long a hidden tab keeps its Postgres channels (CHAT_POSTGRES_HIDDEN_DROP_MS). Browser
 * tests shorten it for their session; anything outside 0.5-60 s is ignored.
 */
export const CHAT_POSTGRES_HIDDEN_DROP_KEY = "longboard-chat-postgres-hidden-drop-ms";
function chatPostgresHiddenDropMs() {
  try {
    const pinned = Number(window.sessionStorage.getItem(CHAT_POSTGRES_HIDDEN_DROP_KEY) || NaN);
    if (pinned >= 500 && pinned <= CHAT_POSTGRES_HIDDEN_DROP_MS) return pinned;
  } catch {}
  return CHAT_POSTGRES_HIDDEN_DROP_MS;
}
type BrowserSupabaseClient = Parameters<Parameters<typeof withBrowserSupabase>[0]>[0];
/** One Postgres change channel, not yet subscribed: the room tables or the DM tables. */
function openPostgresChannel(
  client: BrowserSupabaseClient,
  kind: ChatPostgresChannel,
  {
    updates,
    rooms,
    disposed,
  }: { updates: ChatUpdateCoordinator; rooms: () => ChatRoom[]; disposed: () => boolean },
) {
  // The DM channel keeps the old name: one per chat shell (chat-quad-browser counts them).
  if (kind === "direct")
    return client
      .channel(`chat-updates-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "longboard_chat_direct_messages" },
        () => {
          if (!disposed()) updates.invalidate("inbox", "activity");
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "longboard_chat_conversations" }, () => {
        if (!disposed()) updates.invalidate("inbox", "activity");
      });
  return client
    .channel(`chat-rooms-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "longboard_chat_messages" }, (payload) => {
      if (disposed() || document.hidden || !navigator.onLine) return;
      const shown = rooms();
      if (payload.eventType === "DELETE" || shown.includes(payload.new.room_slug as ChatRoom)) {
        window.dispatchEvent(
          new CustomEvent<RoomEvent>("chat-room-event", {
            detail: payload as unknown as RoomEvent,
          }),
        );
        // A new top-level message already merges into the list; only thread changes need reloads.
        // EVENT-STREAM step 2: not for a room in step, whose numbered Ably events bring
        // the same change to the thread, counts and pins (a delete names no room here).
        const changedRoom = payload.eventType === "DELETE" ? null : String(payload.new.room_slug);
        const inStep = changedRoom
          ? updates.streamInStep(changedRoom)
          : shown.length > 0 && shown.every((room) => updates.streamInStep(room));
        if (realtimeRoomEventChangesThreads(payload as unknown as RoomEvent) && !inStep)
          updates.invalidate("room");
      }
      // Other rooms' messages only move unread badges; refresh those at most every 5 s.
      updates.invalidateAtMost("activity", 5000);
    })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "longboard_chat_reactions" },
      (payload) => {
        if (disposed() || document.hidden || !navigator.onLine) return;
        window.dispatchEvent(
          new CustomEvent<RoomEvent>("chat-reaction-event", {
            detail: payload as unknown as RoomEvent,
          }),
        );
        // EVENT-STREAM step 3: reactions are not on the thread, counts or pins; rooms in
        // step hear of them from their numbered events.
        const shown = rooms();
        if (!(shown.length > 0 && shown.every((room) => updates.streamInStep(room))))
          updates.invalidate("room");
      },
    );
}
const IdentityContext = createContext<{
  accountId?: string;
  member: ChatMember | null;
  version: number;
  publish: (update: ChatMemberNameUpdate) => void;
} | null>(null);
export function useChatIdentity() {
  return useContext(IdentityContext);
}
export function useChatSelfName(memberId: string | null | undefined, member?: ChatMember | null) {
  const identity = useChatIdentity();
  return chatSelfName(memberId, member, identity?.member);
}
export function useChatNameLabel() {
  const identity = useChatIdentity();
  return (id: string | null | undefined, fallback: string) =>
    identity?.member && identity.member.id === id ? identity.member.display_name : fallback;
}
export function useChatDisplayName(memberId: string | null | undefined, fallback: string) {
  const identity = useChatIdentity();
  return identity?.member && identity.member.id === memberId ? identity.member.display_name : fallback;
}
/** #410: a member's picture name; your own always comes from your identity (so a change shows at once). */
export function useChatAvatar(memberId: string | null | undefined, fallback?: string | null) {
  const identity = useChatIdentity();
  return identity?.member && memberId && identity.member.id === memberId
    ? (identity.member.avatar_path ?? null)
    : (fallback ?? null);
}
export function useChatNameRefresh(refresh: () => void) {
  const identity = useChatIdentity(),
    callback = useRef(refresh),
    seen = useRef(identity?.version ?? 0);
  callback.current = refresh;
  useEffect(() => {
    if (identity && seen.current !== identity.version) {
      seen.current = identity.version;
      callback.current();
    }
  }, [identity]);
}
const Context = createContext<ChatUpdateCoordinator | null>(null);
const AccessContext = createContext<ChatAccessUpdate | null>(null);
export function useChatAccess(accountId?: string) {
  const access = useContext(AccessContext);
  return access?.accountId === accountId ? access : null;
}
export function useChatUpdates() {
  return useContext(Context);
}
export function ChatUpdatesProvider({
  children,
  serverSession,
  pollingRoom,
  room,
  rooms,
  onUnauthorized,
  accountId,
}: {
  accountId?: string;
  onUnauthorized?: () => void;
  children: ReactNode;
  serverSession: boolean;
  pollingRoom: boolean;
  room: ChatRoom;
  rooms?: ChatRoom[];
}) {
  const roomRef = useRef(rooms ?? [room]);
  roomRef.current = rooms ?? [room];
  const [name, setName] = useState<{ accountId?: string; member: ChatMember | null; version: number }>({
    accountId,
    member: null,
    version: 0,
  });
  const applyMember = useCallback(
    (incoming: ChatMember) =>
      setName((current) => {
        const member = newerChatMember(current.accountId === accountId ? current.member : null, incoming);
        return current.accountId === accountId &&
          current.member?.display_name === member.display_name &&
          current.member?.name_revision === member.name_revision &&
          current.member?.avatar_path === member.avatar_path
          ? current
          : { accountId, member, version: current.version + 1 };
      }),
    [accountId],
  );
  const applyRef = useRef(applyMember);
  applyRef.current = applyMember;
  // #489: when this window last changed its own name or picture. For a little longer than the
  // server's 30-second member cache, a cached (possibly older) row can't undo that change.
  const publishedAt = useRef(-Infinity);
  const [access, setAccess] = useState<ChatAccessUpdate | null>(null);
  const expectedAccount = useRef(accountId);
  expectedAccount.current = accountId;
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  const [updates] = useState(
    () =>
      new ChatUpdateCoordinator(
        {
          fetch: (...args) => fetch(...args),
          active: () => !document.hidden && navigator.onLine,
          now: () => Date.now(),
          phase: chatUpdatePhase(),
          access: (value) => {
            if (expectedAccount.current && value.accountId !== expectedAccount.current) {
              unauthorized.current?.();
              window.location.replace("/chat/login");
              return;
            }
            setAccess(value);
            if (value.member && !(value.memberCached && Date.now() - publishedAt.current < 35_000))
              applyRef.current(value.member);
          },
          unauthorized: () => {
            unauthorized.current?.();
            window.location.replace("/chat/login");
          },
        },
        pollingRoom,
      ),
  );
  const publish = useCallback(
    (value: ChatMemberNameUpdate) => {
      if (value.accountId !== expectedAccount.current || !validChatMember(value.member)) return;
      publishedAt.current = Date.now();
      applyRef.current(value.member);
      updates.refreshIdentity();
      window.dispatchEvent(new Event("chat-pins-changed"));
      window.dispatchEvent(new Event("chat-favorite-changed"));
    },
    [updates],
  );
  useEffect(() => {
    const peer = (event: Event) => {
      const id = (event as CustomEvent<{ memberId: string }>).detail?.memberId;
      if (name.accountId !== accountId || !name.member || name.member.id !== id) return;
      setName((current) => ({ ...current, version: current.version + 1 }));
      updates.invalidate("history", "activity");
    };
    window.addEventListener("chat-peer-names-changed", peer);
    return () => window.removeEventListener("chat-peer-names-changed", peer);
  }, [accountId, name.accountId, name.member, updates]);
  useEffect(() => {
    setName({ accountId, member: null, version: 0 });
  }, [accountId]);
  // A live Ably connection replaces 2-second polling for every room, including ShortScout sign-ins.
  const ablyLink = useAblyRoomEvents(updates, roomRef);
  const ablyLive = ablyLink === "live";
  const ablyLinkRef = useRef(ablyLink);
  ablyLinkRef.current = ablyLink;
  useEffect(() => {
    updates.setPollingRoom(pollingRoom && !ablyLive);
  }, [updates, pollingRoom, ablyLive]);
  // Either live transport delivers room events, so either one keeps reconciles relaxed.
  // Cookie sessions have no Postgres channel, so Ably alone decides their health.
  // #496: the Postgres room channel is open only while Ably is not live, and DMs have their own.
  const [postgresLive, setPostgresLive] = useState<ChatPostgresLive>(NO_POSTGRES);
  useEffect(() => {
    updates.setHealthy(ablyLive || (!serverSession && postgresLive.rooms));
  }, [updates, serverSession, ablyLive, postgresLive.rooms]);
  useEffect(() => {
    updates.setDirectLive(!serverSession && postgresLive.direct);
  }, [updates, serverSession, postgresLive.direct]);
  const postgresWatch = useRef<ChatPostgresWatch | null>(null);
  useEffect(() => {
    let disposed = false;
    updates.start();
    const visible = () => updates.foreground("visible");
    const online = () => updates.foreground("online");
    const activity = () => updates.invalidate("activity", "inbox");
    const roomRefresh = () => updates.invalidate("room", "history", "activity");
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    window.addEventListener("chat-activity-refresh", activity);
    window.addEventListener("chat-inbox-refresh", activity);
    window.addEventListener("chat-room-refresh", roomRefresh);
    // The cookie-only identity cannot authenticate a browser Postgres channel.
    // Never grant anonymous access or assume a subscribed socket proves identity.
    // #460: the Supabase library loads after the first screen (lib/supabase/lazyClient.ts); until
    // its channel subscribes the page polls, as it does whenever the channel is down.
    // #496 (lib/chatPostgresWatch.ts): the room tables only while Ably is not live; both channels
    // close after the tab has been hidden a minute and reopen (and catch up) when it is shown.
    const watch = serverSession
      ? null
      : new ChatPostgresWatch({
          hidden: () => document.hidden,
          hiddenDropMs: chatPostgresHiddenDropMs(),
          open: (channel, status) =>
            withBrowserSupabase((client) => {
              const subscribed = openPostgresChannel(client, channel, {
                updates,
                rooms: () => roomRef.current,
                disposed: () => disposed,
              }).subscribe((state) => status(state === "SUBSCRIBED"));
              return () => void client.removeChannel(subscribed);
            }),
          live: (live) => {
            if (!disposed) setPostgresLive(live);
          },
          // The DM channel was closed while hidden: the bell may have missed a DM (the inbox
          // re-reads itself when the channel goes live again).
          resumed: () => {
            if (!disposed) updates.invalidate("activity");
          },
        });
    const watchVisibility = () => watch?.visibility();
    document.addEventListener("visibilitychange", watchVisibility);
    postgresWatch.current = watch;
    watch?.start(ablyLinkRef.current);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("visibilitychange", watchVisibility);
      window.removeEventListener("online", online);
      window.removeEventListener("chat-activity-refresh", activity);
      window.removeEventListener("chat-inbox-refresh", activity);
      window.removeEventListener("chat-room-refresh", roomRefresh);
      updates.stop();
      setPostgresLive(NO_POSTGRES);
      watch?.stop();
      if (postgresWatch.current === watch) postgresWatch.current = null;
    };
  }, [updates, serverSession]);
  useEffect(() => {
    postgresWatch.current?.setAbly(ablyLink);
  }, [ablyLink]);
  const identity = useMemo(
    () => ({
      accountId,
      member: name.accountId === accountId ? name.member : null,
      version: name.version,
      publish,
    }),
    [accountId, name, publish],
  );
  return (
    <Context.Provider value={updates}>
      <AccessContext.Provider value={access}>
        <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>
      </AccessContext.Provider>
    </Context.Provider>
  );
}
