"use client";
import { isAnnouncementRoom } from "@/lib/publicChat";
import { ChatUpdatesProvider,useChatUpdates } from "./ChatUpdates";

import type { ChatBootstrap } from "@/lib/chatBootstrapTypes";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { parseSummaryCommand } from "@/lib/chatSummaryCommand";
import { chatTimestamp,chatTimestampTitle } from "@/lib/chatTimestamp";
import {
CHAT_ROOMS,
countChatters,
mergeReaction,
mergeRoomMessage,
reactionSummary,
type ChatRoom,
type PublicChatMessage,
type PublicChatReaction,
type PublicChatRoomState,
} from "@/lib/publicChat";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import Link from "next/link";
import { FormEvent,useCallback,useEffect,useMemo,useRef,useState } from "react";
import SocialCommunityIcon from "./SocialCommunityIcon";
import ChatActivityBell from "./ChatActivityBell";
import { AttachmentPicker,ChatAttachments } from "./ChatAttachments";
import { GifComposer } from "./ChatGif";
import ChatHeaderMenu from "./ChatHeaderMenu";
import ChatMessageBody from "./ChatMessageBody";
import ChatReplyPanel,{ type ReplyDraft } from "./ChatReplyPanel";
import ChatReportReview from "./ChatReportReview";
import ChatSearch from "./ChatSearch";
import DirectInbox from "./DirectInbox";
import StartDirectMessage from "./StartDirectMessage";
import FeatureNotifications from "./FeatureNotifications";
import { useAttachments } from "./hooks/useAttachments";
import { useChatActivity } from "./hooks/useChatActivity";
import { useReplyCounts } from "./hooks/useReplyCounts";
import { useReplyNavigation } from "./hooks/useReplyNavigation";
import MentionTextarea from "./MentionTextarea";
import MessageActions from "./MessageActions";
import styles from "./PublicChat.module.css";
import ReactionNames from "./ReactionNames";

const GUEST_TOKEN_KEY = "longboard-public-chat-guest-token-v1";
const GUEST_NAME_KEY = "longboard-public-chat-display-name-v1";
const CHAT_THEME_KEY = "longboard-public-chat-theme-v1";
const MAX_MESSAGE_LENGTH = 600;

type IdentityStatus = "checking" | "name" | "ready";
type ActionState = "default" | "loading" | "error" | "success";
type ChatTheme = "dark" | "light" | "blade-runner";
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
  const result = await response.json().catch(() => ({})) as GuestResponse;
  if (response.ok) return result;
  if (result.error === "chat_paused") throw new Error("Chat is temporarily paused. History remains available below.");
  throw new Error(typeof result.message === "string" ? result.message : "The chat service did not respond. Try again.");
}


async function invokeAdmin(room: ChatRoom, body?: Record<string, unknown>): Promise<AdminResponse> {
  const response = await fetch(`/api/chat/admin?room=${room}`, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : { cache: "no-store" });
  const result = await response.json().catch(() => ({})) as AdminResponse;
  if (response.ok) return result;
  throw new Error(result.error || "The chat admin service did not respond.");
}

function PublicChatContent({ accountId, bootstrap, room, popout, fontVariableClass, isAdmin = false, allowedRooms = ["main","social"], serverSession = false, canLinkShortScout = false, featureChannel = false }: { bootstrap?: ChatBootstrap; accountId?: string; roomRealtime?: boolean; featureChannel?: boolean; allowedRooms?: ChatRoom[]; serverSession?: boolean; canLinkShortScout?: boolean; isAdmin?: boolean; room: ChatRoom; popout: boolean; fontVariableClass: string }) {
  const updates=useChatUpdates()!;
  const announcement = isAnnouncementRoom(room);
  const readOnlyAnnouncement = announcement && !isAdmin;
  const shortScoutRoom = room === "shortscout" || room === "ss-announcements";
  const roomLabel = CHAT_ROOMS.find(option => option.slug === room)!.label;
  const roomHref = (slug: ChatRoom) => `/chat?room=${slug}${popout ? "&popout=1" : ""}`;
  const loginHref = `/chat/login?room=${room}${popout?"&popout=1":""}`;
  const supabase = useMemo(() => createClient(), []);
  const [theme, setTheme] = useState<ChatTheme>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [member, setMember] = useState<ChatMember | null>(bootstrap?.member ?? null);
  const activity=useChatActivity(member?.id);
  const {data:activityData,read:readActivity}=activity;
  const lastRoomRead=useRef('');
  const scrolledMention=useRef('');
  const [signedIn, setSignedIn] = useState(!!bootstrap);
  const [identityError, setIdentityError] = useState("");
  const [mobileActionsHost, setMobileActionsHost] = useState<HTMLDivElement | null>(null);
  const [dmSidebarHost, setDmSidebarHost] = useState<HTMLDivElement | null>(null);
  const [dmConversationHost, setDmConversationHost] = useState<HTMLDivElement | null>(null);
  const [dmView, setDmView] = useState<string | null>(null);
  const [roomSelection, setRoomSelection] = useState(0);
  const [dmTarget, setDmTarget] = useState<{ id: string; name: string } | null>(null);
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>(bootstrap ? (bootstrap.member ? "ready" : "name") : "checking");
  const [guestId, setGuestId] = useState(bootstrap?.member?.id ?? "");
  const [displayName, setDisplayName] = useState(bootstrap?.member?.display_name ?? "");
  const [chatterCount, setChatterCount] = useState(0);
  const [presenceReady, setPresenceReady] = useState(false);
  const [nameDraft, setNameDraft] = useState(bootstrap?.member?.display_name ?? "");
  const {target:replyTarget,depth:replyDepth,mobile:mobileReplies,open:openReplies,back:backReplies,close:closeReplies}=useReplyNavigation(room);
  const replyDrafts=useRef<Record<string,ReplyDraft>>({});
  const uploads=useAttachments(room);
  const messageRetry=useRef<{key:string;id:string}|null>(null);
  const [mobileNavOpen,setMobileNavOpen]=useState(false);
  const navRef=useRef<HTMLElement>(null);
  const navTrigger=useRef<HTMLButtonElement>(null);
  const navWasOpen=useRef(false);
  const onDmViewChange = useCallback((name: string | null) => {
    setDmView(name);
    if (name) setMobileNavOpen(false);
  }, []);
  const onDmTargetClosed = useCallback(() => setDmTarget(null), []);
  useEffect(() => { setRoomSelection(value => value + 1); setDmTarget(null); }, [room]);
  const inlineDm = dmView !== null;
  useEffect(()=>{setMobileNavOpen(false);},[room,mobileReplies]);
  useEffect(()=>{
    if(mobileNavOpen&&mobileReplies){navWasOpen.current=true;navRef.current?.querySelector<HTMLButtonElement>('button')?.focus();}
    else if(navWasOpen.current){navWasOpen.current=false;navTrigger.current?.focus({preventScroll:true});}
  },[mobileNavOpen,mobileReplies]);

  const replyTrigger=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{if(!replyTarget)replyTrigger.current?.focus({preventScroll:true});},[replyTarget]);
  const messageVersion=useRef(0);
  const [messages, updateMessages] = useState<PublicChatMessage[]>(bootstrap?.messages ?? []);
  const setMessages=useCallback((action:React.SetStateAction<PublicChatMessage[]>)=>{messageVersion.current++;updateMessages(action);},[]);
  const replyCounts=useReplyCounts(room,inlineDm?"":messages.filter(m=>!m.pending).map(m=>m.id).join(","),bootstrap?.counts);
  const [reactions, updateReactions] = useState<PublicChatReaction[]>(bootstrap?.reactions ?? []);
  const setReactions=useCallback((action:React.SetStateAction<PublicChatReaction[]>)=>{messageVersion.current++;updateReactions(action);},[]);
  const [body, setBody] = useState("");
  useEffect(() => { setBody(window.sessionStorage.getItem(`longboard-chat-draft-${room}`) ?? ""); }, [room]);
  const [loading, setLoading] = useState(false);
  const [nameState, setNameState] = useState<ActionState>("default");
  const [sendState, setSendState] = useState<ActionState>("default");
  const [popoutState, setPopoutState] = useState<ActionState>("default");
  const [reactionStates, setReactionStates] = useState<Record<string, ActionState>>({});
  const [roomStatus, setRoomStatus] = useState<PublicChatRoomState | null>(bootstrap?.roomState ?? null);
  const [isOwner, setIsOwner] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminState, setAdminState] = useState<ActionState>("default");
  const [adminAction, setAdminAction] = useState<"room" | "summary" | null>(null);
  const [adminFeedback, setAdminFeedback] = useState("");
  const [adminReason, setAdminReason] = useState("");
  const [summaries, setSummaries] = useState<AdminSummary[]>([]);
  const [error, setError] = useState("");
  const mentionNames = useMemo(() => [...new Set(["Buddy", ...(member ? [member.display_name] : []), ...messages.filter(message => message.member_id).map(message => message.author_label)])], [messages, member]);
  const pinnedToBottom = useRef(true);
  const initialScrollDone = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const loadedRoom = useRef<ChatRoom | null>(bootstrap?.room ?? null);
  const summaryRetry = useRef<{room:string;id:string}|null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(()=>{
    const through=activityData.roomThrough[room]??0;
    const roomThrough=activityData.roomMessageThrough?.[room]??0;
    if(!member||loading||loadedRoom.current!==room||identityStatus!=='ready'||searchOpen||inlineDm||document.hidden||document.querySelector('dialog[open]')||(!through&&!roomThrough))return;
    const key=`${member.id}:${room}:${through}:${roomThrough}`;if(lastRoomRead.current===key)return;
    lastRoomRead.current=key;
    void readActivity({kind:'room',room,mentionThrough:through,roomThrough}).catch(()=>{if(lastRoomRead.current===key)lastRoomRead.current='';});
  },[activityData,readActivity,member,loading,identityStatus,room,searchOpen,inlineDm]);
  useEffect(()=>{
    const controller=new AbortController();
    const reveal=()=>{
      const id=window.location.hash.slice(1);
      if(loading||!id.startsWith('chat-message-')||scrolledMention.current===id)return;
      const target=document.getElementById(id);
      if(target){target.scrollIntoView({block:'center'});scrolledMention.current=id;return;}
      // Mentions/search may link to a reply now hidden from the main feed.
      void fetch(`/api/chat/thread?room=${room}&messageId=${encodeURIComponent(id.slice(13))}`,{cache:'no-store',signal:controller.signal})
        .then(async response=>{if(!response.ok)return;const data=await response.json();if(!controller.signal.aborted&&window.location.hash.slice(1)===id){scrolledMention.current=id;openReplies(data.parent.reply_to_id||data.parent.id);}})
        .catch(()=>undefined);
    };
    reveal();window.addEventListener('hashchange',reveal);
    return()=>{controller.abort();window.removeEventListener('hashchange',reveal);};
  },[loading,messages,room,openReplies]);

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
    if (themeReady) window.localStorage.setItem(CHAT_THEME_KEY, theme);
  }, [theme, themeReady]);

  useEffect(() => {
    let cancelled=false;
    const stop=updates.watch(async()=>{
      const response=await updates.read(`/api/chat?room=${room}`);
      const result=await response.json();
      if(!cancelled&&response.ok&&typeof result.isOpen==='boolean')setRoomStatus(result);
    },['status']);
    return()=>{cancelled=true;stop();};
  },[room,updates]);

  useEffect(() => {
    let cancelled = false;
    if (!isAdmin) return;
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
  }, [room, isAdmin]);

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
        const account = await response.json() as { signedIn: boolean; member: ChatMember | null };
        if (cancelled) return;
        if (!account.signedIn) { window.location.replace(loginHref); return; }
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
          setNameDraft(savedName); setIdentityStatus("name"); return;
        }
        try {
          const result = await invokeGuest({ room, action: "session", token });
          if (cancelled) return;
          if (!result.guestId || !result.displayName) throw new Error("invalid_session");
          setGuestId(result.guestId); setDisplayName(result.displayName);
          setNameDraft(result.displayName); setIdentityStatus("ready");
        } catch {
          if (!cancelled) { window.localStorage.removeItem(GUEST_TOKEN_KEY); setNameDraft(savedName); setIdentityStatus("name"); }
        }
      } catch (e) { if (!cancelled) setIdentityError(e instanceof Error ? e.message : "Your chat identity could not load."); }
    }
    void identify();
    return () => { cancelled = true; };
  }, [room, loginHref, bootstrap]);

  useEffect(() => {
    if(serverSession) return;
    let previous: string | null | undefined = accountId;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      if (previous !== undefined && previous !== id) {
        // Clear private state immediately before re-identifying this browser.
        setMember(null); setDmTarget(null); setSignedIn(false); setGuestId(""); setIdentityStatus("checking"); setMessages([]); setReactions([]);
        window.location.reload();
      }
      previous = id;
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, room, serverSession, accountId, setMessages, setReactions]);

  useEffect(() => {
    if(inlineDm)return;
    let cancelled=false;
    if(loadedRoom.current!==room)setLoading(true);
    const load=async()=>{
      try {
        const version=messageVersion.current;
        const response=await updates.read(`/api/chat/history?room=${room}`);
        const result=await response.json();
        if(cancelled)return;
        if(response.status===401||response.status===403){setMessages([]);setReactions([]);window.location.replace(loginHref);return;}
        if(!response.ok)throw new Error('Chat history did not load. Please try again.');
        if(version!==messageVersion.current){updates.invalidate("history");return;}
        loadedRoom.current=room;
        // Do not drop pending local sends while a reconciliation is in flight.
        setMessages(current=>[...result.messages,...current.filter(m=>m.pending&&!result.messages.some((row:PublicChatMessage)=>row.id===m.id))]);
        setReactions(result.reactions);setLoading(false);
      } catch(e){if(!cancelled){setError(e instanceof Error?e.message:'Chat unavailable');setLoading(false);}}
    };
    const stop=updates.watch(load,['history'],true,60000);
    const message=(event:Event)=>{
      const payload=(event as CustomEvent).detail;
      if(payload.eventType==='DELETE')setMessages(current=>current.filter(m=>m.id!==payload.old.id));
      else if(payload.new.room_slug===room)setMessages(current=>mergeRoomMessage(current,payload.new as PublicChatMessage));
    };
    const reaction=(event:Event)=>{
      const payload=(event as CustomEvent).detail;
      if(payload.new?.message_id)setReactions(current=>mergeReaction(current,payload.new as PublicChatReaction));
    };
    window.addEventListener('chat-room-event',message);window.addEventListener('chat-reaction-event',reaction);
    return()=>{cancelled=true;stop();window.removeEventListener('chat-room-event',message);window.removeEventListener('chat-reaction-event',reaction);};
  },[updates,room,inlineDm,loginHref,setMessages,setReactions]);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    const presenceKey = guestId || `observer-${crypto.randomUUID()}`;

    channel = supabase.channel(`longboard-public-chat-presence-${room}`, {
      config: { presence: { key: presenceKey } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setPresenceReady(true);
        setChatterCount(countChatters(channel?.presenceState() ?? {}));
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
      if (channel) void supabase.removeChannel(channel);
    };
  }, [guestId, identityStatus, supabase, room]);

  useEffect(() => {
    const node = messagesRef.current;
    if (((replyTarget || mobileNavOpen) && mobileReplies) || searchOpen || inlineDm || !node || loading || identityStatus === "checking" || (identityStatus === "name" && roomStatus?.isOpen !== false)) return;
    if (!initialScrollDone.current || pinnedToBottom.current) {
      node.scrollTop = node.scrollHeight;
      initialScrollDone.current = true;
      pinnedToBottom.current = true;
    }
    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [messages, loading, identityStatus, roomStatus?.isOpen, searchOpen, replyTarget, mobileReplies, mobileNavOpen, inlineDm]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    reactionTimersRef.current.forEach((timer) => clearTimeout(timer));
    reactionTimersRef.current.clear();
  }, []);

  const roomPaused = roomStatus?.isOpen === false;
  const pauseNotice = roomStatus?.notice || "Chat temporarily paused by Longboard.";

  const feedback = useMemo(() => {
    if (error) return error;
    if (sendState === "success") return "Message sent.";
    return `${body.length} / ${MAX_MESSAGE_LENGTH}`;
  }, [body.length, error, sendState]);

  async function setRoomOpen(isOpen: boolean) {
    if (adminAction) return;
    if (!isOpen && !window.confirm(`Pause ${roomLabel} now? History stays readable. The other room remains available.`)) {
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
      setAdminFeedback(isOpen
        ? "Chat reopened. New participation is enabled."
        : "Chat paused. History remains readable.");
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
      setAdminFeedback(result.result?.status === "no_messages"
        ? "There are no messages to summarize for today."
        : "Today’s private summary is ready.");
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
        const response = await fetch("/api/chat/member", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: nextName, token }) });
        const result = await response.json();
        if (!response.ok || !result.member) throw new Error(result.error || "Your name could not be linked.");
        const linked = result.member as ChatMember;
        setMember(linked); setGuestId(linked.id); setDisplayName(linked.display_name); setNameDraft(linked.display_name);
        window.localStorage.removeItem(GUEST_TOKEN_KEY);
        window.localStorage.setItem(GUEST_NAME_KEY, linked.display_name);
        setNameState("success"); setIdentityStatus("ready");
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

    const summary=parseSummaryCommand(nextBody,room);
    if(summary){
      if(uploads.files.length){setError('Remove attachments before requesting a summary.');return;}
      if('error' in summary){setError(summary.error);return;}
      setSendState('loading');setError('');
      if(summaryRetry.current?.room!==summary.room)summaryRetry.current={room:summary.room,id:crypto.randomUUID()};
      try{
        const response=await fetch('/api/chat/summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:summary.room,clientId:summaryRetry.current.id})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Summary unavailable.');
        summaryRetry.current=null;
        setBody('');window.sessionStorage.removeItem(`longboard-chat-draft-${room}`);setSendState('success');
        window.dispatchEvent(new Event('chat-summary-delivered'));
        timerRef.current=setTimeout(()=>setSendState('default'),1400);
      }catch(e){setError(e instanceof Error?e.message:'Summary unavailable.');setSendState('error');}
      return;
    }

    const sendKey=JSON.stringify([room,nextBody,uploads.ids]);
    if(messageRetry.current?.key!==sendKey)messageRetry.current={key:sendKey,id:crypto.randomUUID()};
    const clientId=messageRetry.current.id;
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
    pinnedToBottom.current = true;
    setMessages((current) => [...current, optimistic]);
    setBody("");
    window.sessionStorage.removeItem(`longboard-chat-draft-${room}`);
    setError("");
    setSendState("loading");

    try {
      const result = await invokeGuest({ room, action: "send", token, body: nextBody, attachmentIds:uploads.ids, clientId });
      const sent = typeof result.message === "object" ? result.message : null;
      if (!sent?.id) throw new Error("That message was not sent.");
      setMessages((current) => mergeRoomMessage(
        current.filter((message) => message.id !== optimisticId),
        sent,
      ));
      uploads.clear();messageRetry.current=null;
      setSendState("success");
      timerRef.current = setTimeout(() => setSendState("default"), 1400);
    } catch (caught) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setBody(nextBody);
      setError(caught instanceof Error ? caught.message : "That message was not sent.");
      setSendState("error");
    }
  }

  async function toggleReaction(message: PublicChatMessage) {
    if (roomPaused || message.pending || reactionStates[message.id] === "loading") return;
    const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (!token && !member) return;

    const previous = reactions.find((reaction) => reaction.message_id === message.id && reaction.guest_id === guestId);
    const active = !previous?.active;
    const now = new Date().toISOString();
    const optimistic: PublicChatReaction = {
      message_id: message.id,
      guest_id: guestId,
      active,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    };
    setReactions((current) => mergeReaction(current, optimistic));
    setReactionStates((current) => ({ ...current, [message.id]: "loading" }));
    setError("");

    try {
      const result = await invokeGuest({ room, action: "react", token, messageId: message.id, active });
      if (!result.reaction) throw new Error("Your reaction was not saved.");
      setReactions((current) => mergeReaction(current, result.reaction as PublicChatReaction));
      setReactionStates((current) => ({ ...current, [message.id]: "success" }));
      const timer = setTimeout(() => {
        setReactionStates((current) => ({ ...current, [message.id]: "default" }));
        reactionTimersRef.current.delete(message.id);
      }, 1000);
      reactionTimersRef.current.set(message.id, timer);
    } catch (caught) {
      setReactions((current) => {
        const withoutOptimistic = current.filter((reaction) => reaction.message_id !== message.id || reaction.guest_id !== guestId);
        return previous ? [...withoutOptimistic, previous] : withoutOptimistic;
      });
      setReactionStates((current) => ({ ...current, [message.id]: "error" }));
      setError(caught instanceof Error ? caught.message : "Your reaction was not saved.");
    }
  }

  function openPopout() {
    setPopoutState("loading");
    const width = Math.min(460, Math.max(340, window.screen.availWidth - 32));
    const height = Math.min(780, Math.max(560, window.screen.availHeight - 48));
    const left = Math.max(0, window.screenX + window.outerWidth - width - 24);
    const top = Math.max(0, window.screenY + 36);
    const url = new URL(`/chat?popout=1&room=${room}`, window.location.origin);
    const opened = window.open(
      url.toString(),
      "longboard-public-chat",
      `popup=yes,width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`,
    );
    if (!opened) {
      setError("Your browser blocked the chat window. Allow popups and try again.");
      setPopoutState("error");
      return;
    }
    opened.opener = null;
    opened.focus();
    setPopoutState("success");
    timerRef.current = setTimeout(() => setPopoutState("default"), 1400);
  }

  return (
    <main className={`${styles.page} ${fontVariableClass}`} data-popout={popout} data-theme={theme} data-room={shortScoutRoom ? "shortscout" : room}>
      <div className={styles.shell} data-reply-open={!!replyTarget && !inlineDm} data-nav-open={mobileNavOpen} data-dm-open={inlineDm}>
          <nav ref={navRef} id="chat-room-navigation" className={styles.roomTabs} aria-label="Chat rooms" inert={mobileReplies&&(!mobileNavOpen||(!!replyTarget&&!inlineDm))} onKeyDown={event=>{
            if(!mobileReplies||!mobileNavOpen)return;
            if(event.key==='Escape'){event.preventDefault();setMobileNavOpen(false);return;}
            if(event.key!=='Tab')return;
            const controls=Array.from(navRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled)')??[]);
            const first=controls[0],last=controls[controls.length-1];
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
            if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
          }}>
            <button type="button" className={styles.mobileNavBack} onClick={()=>setMobileNavOpen(false)}>Back to chat →</button>
            <div className={styles.navHeading}>YOUR COMMUNITIES</div>
            {featureChannel && <Link href="/chat/features">FEATURES 🔒</Link>}
            {CHAT_ROOMS.filter(option=>!isAnnouncementRoom(option.slug)||allowedRooms.includes(option.slug)).map((option) => !allowedRooms.includes(option.slug) ? <Link key={option.slug} href={option.slug==="shortscout"?`/api/chat/login/start?link=1&room=shortscout${popout?"&popout=1":""}`:`/login?next=${encodeURIComponent(roomHref(option.slug))}`} title="Sign in with this membership">{option.label} 🔒</Link> : <Link key={option.slug} href={roomHref(option.slug)} scroll={false} onClick={(event) => {
              setRoomSelection(value => value + 1); setDmTarget(null);
              if (option.slug === room) { event.preventDefault(); setSearchOpen(false); setMobileNavOpen(false); return; }
              if (sendState === "loading" || adminAction) { event.preventDefault(); return; }
              window.sessionStorage.setItem(`longboard-chat-draft-${room}`, body);
              setMobileNavOpen(false);
            }} aria-current={!searchOpen && !inlineDm && room === option.slug ? "page" : undefined}>{option.label}{(activity.data.roomMessageCounts?.[option.slug]??0)>0&&<span className={styles.activityBadge} aria-label={`${activity.data.roomMessageCounts?.[option.slug]} unread messages`}>{activity.data.roomMessageCounts?.[option.slug]}</span>}</Link>)}
            <button type="button" className={styles.searchTab} aria-pressed={searchOpen} onClick={() => {setRoomSelection(value => value + 1);setDmTarget(null);setSearchOpen((open) => !open);setMobileNavOpen(false);}}>⌕ Search</button>
            <span>{announcement ? "Announcements · Admin posts only" : room === "shortscout" ? "Short selling" : room === "social" ? "Movies, life & everything else" : "Trading & the markets"}</span>
            <div ref={setMobileActionsHost} className={styles.mobileNavActions} />
            {member&&<StartDirectMessage key={member.id} onSelect={target=>{setDmTarget(target);setMobileNavOpen(false);}}/>}
            <div ref={setDmSidebarHost} className={styles.dmSidebarHost} />
          </nav>
        <section className={styles.chat} inert={mobileReplies&&((!!replyTarget&&!inlineDm)||mobileNavOpen)} aria-label={shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"}>
          <header className={styles.header} data-dm={inlineDm}>
            <div className={styles.compactBrand}>
              {inlineDm ? <><button ref={navTrigger} type="button" className={styles.dmRoomBack} aria-label={`Back to ${roomLabel} room`} title={`Back to ${roomLabel} room`} onClick={()=>{setRoomSelection(value=>value+1);setDmTarget(null);setSearchOpen(false);}}><span aria-hidden="true">←</span><span>{roomLabel}</span></button><div className={styles.communityTitle}><h1 title={dmView??undefined}>{dmView}</h1></div></> : <>
              <button ref={navTrigger} type="button" className={styles.mobileNavArrow} aria-label="Open room navigation" aria-expanded={mobileNavOpen} aria-controls="chat-room-navigation" onClick={()=>setMobileNavOpen(true)}>←</button>
              {room === "social" ? <span className={styles.lbMark} role="img" aria-label="Social community" title="Social community"><SocialCommunityIcon /></span> : <span className={styles.lbMark} aria-label={shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"} title={shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"}>{shortScoutRoom ? "SS" : "LB"}<span aria-hidden="true">{shortScoutRoom ? "↘" : "🌴"}</span></span>}
              <div className={styles.communityTitle}><h1>{announcement ? roomLabel : room === "shortscout" ? "ShortScout" : room === "social" ? "Social" : "Longboard"}</h1>{<span className={styles.onlineCount} data-live={presenceReady && !roomPaused} data-paused={roomPaused || undefined} aria-live="polite">
                <i aria-hidden="true" />{roomPaused ? "Paused" : announcement ? "Admin posts only" : presenceReady ? `${chatterCount} online` : "Connecting…"}
              </span>}
            </div></>}
            </div>
            <div className={styles.headerActions}>
              <button type="button" className={styles.headerSearch} aria-label="Search chat" aria-pressed={searchOpen && !inlineDm} onClick={() => {setRoomSelection(value => value + 1);setDmTarget(null);setSearchOpen(true);}}>⌕ <span>Search chat</span></button>
              {member && <ChatActivityBell data={activity.data} error={activity.error} read={activity.read}/>}
              {featureChannel && <FeatureNotifications showLabel portalHost={mobileReplies || inlineDm ? mobileActionsHost : null}/>}
              {member ? <DirectInbox key={member.id} member={member} target={dmTarget} onTargetClosed={onDmTargetClosed} fallbackFocus={navTrigger} sidebarHost={dmSidebarHost} conversationHost={dmConversationHost} conversationVisible={!mobileNavOpen} roomSelection={roomSelection} onViewChange={onDmViewChange} /> : null}
              <ChatHeaderMenu>{(close) => <>
                {inlineDm&&<button type="button" className={styles.menuItem} onClick={()=>{close();setMobileNavOpen(mobileReplies);requestAnimationFrame(()=>{const details=dmSidebarHost?.querySelector<HTMLDetailsElement>('[data-dm-settings]')??dmSidebarHost?.querySelector<HTMLDetailsElement>('details');if(details){details.open=true;details.querySelector<HTMLElement>('summary')?.focus();}});}}>DM settings</button>}
                <div className={styles.menuIdentity}>
                  <span>{signedIn ? "Signed in" : "Guest chat"}</span>
                  <strong>{displayName || "Welcome to Longboard"}</strong>
                </div>
                {!signedIn ? <Link className={styles.menuItem} href={loginHref}>Sign in for private messages <span aria-hidden="true">↗</span></Link> : !member ? <button type="button" className={styles.menuItem} onClick={() => { setIdentityStatus("name"); close(); }}>Link your member name</button> : null}
                {identityStatus === "ready" && !member ? <button type="button" className={styles.menuItem} onClick={() => { setError(""); setNameState("default"); setIdentityStatus("name"); close(); }}>Change chat name</button> : null}
                {canLinkShortScout ? <a className={styles.menuItem} href={`/api/chat/login/start?link=1&room=shortscout${popout?"&popout=1":""}`}>Connect ShortScout →</a> : null}
                {serverSession ? <button className={styles.menuItem} onClick={async()=>{
                  const response=await fetch("/api/chat/login/logout",{method:"POST"});
                  if(response.ok) window.location.replace(loginHref);
                  else setError("Could not sign out. Please try again.");
                }}>Sign out of chat</button> : null}
                <div className={styles.menuSectionLabel}>Appearance</div>
                <div role="group" aria-label="Chat theme">
                  {CHAT_THEMES.map((option) => <button key={option.value} type="button" className={styles.menuItem} aria-pressed={theme === option.value} onClick={() => setTheme(option.value)}>
                    <span><span aria-hidden="true">{option.icon}</span> {option.label}</span><span aria-hidden="true">{theme === option.value ? "✓" : ""}</span>
                  </button>)}
                </div>
                <div className={styles.menuDivider} />
                {isOwner ? <button type="button" className={styles.menuItem} aria-expanded={adminOpen} aria-controls="longboard-chat-admin-panel" onClick={() => { setAdminOpen((open) => !open); close(); }}>Admin controls <span aria-hidden="true">{adminOpen ? "−" : "+"}</span></button> : null}
                {!popout ? <button type="button" className={styles.menuItem} disabled={popoutState === "loading"} onClick={() => { openPopout(); close(); }}>Pop out chat <span aria-hidden="true">↗</span></button> : <Link className={styles.menuItem} href={`/chat?room=${room}`}>Open full page <span aria-hidden="true">↗</span></Link>}
              </>}</ChatHeaderMenu>
            </div>
          </header>



          {isOwner && adminOpen && !inlineDm ? (
            <aside id="longboard-chat-admin-panel" className={styles.adminPanel} aria-label="Longboard Chat owner controls" aria-busy={Boolean(adminAction)}>
              <div className={styles.adminHeading}>
                <div>
                  <span>{roomLabel.toUpperCase()} · OWNER CONTROL</span>
                  <strong>{roomPaused ? "ROOM PAUSED" : "ROOM OPEN"}</strong>
                </div>
                <button className={styles.adminClose} type="button" aria-label="Close owner controls" onClick={() => setAdminOpen(false)}>×</button>
              </div>
              <p className={styles.adminCopy}>
                Only your authenticated Longboard account can use these controls. Pausing this room keeps its history readable and stops messages and reactions here.
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
                <button className={styles.summaryButton} type="button" disabled={Boolean(adminAction)} onClick={() => void summarizeNow()}>
                  {adminAction === "summary" ? "SUMMARIZING…" : "SUMMARIZE NOW"}
                </button>
              </div>
              <p className={styles.adminFeedback} data-state={adminState} aria-live="polite">
                {adminFeedback}
              </p>
              <ChatReportReview />
              <div className={styles.summaryList}>
                <span>PRIVATE DAILY SUMMARIES</span>
                {summaries.length ? summaries.slice(0, 3).map((summary) => (
                  <details key={summary.id}>
                    <summary>{summary.summary_date} · {summary.message_count} messages</summary>
                    <p>{summary.summary_text}</p>
                  </details>
                )) : <p>No summaries yet.</p>}
              </div>
            </aside>
          ) : null}

          <div ref={setDmConversationHost} className={styles.dmConversationHost} hidden={!inlineDm} />
          <div className={styles.searchPane} hidden={!searchOpen || inlineDm}><ChatSearch room={room === "main" || room === "social" ? room : (allowedRooms.includes("main")?"main":"social")} allowLongboard={allowedRooms.includes("main")} /></div>
          <div className={styles.roomPane} hidden={searchOpen || inlineDm}>
          {identityStatus === "checking" ? (
            <div className={styles.loading}>{identityError || "Opening the room…"}{identityError ? <button type="button" className={styles.textButton} onClick={() => window.location.reload()}>Refresh</button> : null}</div>
          ) : identityStatus === "name" && !roomPaused ? (
            <div className={styles.gate}>
              <form className={styles.gateForm} onSubmit={saveName}>
                <h1 className={styles.gateTitle}>{signedIn ? "Your member name." : "Pick a name."} <span>Join the room.</span></h1>
                <p className={styles.gateCopy}>{signedIn ? "Link this name to your account to chat and receive private message requests across devices." : "No account or login required for public chat. Sign in to send and receive private messages."}</p>
                <label className={styles.nameLabel} htmlFor="longboard-chat-name">Your chat name</label>
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
                <button className={styles.primaryButton} type="submit" disabled={nameState === "loading"} data-state={nameState}>
                  {nameState === "loading" ? "JOINING…" : signedIn ? "LINK NAME & JOIN" : "JOIN CHAT"}
                </button>
                <p className={styles.feedback} data-error={Boolean(error)} aria-live="polite">{error}</p>
              </form>
            </div>
          ) : (
            <>
              <div ref={messagesRef} onScroll={(event) => { if (searchOpen) return; const node = event.currentTarget; pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64; }} className={styles.messages} aria-live="polite" aria-busy={loading}>
                {roomPaused ? (
                  <div className={styles.pauseBanner} role="status">
                    <strong>CHAT PAUSED · HISTORY IS READ ONLY</strong>
                    <span>{readOnlyAnnouncement ? "Only admins can post in this announcement channel. New announcements appear in your notification bell." : pauseNotice}</span>
                  </div>
                ) : null}
                {loading ? (
                  <div className={styles.loading}>Loading the room…</div>
                ) : messages.length === 0 ? (
                  <div className={styles.empty}>
                    <strong>No messages yet.</strong>
                    <button type="button" className={styles.searchTab} aria-pressed={searchOpen} onClick={() => {setRoomSelection(value => value + 1);setDmTarget(null);setSearchOpen((open) => !open);setMobileNavOpen(false);}}>⌕ Search</button>
            <span>{announcement ? "New announcements will appear here." : room === "social" ? "Seen a good movie lately? Start the conversation." :  `Start the ${roomLabel} conversation below.`}</span>
                  </div>
                ) : messages.map((message) => {
                  const summary = reactionSummary(reactions, message.id, guestId);
                  const reactionState = message.pending ? "loading" : reactionStates[message.id] ?? "default";
                  return (
                    <article
                      className={styles.message}
                      key={message.id}
                      id={`chat-message-${message.id}`}
                      data-own={!!member && message.member_id===member.id}
                      data-pending={message.pending || undefined}
                      data-bot={message.bot_slug === "buddy" || undefined}
                    >
                      <div className={styles.messageIdentity}>
                      {message.member_id && message.member_id !== member?.id ? (
                        <button type="button" className={`${styles.author} ${styles.memberAuthor}`} title={`Message ${message.author_label} privately`} onClick={() => {
                          if (!member) { window.location.href = loginHref; return; }
                          setDmTarget({ id: message.member_id!, name: message.author_label });
                        }}>{message.author_label}<span className={styles.memberBadge}>MESSAGE ↗</span></button>
                      ) : <span className={styles.author}>{message.bot_slug === "buddy" ? "@BUDDY" : message.guest_id === guestId ? "YOU" : message.author_label}</span>}
                        <time className={styles.time} dateTime={message.created_at} title={themeReady ? chatTimestampTitle(message.created_at) : message.created_at}>
                          {message.pending ? "SENDING" : themeReady ? chatTimestamp(message.created_at) : message.created_at}{message.edited_at ? " · edited" : ""}
                        </time>
                      </div>
                      <div className={styles.messageMeta}>
                        <MessageActions message={message} room={room} own={!!member && message.member_id===member.id} admin={isAdmin} paused={roomPaused} onEdited={updated=>setMessages(current=>mergeRoomMessage(current,updated))} onDeleted={id=>{setMessages(current=>current.filter(m=>m.id!==id));setReactions(current=>current.filter(r=>r.message_id!==id));}} />
                      </div>
                      {message.reply_to_id&&<button type="button" className={styles.replyButton} onClick={event=>{replyTrigger.current=event.currentTarget;openReplies(message.reply_to_id!);}}>↳ View parent conversation</button>}
                      <ChatMessageBody body={message.body} names={mentionNames} />
                      <ChatAttachments ids={message.attachment_ids} room={room}/>
                      <div className={styles.messageFooter}>
                      {member&&!message.pending&&(!readOnlyAnnouncement||!!replyCounts[message.id])&&<button type="button" className={styles.replyButton} data-has-replies={(replyCounts[message.id]??0)>0} aria-expanded={replyTarget===message.id} onClick={event=>{replyTrigger.current=event.currentTarget;openReplies(message.id);}}>↳ {replyCounts[message.id]?`${replyCounts[message.id]} ${replyCounts[message.id]===1?"reply":"replies"}`:"Reply"}</button>}
                        <div className={styles.messageReactions}>
                        <ReactionNames messageId={message.id} room={room} revision={reactions.filter(r=>r.message_id===message.id&&r.active).map(r=>`${r.guest_id}:${r.updated_at}`).sort().join('|')}>
                        {descriptionId => <button
                          aria-describedby={descriptionId}
                          className={styles.reactionButton}
                          type="button"
                          aria-label={summary.reacted
                            ? `Remove your ${shortScoutRoom?"lemon":"palm"} reaction. ${summary.count} ${summary.count === 1 ? "like" : "likes"}.`
                            : `React with a ${shortScoutRoom?"lemon":"palm"}. ${summary.count} ${summary.count === 1 ? "like" : "likes"}.`}
                          aria-pressed={summary.reacted}
                          disabled={roomPaused || !guestId || reactionState === "loading"}
                          data-state={reactionState}
                          onClick={() => void toggleReaction(message)}
                        >
                          <span aria-hidden="true">{shortScoutRoom?"🍋":"🌴"}</span>
                          <span>{summary.count}</span>
                          <span aria-hidden="true">{reactionState === "loading" ? "…" : reactionState === "success" ? "✓" : reactionState === "error" ? "×" : ""}</span>
                        </button>}
                        </ReactionNames>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {identityStatus === "ready" && !roomPaused && !readOnlyAnnouncement ? (
                <form className={styles.composerWrap} onSubmit={sendMessage}>
                  <AttachmentPicker uploads={uploads} disabled={sendState === "loading"}/>
                  <div className={styles.composerRow}>
                    <MentionTextarea
                      onPaste={uploads.paste}
                      enabled={Boolean(member)}
                      buddyEnabled={room === "main"}
                      className={styles.composer}
                      value={body}
                      maxLength={MAX_MESSAGE_LENGTH}
                      rows={2}
                      aria-label={`Message ${roomLabel}`}
                      aria-describedby="longboard-chat-feedback"
                      aria-invalid={sendState === "error"}
                      disabled={sendState === "loading"}
                      placeholder={`Write as ${displayName}…${room === "main" ? " Try @Buddy for a reply." : " What’s on your mind?"}`}
                      onValue={(value) => {
                        setBody(value);
                        setError("");
                        if (sendState === "error") setSendState("default");
                      }}
                    />
                    <div className={styles.composerActions}>
                      <GifComposer onAttach={()=>uploads.input.current?.click()} disabled={sendState === "loading"} onAdd={(url) => {
                        const next = [body.trim(), url].filter(Boolean).join("\n");
                        if (next.length > MAX_MESSAGE_LENGTH) return false;
                        setBody(next);
                        setError("");
                        return true;
                      }} />
                        <button className={styles.primaryButton} type="submit" disabled={sendState === "loading" || uploads.blocked} data-state={sendState}>
                        {sendState === "loading" ? "SENDING…" : sendState === "success" ? "SENT ✓" : "SEND"}
                      </button>
                    </div>
                  </div>
                  <p id="longboard-chat-feedback" className={styles.feedback} data-error={Boolean(error)} aria-live="polite">
                    {feedback} · Enter to send · Shift+Enter for a new line. {announcement ? "Announcements alert members of this community." : room === "shortscout" ? "Use /summary for a private room recap. Messages are saved and visible to verified ShortScout members and chat admins." : "Use /summary for a private room recap. Messages are saved, searchable by members, and may be processed for AI search and private summaries."} {room === "main" ? "Buddy replies only to @Buddy." : ""}
                  </p>
                </form>
              ) : (
                <div className={styles.readOnlyFooter}>
                  <strong>{readOnlyAnnouncement&&!roomPaused ? "ADMIN POSTS ONLY" : "READ-ONLY MODE"}</strong>
                  <span>{readOnlyAnnouncement&&!roomPaused ? "You can react to announcements. Only admins can post. New announcements appear in your notification bell." : pauseNotice}</span>
                </div>
              )}
            </>
          )}
          </div>
        </section>
        {replyTarget&&!inlineDm&&<ChatReplyPanel key={`${room}:${replyTarget}`} messageId={replyTarget} memberId={member?.id} room={room} paused={roomPaused} readOnly={readOnlyAnnouncement} depth={replyDepth} onBack={backReplies} onOpen={openReplies} draft={replyDrafts.current[`${room}:${replyTarget}`]??(replyDrafts.current[`${room}:${replyTarget}`]={body:"",scroll:0})} onClose={closeReplies} onSent={message=>setMessages(current=>mergeRoomMessage(current,message))}/>}
      </div>
    </main>
  );
}

export default function PublicChat(props:Parameters<typeof PublicChatContent>[0]) {
 return <ChatUpdatesProvider key={`${props.accountId}:${props.room}:${props.serverSession}:${props.roomRealtime}`} room={props.room} serverSession={!!props.serverSession} pollingRoom={!props.roomRealtime}><PublicChatContent {...props}/></ChatUpdatesProvider>;
}
