"use client";
import {openChatPopout} from '@/lib/chatPopout';
import {beginMobileSend,watchChatViewport} from '@/lib/chatMobileSend';
import ChatFavorite from "./ChatFavorite";
import ChatPins from "./ChatPins";
import {ChatRoomCache,type RoomSnapshot} from "@/lib/chatRoomCache";
import {ChatSessionContext,useChatSession} from "./ChatSession";
import RoomMessageRow from "./RoomMessageRow";
import {reconcileRoomMessages} from "@/lib/chatMessageIdentity";
import {useChatRefreshGuard} from './hooks/useChatRefreshGuard';
import {clearChatDrafts} from '@/lib/chatRefreshDrafts';
import VoiceRecorder from './VoiceRecorder';
import { isAnnouncementRoom } from "@/lib/publicChat";
import { ChatUpdatesProvider,useChatUpdates } from "./ChatUpdates";
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
import type { RealtimeChannel } from "@supabase/supabase-js";
import Link from "next/link";
import { FormEvent,useCallback,useEffect,useMemo,useRef,useState,useLayoutEffect,useId } from "react";
import SocialCommunityIcon from "./SocialCommunityIcon";
import ChatActivityBell from "./ChatActivityBell";
import { AttachmentPicker } from "./ChatAttachments";
import { GifComposer } from "./ChatGif";
import ChatHeaderMenu from "./ChatHeaderMenu";
import type { ReplyDraft } from "./ChatReplyPanel";
import dynamic from "next/dynamic";
import DirectInbox from "./DirectInbox";
import StartDirectMessage from "./StartDirectMessage";
import RoomMemberList from "./RoomMemberList";
import {disableCurrentChatPush} from '@/lib/chatPushBrowser';
import ChatAppControls from './ChatAppControls';
import ChatPushSettings from './ChatPushSettings';
import ChatInstallGuide from './ChatInstallGuide';
import FeatureNotifications from "./FeatureNotifications";
import { useAttachments } from "./hooks/useAttachments";
import { useChatActivity } from "./hooks/useChatActivity";
import { useReplyCounts } from "./hooks/useReplyCounts";
import { useReplyNavigation } from "./hooks/useReplyNavigation";
import MentionTextarea from "./MentionTextarea";
import styles from "./PublicChat.module.css";
import {MessageReactionProvider} from "./MessageReactions";

// Secondary tools are downloaded only when their visible gate first renders.
const ChatSearch=dynamic(()=>import('./ChatSearch'),{ssr:false,loading:()=> <p className={styles.loading} role="status">Loading search…</p>});
const ChatReportReview=dynamic(()=>import('./ChatReportReview'),{ssr:false,loading:()=> <p role="status">Loading reported conversations…</p>});
const ChatReplyPanel=dynamic(()=>import('./ChatReplyPanel'),{ssr:false,loading:()=> <aside className={styles.replyPanel} aria-label="Comment replies" aria-busy="true"><header><h2>Thread</h2><button type="button" onClick={()=>window.history.back()} aria-label="Back from loading replies">← Back</button></header><p className={styles.loading} role="status">Loading replies…</p></aside>});

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

export type PublicChatProps={ pane?:{visible:boolean;conversationId?:string;onPrivateMessage?:(id:string)=>void}; hasSeparateShortScoutProfile?:boolean; appVersion?:string; bootstrap?: ChatBootstrap; accountId?: string; roomRealtime?: boolean; realtimeRooms?: ChatRoom[]; featureChannel?: boolean; allowedRooms?: ChatRoom[]; serverSession?: boolean; canLinkShortScout?: boolean; isAdmin?: boolean; room: ChatRoom; popout: boolean; fontVariableClass: string };
function PublicChatContent({ pane,hasSeparateShortScoutProfile=false,cold,snapshot,onSnapshot,onNavigate,clearSession, accountId, bootstrap, room, popout, fontVariableClass, isAdmin = false, allowedRooms = ["main","social"], serverSession = false, canLinkShortScout = false, featureChannel = false }: PublicChatProps & {cold:boolean;snapshot:RoomSnapshot|null;onSnapshot:(snapshot:RoomSnapshot)=>void;onNavigate:(room:ChatRoom)=>void;clearSession:()=>void}) {
  const session=useChatSession();
  const {dmSidebarHost,setDmSidebarHost,dmConversationHost,setDmConversationHost,dmView,setDmView,roomSelection,setRoomSelection,dmTarget,setDmTarget,navTrigger,mobileNavOpen,setMobileNavOpen,setMember:publishMember}=session;
  const updates=useChatUpdates()!;
  const recordings = room === "lb-recordings" || room === "ss-recordings";
  const announcement = isAnnouncementRoom(room);
  const gainers = room === "gainers";
  const readOnlyAnnouncement = gainers || (announcement && !isAdmin);
  const shortScoutRoom = room === "shortscout" || room === "ss-announcements" || room === "ss-recordings";
  const roomLabel = CHAT_ROOMS.find(option => option.slug === room)!.label;
  const roomHref = (slug: ChatRoom) => `/chat?room=${slug}${popout ? "&popout=1" : ""}`;
  const loginHref = `/chat/login?room=${room}${popout?"&popout=1":""}`;
  const supabase = useMemo(() => createClient(), []);
  const [theme, setTheme] = useState<ChatTheme>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVisited,setSearchVisited]=useState(false);
  const [member, setMember] = useState<ChatMember | null>(bootstrap?.member ?? null);
  useEffect(()=>{publishMember(member);},[member,publishMember]);
  const activity=useChatActivity(member?.id);
  const {data:activityData,read:readActivity}=activity;
  const lastRoomRead=useRef('');
  const scrolledMention=useRef('');
  const [signedIn, setSignedIn] = useState(!!bootstrap);
  const [identityError, setIdentityError] = useState("");
  const [mobileActionsHost, setMobileActionsHost] = useState<HTMLDivElement | null>(null);





  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>(bootstrap ? (bootstrap.member ? "ready" : "name") : "checking");
  const [guestId, setGuestId] = useState(bootstrap?.member?.id ?? "");
  const [displayName, setDisplayName] = useState(bootstrap?.member?.display_name ?? "");
  const [chatterCount, setChatterCount] = useState(0);
  const [presenceReady, setPresenceReady] = useState(false);
  const [onlineMemberIds, setOnlineMemberIds] = useState<Set<string>>(new Set());
  const [nameDraft, setNameDraft] = useState(bootstrap?.member?.display_name ?? "");
  const {target:navigationReplyTarget,depth:replyDepth,mobile:mobileReplies,open:openReplies,back:backReplies,close:closeReplies}=useReplyNavigation(room,session.navigationOwner,!!pane);
  const replyTarget = recordings ? null : navigationReplyTarget;
  const replyDrafts=useRef<Record<string,ReplyDraft>>(snapshot?.replyDrafts??{});
  const uploads=useAttachments(room);
  const messageRetry=useRef<{key:string;id:string}|null>(null);

  const navRef=useRef<HTMLElement>(null);

  const navWasOpen=useRef(false);

  useEffect(() => { setRoomSelection(value => value + 1); setDmTarget(null); }, [room,setRoomSelection,setDmTarget]);
  const inlineDm = !!pane?.conversationId || dmView !== null;
  useEffect(()=>{setMobileNavOpen(false);},[room,mobileReplies,setMobileNavOpen]);
  useEffect(()=>{
    if(mobileNavOpen&&mobileReplies){navWasOpen.current=true;navRef.current?.querySelector<HTMLButtonElement>('button')?.focus();}
    else if(navWasOpen.current){navWasOpen.current=false;navTrigger.current?.focus({preventScroll:true});}
  },[mobileNavOpen,mobileReplies,navTrigger]);

  const replyTrigger=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{if(!replyTarget)replyTrigger.current?.focus({preventScroll:true});},[replyTarget]);
  const messageVersion=useRef(0);
  const [messages, updateMessages] = useState<PublicChatMessage[]>(bootstrap?.messages ?? []);
  const setMessages=useCallback((action:React.SetStateAction<PublicChatMessage[]>)=>{messageVersion.current++;updateMessages(action);},[]);
  const replyCounts=useReplyCounts(room,inlineDm?"":messages.filter(m=>!m.pending).map(m=>m.id).join(","),bootstrap?.counts);
  const [reactions, updateReactions] = useState<PublicChatReaction[]>(bootstrap?.reactions ?? []);
  const setReactions=useCallback((action:React.SetStateAction<PublicChatReaction[]>)=>{messageVersion.current++;updateReactions(action);},[]);
  const [body, setBody] = useState(snapshot?.draft??"");
  const [loading, setLoading] = useState(cold);
  const [nameState, setNameState] = useState<ActionState>("default");
  const [sendState, setSendState] = useState<ActionState>("default");
  useChatRefreshGuard(pane?.conversationId?undefined:member?.id,pane?.conversationId?null:`room:${room}`,body,setBody,uploads.blocked||uploads.files.length>0||(sendState==='loading'||sendState==='error')||messages.some(message=>message.pending)||Object.values(replyDrafts.current).some(draft=>!!draft.pending?.length),()=>{
    if(inlineDm||pane)return;
    const url=new URL(window.location.href);url.searchParams.set('room',room);url.searchParams.delete('dm');if(replyTarget)url.searchParams.set('thread',replyTarget);else url.searchParams.delete('thread');window.history.replaceState(window.history.state,'',url);
  });
  const restoredThread=useRef(false);
  useEffect(()=>{if(pane||recordings||!member||restoredThread.current)return;restoredThread.current=true;const id=new URL(window.location.href).searchParams.get('thread');if(id&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))openReplies(id);},[member,openReplies,pane,recordings]);
  const [popoutState, setPopoutState] = useState<ActionState>("default");
  const [roomStatus, setRoomStatus] = useState<PublicChatRoomState | null>(!cold&&bootstrap?.room===room?bootstrap.roomState:null);
  const [isOwner, setIsOwner] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  // Preserve search state after first use; never mount a closed search initially.
  useEffect(()=>{if(searchOpen&&!inlineDm)setSearchVisited(true);},[searchOpen,inlineDm]);
  const [adminState, setAdminState] = useState<ActionState>("default");
  const [adminAction, setAdminAction] = useState<"room" | "summary" | null>(null);
  const [adminFeedback, setAdminFeedback] = useState("");
  const [adminReason, setAdminReason] = useState("");
  const [summaries, setSummaries] = useState<AdminSummary[]>([]);
  const [error, setError] = useState("");
  const mentionNamesSignature=useMemo(()=>JSON.stringify([...new Set(["Buddy",...(member?.display_name?[member.display_name]:[]),...messages.filter(message=>message.member_id).map(message=>message.author_label)])]),[messages,member?.display_name]);
  const mentionNames=useMemo<string[]>(()=>JSON.parse(mentionNamesSignature),[mentionNamesSignature]);
  const canMessage=!!member;
  const openPrivateMessage=useCallback((id:string,name:string)=>{if(pane){pane.onPrivateMessage?.(id);return;}if(!canMessage){window.location.href=loginHref;return;}setDmTarget({id,name});},[canMessage,loginHref,setDmTarget,pane]);
  const openMessageReplies=useCallback((id:string,trigger:HTMLButtonElement)=>{replyTrigger.current=trigger;openReplies(id);},[openReplies]);
  const editMessage=useCallback((updated:PublicChatMessage)=>setMessages(current=>mergeRoomMessage(current,updated)),[setMessages]);
  const deleteMessage=useCallback((id:string)=>{setMessages(current=>current.filter(message=>message.id!==id));setReactions(current=>current.filter(reaction=>reaction.message_id!==id));},[setMessages,setReactions]);
  const pinnedToBottom = useRef(true);
  const [openingReady,setOpeningReady]=useState(false);
  const openingPending=useRef(true),openingAnchor=useRef<string|null>(null),openingMoved=useRef(false);
  const openingCancelled=useRef(false),openingReadThrough=useRef(0);
  const [roomScrollVersion,setRoomScrollVersion]=useState(0);
  const cancelOpening=()=>{openingCancelled.current=true;openingMoved.current=true;pinnedToBottom.current=false;};
  const initialScrollDone = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const mobilePage=useRef<HTMLElement>(null);
  useEffect(()=>mobilePage.current?watchChatViewport(mobilePage.current):undefined,[]);
  const loadedRoom = useRef<ChatRoom | null>(cold?null:bootstrap?.room??null);
  const latestSnapshot=useRef<RoomSnapshot|null>(null);
  latestSnapshot.current=accountId&&roomStatus?{bootstrap:{accountId,room,member,roomState:roomStatus,messages,reactions,counts:replyCounts,featureChannel},draft:body,replyDrafts:replyDrafts.current,scroll:messagesRef.current?.scrollTop??snapshot?.scroll??0,pinned:pinnedToBottom.current}:null;
  const saveSnapshot=()=>{if(latestSnapshot.current)onSnapshot({...latestSnapshot.current,scroll:messagesRef.current?.scrollTop??latestSnapshot.current.scroll,pinned:pinnedToBottom.current});};
  useLayoutEffect(()=>()=>{if(latestSnapshot.current)onSnapshot({...latestSnapshot.current,scroll:messagesRef.current?.scrollTop??latestSnapshot.current.scroll,pinned:pinnedToBottom.current});},[onSnapshot]);
  useEffect(()=>{
    if(!member?.id||identityStatus!=='ready'||inlineDm)return;
    const controller=new AbortController();
    openingPending.current=true;setOpeningReady(false);openingCancelled.current=false;openingMoved.current=false;
    initialScrollDone.current=false;openingAnchor.current=null;openingReadThrough.current=0;pinnedToBottom.current=true;
    const deepLink=window.location.hash.startsWith('#chat-message-')||new URL(window.location.href).searchParams.has('thread');
    if(deepLink){openingMoved.current=true;pinnedToBottom.current=false;initialScrollDone.current=true;openingPending.current=false;setOpeningReady(true);return;}
    void (async()=>{
      const response=await fetch(`/api/chat/opening?room=${room}`,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Could not find your unread messages. Reopen this room to retry.');
      const result=await response.json();
      openingReadThrough.current=Number(result.readThrough)||0;
      if(result.messageId){
        const history=await fetch(`/api/chat/history?room=${room}&anchor=${result.messageId}`,{cache:'no-store',signal:controller.signal});
        if(!history.ok)throw new Error('Could not load your unread conversation.');
        const page=await history.json();
        if(controller.signal.aborted)return;
        openingAnchor.current=result.messageId;pinnedToBottom.current=false;
        setMessages(current=>reconcileRoomMessages(current,page.messages));
      }
      if(controller.signal.aborted)return;
      openingPending.current=false;setOpeningReady(true);
    })().catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Chat unavailable');});
    return()=>controller.abort();
  },[member?.id,identityStatus,room,inlineDm,setMessages]);
  const summaryRetry = useRef<{room:string;id:string}|null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(()=>{
    const openingThrough=!openingCancelled.current&&openingMoved.current?openingReadThrough.current:0;
    const renderedThrough=messages.reduce((max,message)=>Math.max(max,message.unread_seq??0),0);
    const activityThrough=activityData.roomMessageThrough?.[room]??0;
    const roomThrough=pinnedToBottom.current?Math.min(activityThrough,Math.max(renderedThrough,openingThrough)):openingThrough;
    // Activity can race ahead of rendered history. Do not clear those unseen messages/mentions.
    const through=pinnedToBottom.current&&roomThrough>=activityThrough?(activityData.roomThrough[room]??0):0;
    if(pane?.visible===false||openingPending.current||!openingReady||!member||loading||loadedRoom.current!==room||identityStatus!=='ready'||searchOpen||inlineDm||document.hidden||document.querySelector('dialog[open]')||(!through&&!roomThrough))return;
    const key=`${member.id}:${room}:${through}:${roomThrough}`;if(lastRoomRead.current===key)return;
    lastRoomRead.current=key;
    void readActivity({kind:'room',room,mentionThrough:through,roomThrough}).catch(()=>{if(lastRoomRead.current===key)lastRoomRead.current='';});
  },[activityData,readActivity,member,loading,identityStatus,room,searchOpen,inlineDm,openingReady,roomScrollVersion,messages,pane?.visible]);
  useEffect(()=>{
    const controller=new AbortController();
    if(pane)return;
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
  },[loading,messages,room,openReplies,pane]);

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
  }, [room, isAdmin,pane]);

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
        clearSession();setMember(null); setDmTarget(null); setSignedIn(false); setGuestId(""); setIdentityStatus("checking"); setMessages([]); setReactions([]);
        window.location.reload();
      }
      previous = id;
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, room, serverSession, accountId, setMessages, setReactions,clearSession,setDmTarget]);

  useEffect(() => {
    if(inlineDm)return;
    let cancelled=false;
    if(loadedRoom.current!==room)setLoading(true);
    const load=async()=>{
      try {
        const version=messageVersion.current;
        const requestedAnchor=openingAnchor.current;
        const response=await updates.read(`/api/chat/history?room=${room}${requestedAnchor?`&anchor=${requestedAnchor}`:''}`);
        const result=await response.json();
        if(cancelled)return;
        if(response.status===401||response.status===403){clearSession();setMessages([]);setReactions([]);window.location.replace(loginHref);return;}
        if(!response.ok)throw new Error('Chat history did not load. Please try again.');
        if(version!==messageVersion.current||requestedAnchor!==openingAnchor.current){updates.invalidate("history");return;}
        loadedRoom.current=room;
        // Do not drop pending local sends while a reconciliation is in flight.
        setMessages(current=>reconcileRoomMessages(current,result.messages));
        setReactions(result.reactions);setLoading(false);
      } catch(e){if(!cancelled){setError(e instanceof Error?e.message:'Chat unavailable');setLoading(false);}}
    };
    const stop=updates.watch(load,['history'],true,60000);
    const message=(event:Event)=>{
      const payload=(event as CustomEvent).detail;
      if(payload.eventType==='DELETE')setMessages(current=>current.filter(m=>m.id!==payload.old.id));
      else if(payload.new.room_slug===room){
        // Realtime rows do not carry the trusted current-membership projection.
        setMessages(current=>mergeRoomMessage(current,{...payload.new,memberships:[]} as PublicChatMessage));
        updates.invalidate('history');
      }
    };
    const reaction=(event:Event)=>{
      const payload=(event as CustomEvent).detail;
      if(payload.new?.message_id)setReactions(current=>mergeReaction(current,payload.new as PublicChatReaction));
    };
    window.addEventListener('chat-room-event',message);window.addEventListener('chat-reaction-event',reaction);
    return()=>{cancelled=true;stop();window.removeEventListener('chat-room-event',message);window.removeEventListener('chat-reaction-event',reaction);};
  },[updates,room,inlineDm,loginHref,setMessages,setReactions,clearSession]);

  useEffect(() => {
    if(pane?.conversationId)return;
    let channel: RealtimeChannel | null = null;
    const presenceKey = guestId || `observer-${crypto.randomUUID()}`;

    channel = supabase.channel(`longboard-public-chat-presence-${room}`, {
      config: { presence: { key: presenceKey } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setPresenceReady(true);
        const presence = channel?.presenceState<{guestId?: string}>() ?? {};
        setChatterCount(countChatters(presence));
        setOnlineMemberIds(new Set(Object.values(presence).flat().map(item=>item.guestId).filter((id): id is string=>typeof id === "string")));
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
  }, [guestId, identityStatus, supabase, room,pane?.conversationId]);

  useEffect(() => {
    const node = messagesRef.current;
    if (((replyTarget || mobileNavOpen) && mobileReplies) || searchOpen || inlineDm || !node || loading || identityStatus === "checking" || (identityStatus === "name" && roomStatus?.isOpen !== false)) return;
    if(openingPending.current)return;
    if(!openingMoved.current&&openingAnchor.current&&!openingCancelled.current){
      const target=messagesRef.current?.querySelector<HTMLElement>(`[id="chat-message-${openingAnchor.current}"]`);
      if(target&&node.contains(target)){node.scrollTop+=target.getBoundingClientRect().top-node.getBoundingClientRect().top;openingMoved.current=true;initialScrollDone.current=true;pinnedToBottom.current=false;}
    }
    if ((!initialScrollDone.current&&!openingCancelled.current) || pinnedToBottom.current) {
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
  }, [messages, loading, identityStatus, roomStatus?.isOpen, searchOpen, replyTarget, mobileReplies, mobileNavOpen, inlineDm,openingReady]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
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
        setBody('');setSendState('success');
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
    const mobileSend=beginMobileSend(event.currentTarget.querySelector('textarea'),messagesRef.current);
    pinnedToBottom.current = true;
    setMessages((current) => [...current, optimistic]);
    setBody("");

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
      mobileSend.confirmed();
      setSendState("success");
      timerRef.current = setTimeout(() => setSendState("default"), 1400);
    } catch (caught) {
      mobileSend.cancel();
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setBody(nextBody);
      setError(caught instanceof Error ? caught.message : "That message was not sent.");
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
    <main ref={mobilePage} className={`${styles.page} ${fontVariableClass}`} data-pane={!!pane} data-popout={popout} data-theme={theme} data-room={shortScoutRoom ? "shortscout" : room}>
      <div className={styles.shell} data-reply-open={!!replyTarget && !inlineDm} data-nav-open={mobileNavOpen} data-dm-open={inlineDm}>
          {!pane&&<nav ref={navRef} id="chat-room-navigation" className={styles.roomTabs} aria-label="Chat rooms" inert={mobileReplies&&(!mobileNavOpen||(!!replyTarget&&!inlineDm))} onKeyDown={event=>{
            if(!mobileReplies||!mobileNavOpen)return;
            if(event.key==='Escape'){event.preventDefault();setMobileNavOpen(false);return;}
            if(event.key!=='Tab')return;
            const controls=Array.from(navRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled)')??[]);
            const first=controls[0],last=controls[controls.length-1];
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
            if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
          }}>
            <button type="button" className={styles.mobileNavBack} onClick={()=>setMobileNavOpen(false)}>Back to chat →</button>
            {member&&<ChatPins key={`pins:${member.id}`} memberId={member.id} onNavigate={pin=>{saveSnapshot();setSearchOpen(false);setMobileNavOpen(false);if(pin.kind==="room"){setRoomSelection(value=>value+1);setDmTarget(null);onNavigate(pin.room);}else window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:pin.conversationId}));}}/>}
            <div className={styles.navHeading}>YOUR COMMUNITIES</div>
            <div className={styles.navPresence} aria-live="polite"><strong>{roomLabel}</strong><span className={styles.onlineCount} data-live={presenceReady && !roomPaused} data-paused={roomPaused || undefined}><i aria-hidden="true" />{roomPaused ? "Paused" : gainers ? "Live Gainers alerts" : announcement ? "Admin posts only" : presenceReady ? `${chatterCount} online` : "Connecting…"}</span></div>
            {featureChannel && <Link href="/chat/features">FEATURES 🔒</Link>}
            {CHAT_ROOMS.filter(option=>!isAnnouncementRoom(option.slug)||allowedRooms.includes(option.slug)).map((option) => !allowedRooms.includes(option.slug) ? <Link key={option.slug} href={option.slug==="shortscout"?`/api/chat/login/start?link=1&room=shortscout${popout?"&popout=1":""}`:`/login?next=${encodeURIComponent(roomHref(option.slug))}`} title="Sign in with this membership">{option.label} 🔒</Link> : <Link key={option.slug} href={roomHref(option.slug)} scroll={false} onClick={(event) => {
              setRoomSelection(value => value + 1); setDmTarget(null);
              if (option.slug === room) { event.preventDefault(); setSearchOpen(false); setMobileNavOpen(false); return; }
              if (sendState === "loading" || adminAction) { event.preventDefault(); return; }
              if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
              event.preventDefault();saveSnapshot();onNavigate(option.slug);
              setMobileNavOpen(false);
            }} aria-current={!searchOpen && !inlineDm && room === option.slug ? "page" : undefined}>{option.label}{(activity.data.roomMessageCounts?.[option.slug]??0)>0&&<span className={styles.activityBadge} aria-label={`${activity.data.roomMessageCounts?.[option.slug]} unread messages`}>{activity.data.roomMessageCounts?.[option.slug]}</span>}</Link>)}
            <button type="button" className={styles.searchTab} aria-pressed={searchOpen} onClick={() => {setRoomSelection(value => value + 1);setDmTarget(null);setSearchOpen((open) => !open);setMobileNavOpen(false);}}>⌕ Search</button>
            <span>{gainers ? "Gainers · Broadcast only" : recordings ? "Recordings · Admin posts only" : announcement ? "Announcements · Admin posts only" : room === "shortscout" ? "Short selling" : room === "social" ? "Movies, life & everything else" : "Trading & the markets"}</span>
            <div ref={setMobileActionsHost} className={styles.mobileNavActions} />
            {member&&<RoomMemberList key={`${member.id}:${room}`} room={room} roomLabel={roomLabel} memberId={member.id} onlineIds={onlineMemberIds} presenceReady={presenceReady} onSelect={target=>{setDmTarget(target);setMobileNavOpen(false);}}/>}
            {member&&<StartDirectMessage key={member.id} onSelect={target=>{setDmTarget(target);setMobileNavOpen(false);}}/>}
            <div ref={setDmSidebarHost} className={styles.dmSidebarHost} />
          </nav>}
        <section className={styles.chat} inert={mobileReplies&&((!!replyTarget&&!inlineDm)||mobileNavOpen)} aria-label={gainers ? "Gainers alerts" : shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"}>
          {!pane&&<header className={styles.header} data-dm={inlineDm}>
            <div className={styles.compactBrand}>
              {inlineDm ? <><button ref={navTrigger} type="button" className={styles.dmRoomBack} aria-label={`Back to ${roomLabel} room`} title={`Back to ${roomLabel} room`} onClick={()=>{setRoomSelection(value=>value+1);setDmTarget(null);setSearchOpen(false);}}><span aria-hidden="true">←</span><span>{roomLabel}</span></button><div className={styles.communityTitle}><h1 title={dmView??undefined}>{dmView}</h1></div></> : <>
              <button ref={navTrigger} type="button" className={styles.mobileNavArrow} aria-label="Open room navigation" aria-expanded={mobileNavOpen} aria-controls="chat-room-navigation" onClick={()=>setMobileNavOpen(true)}>←</button>
              {room === "social" ? <span className={styles.lbMark} role="img" aria-label="Social community" title="Social community"><SocialCommunityIcon /></span> : <span className={styles.lbMark} aria-label={gainers ? "Gainers alerts" : shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"} title={gainers ? "Gainers alerts" : shortScoutRoom ? "SHORTSCOUT Chat" : "Longboard Chat"}>{gainers ? "G" : shortScoutRoom ? "SS" : "LB"}<span aria-hidden="true">{gainers ? "↗" : shortScoutRoom ? "↘" : "🌴"}</span></span>}
              <div className={`${styles.communityTitle} ${styles.roomHeaderTitle}`}><h1 title={announcement || gainers ? roomLabel : room === "shortscout" ? "ShortScout" : room === "social" ? "Social" : "Longboard"}>{announcement || gainers ? roomLabel : room === "shortscout" ? "ShortScout" : room === "social" ? "Social" : "Longboard"}</h1>{<span className={styles.onlineCount} data-live={presenceReady && !roomPaused} data-paused={roomPaused || undefined} aria-live="polite">
                <i aria-hidden="true" />{roomPaused ? "Paused" : gainers ? "Live Gainers alerts" : announcement ? "Admin posts only" : presenceReady ? `${chatterCount} online` : "Connecting…"}
              </span>}
            </div></>}
            </div>
            <div className={styles.headerActions}>
              {gainers && !inlineDm && !popout && <button type="button" className={styles.headerSearch} aria-label="Pop out Gainers" title="Pop out Gainers" onClick={openPopout}>↗ <span>Pop out</span></button>}
              <button type="button" className={styles.headerSearch} aria-label="Search chat" aria-pressed={searchOpen && !inlineDm} onClick={() => {setRoomSelection(value => value + 1);setDmTarget(null);setSearchOpen(true);}}>⌕ <span>Search chat</span></button>
              {member && <ChatActivityBell data={activity.data} error={activity.error} read={activity.read}/>}
              {featureChannel && <FeatureNotifications showLabel portalHost={mobileReplies || inlineDm ? mobileActionsHost : null}/>}

              <ChatHeaderMenu>{(close) => <>
                {member&&!inlineDm&&<ChatPins key={`pin:${member.id}:${room}`} memberId={member.id} target={{kind:"room",room}} label={roomLabel}/> }
                {member&&<ChatFavorite key={member.id} memberId={member.id} target={inlineDm?null:{kind:"room",room}} label={roomLabel} shortcut onNavigate={favorite=>{saveSnapshot();close();setSearchOpen(false);setMobileNavOpen(false);if(favorite.kind==="room")onNavigate(favorite.room);else window.dispatchEvent(new CustomEvent('chat-open-dm',{detail:favorite.conversationId}));}}/>}
                <Link className={styles.menuItem} href="/chat/quad">Quad view</Link>
                <button type="button" className={styles.menuItem} onClick={()=>{close();window.dispatchEvent(new Event('chat-refresh-app'));}}>Refresh app</button>
                <button type="button" className={styles.menuItem} onClick={()=>{close();window.dispatchEvent(new Event('chat-open-install-guide'));}}>Install on phone</button>
                {accountId&&<button type="button" className={styles.menuItem} onClick={()=>{close();window.dispatchEvent(new Event('chat-open-push-settings'));}}>Phone notifications</button>}
                {inlineDm&&<button type="button" className={styles.menuItem} onClick={()=>{close();setMobileNavOpen(mobileReplies);requestAnimationFrame(()=>{const details=dmSidebarHost?.querySelector<HTMLDetailsElement>('[data-dm-settings]')??dmSidebarHost?.querySelector<HTMLDetailsElement>('details');if(details){details.open=true;details.querySelector<HTMLElement>('summary')?.focus();}});}}>DM settings</button>}
                <div className={styles.menuIdentity}>
                  <span>{signedIn ? "Signed in" : "Guest chat"}</span>
                  <strong>{displayName || "Welcome to Longboard"}</strong>
                </div>
                {!signedIn ? <Link className={styles.menuItem} href={loginHref}>Sign in for private messages <span aria-hidden="true">↗</span></Link> : !member ? <button type="button" className={styles.menuItem} onClick={() => { setIdentityStatus("name"); close(); }}>Link your member name</button> : null}
                {identityStatus === "ready" && !member ? <button type="button" className={styles.menuItem} onClick={() => { setError(""); setNameState("default"); setIdentityStatus("name"); close(); }}>Change chat name</button> : null}
                {hasSeparateShortScoutProfile && <a className={styles.menuItem} href="/chat/login/connected">Original ShortScout profile / membership settings →</a>}
                {canLinkShortScout ? <a className={styles.menuItem} href={`/api/chat/login/start?link=1&room=shortscout${popout?"&popout=1":""}`}>Connect ShortScout →</a> : null}
                {serverSession ? <button className={styles.menuItem} onClick={async()=>{
                  try{if(accountId)await disableCurrentChatPush(accountId);}catch{setError("Could not turn off this device's notifications. Please try signing out again.");return;}
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
                {!popout ? <button type="button" className={styles.menuItem} disabled={popoutState === "loading"} onClick={() => { openPopout(); close(); }}>{gainers ? "Pop out Gainers" : "Pop out chat"} <span aria-hidden="true">↗</span></button> : <Link className={styles.menuItem} href={`/chat?room=${room}`}>{gainers ? "Return to Gainers" : "Open full page"} <span aria-hidden="true">↗</span></Link>}
              </>}</ChatHeaderMenu>
            </div>
          </header>}



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
          <div className={styles.searchPane} hidden={!searchOpen || inlineDm}>{(searchVisited||(searchOpen&&!inlineDm))&&<ChatSearch room={room === "main" || room === "social" ? room : (allowedRooms.includes("main")?"main":"social")} allowLongboard={allowedRooms.includes("main")} />}</div>
          {!pane?.conversationId&&<div className={styles.roomPane} hidden={searchOpen || inlineDm}>
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
              <div ref={messagesRef} onWheel={cancelOpening} onTouchStart={cancelOpening} onKeyDown={cancelOpening} onScroll={(event) => { if (searchOpen) return; const node = event.currentTarget; pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64; setRoomScrollVersion(value=>value+1); }} className={styles.messages} aria-live="polite" aria-busy={loading}>
                {roomPaused ? (
                  <div className={styles.pauseBanner} role="status">
                    <strong>CHAT PAUSED · HISTORY IS READ ONLY</strong>
                    <span>{gainers ? "Gainers alerts appear here automatically. This channel is read-only." : recordings ? "Only admins can post recordings. You can react, but replies are disabled." : readOnlyAnnouncement ? "Only admins can post in this announcement channel. New announcements appear in your notification bell." : pauseNotice}</span>
                  </div>
                ) : null}
                {loading ? (
                  <div className={styles.loading}>Loading the room…</div>
                ) : messages.length === 0 ? (
                  <div className={styles.empty}>
                    <strong>No messages yet.</strong>
                    <button type="button" className={styles.searchTab} aria-pressed={searchOpen} onClick={() => {setRoomSelection(value => value + 1);setDmTarget(null);setSearchOpen((open) => !open);setMobileNavOpen(false);}}>⌕ Search</button>
            <span>{gainers ? "New Gainers alerts will appear here." : recordings ? "New recordings will appear here." : announcement ? "New announcements will appear here." : room === "social" ? "Seen a good movie lately? Start the conversation." :  `Start the ${roomLabel} conversation below.`}</span>
                  </div>
                ) : messages.map(message=><RoomMessageRow key={message.id} message={message} room={room} memberId={member?.id} guestId={guestId} themeReady={themeReady} isAdmin={isAdmin} roomPaused={roomPaused} readOnlyAnnouncement={readOnlyAnnouncement} replyCount={replyCounts[message.id]??0} replyOpen={replyTarget===message.id} reactionsActive={!inlineDm&&(!mobileReplies||(!replyTarget&&!mobileNavOpen))} mentionNames={mentionNames} onPrivateMessage={openPrivateMessage} onReply={openMessageReplies} onEdited={editMessage} onDeleted={deleteMessage}/>)}
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
                      aria-describedby={pane?`feedback-${room}`:"longboard-chat-feedback"}
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
                      <VoiceRecorder key={room} uploads={uploads} disabled={sendState === "loading"}/>
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
                  <p id={pane?`feedback-${room}`:"longboard-chat-feedback"} className={styles.feedback} data-error={Boolean(error)} aria-live="polite">
                    {feedback}{!pane&&<> · Enter to send · Shift+Enter for a new line. {recordings ? "Recordings alert members of this community. Replies are disabled." : announcement ? "Announcements alert members of this community." : room === "shortscout" ? "Use /summary for a private room recap. Messages are saved and visible to verified ShortScout members and chat admins." : "Use /summary for a private room recap. Messages are saved, searchable by members, and may be processed for AI search and private summaries."} {room === "main" ? "Buddy replies only to @Buddy." : ""}</>}
                  </p>
                </form>
              ) : !gainers ? (
                <div className={styles.readOnlyFooter}>
                  <strong>{readOnlyAnnouncement&&!roomPaused ? "ADMIN POSTS ONLY" : "READ-ONLY MODE"}</strong>
                  <span>{recordings&&!roomPaused ? "You can react to recordings. Only admins can post. Replies are disabled." : readOnlyAnnouncement&&!roomPaused ? "You can react to announcements. Only admins can post. New announcements appear in your notification bell." : pauseNotice}</span>
                </div>
              ) : null}
            </>
          )}
          </div>}
        </section>
        {!recordings&&replyTarget&&!inlineDm&&<ChatReplyPanel isolated={!!pane} key={`${member?.id??"anonymous"}:${room}:${replyTarget}`} messageId={replyTarget} memberId={member?.id} room={room} paused={roomPaused} readOnly={readOnlyAnnouncement} depth={replyDepth} onBack={backReplies} onOpen={openReplies} draft={replyDrafts.current[`${member?.id??"anonymous"}:${room}:${replyTarget}`]??(replyDrafts.current[`${member?.id??"anonymous"}:${room}:${replyTarget}`]={body:"",scroll:0})} onClose={closeReplies} onSent={message=>setMessages(current=>mergeRoomMessage(current,message))}/>}
      </div>
    </main>
  );
}

export default function PublicChat(props:PublicChatProps) {
 const sharedUpdates=useChatUpdates();
 const navigationOwner=useId();
 const [cache]=useState(()=>new ChatRoomCache(props.accountId??''));
 const [selection,setSelection]=useState<{room:ChatRoom;snapshot:RoomSnapshot|null;initial:boolean}>({room:props.room,snapshot:null,initial:true});
 const [member,setMember]=useState(props.bootstrap?.member??null);
 const [dmView,setDmView]=useState<string|null>(props.pane?.conversationId?"Direct messages":null),[dmTarget,setDmTarget]=useState<{id:string;name:string}|null>(null);
 const [roomSelection,setRoomSelection]=useState(0),[mobileNavOpen,setMobileNavOpen]=useState(false);
 const [dmSidebarHost,setDmSidebarHost]=useState<HTMLDivElement|null>(null),[dmConversationHost,setDmConversationHost]=useState<HTMLDivElement|null>(null);
 const navTrigger=useRef<HTMLButtonElement>(null);
 const room=selection.room;
 const revoked=useRef(false);
 const save=useCallback((snapshot:RoomSnapshot)=>{if(!revoked.current)cache.set(snapshot.bootstrap.room,snapshot);},[cache]);
 const clearSession=useCallback(()=>{revoked.current=true;cache.clear();try{clearChatDrafts(window.sessionStorage);}catch{};setMember(null);setDmTarget(null);setDmView(null);},[cache]);
 const select=useCallback((next:ChatRoom)=>{setSelection({room:next,snapshot:cache.get(next),initial:false});setRoomSelection(v=>v+1);setDmTarget(null);setDmView(null);setMobileNavOpen(false);},[cache]);
 useEffect(()=>{if(props.pane)return;const restore=()=>{const next=parseChatRoom(new URL(window.location.href).searchParams.get('room'));if(next&&props.allowedRooms?.includes(next)&&next!==room)select(next);};window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[room,props.allowedRooms,select,props.pane]);
 const previousRoom=useRef(props.room);
 useEffect(()=>{if(previousRoom.current!==props.room){previousRoom.current=props.room;select(props.room);}},[props.room,select]);
 useEffect(()=>()=>cache.clear(),[cache]);
 const navigate=(next:ChatRoom)=>{window.history.pushState({...window.history.state,chatReply:undefined},'',`/chat?room=${next}${props.popout?'&popout=1':''}`);select(next);};
 const onDmViewChange=useCallback((name:string|null)=>{setDmView(name);if(name)setMobileNavOpen(false);},[]);
 const onTargetClosed=useCallback(()=>setDmTarget(null),[]);
 const bridge={navigationOwner,dmView,setDmView,roomSelection,setRoomSelection,dmTarget,setDmTarget,dmSidebarHost,setDmSidebarHost,dmConversationHost,setDmConversationHost,navTrigger,setMember,mobileNavOpen,setMobileNavOpen};
 const bootstrap=selection.snapshot?{...selection.snapshot.bootstrap,member}:(selection.initial&&props.bootstrap?.room===room?props.bootstrap:props.bootstrap?{...props.bootstrap,member,room,messages:[],reactions:[],counts:{}}:undefined);
 const realtime=!props.serverSession&&(props.realtimeRooms?.includes(room)??(room===props.room&&!!props.roomRealtime));
 const contents=<ChatSessionContext.Provider value={bridge}><AttachmentMetadataProvider owner={revoked.current?'':props.accountId??''}><MessageReactionProvider>
 {!props.pane&&<><ChatInstallGuide signedIn={!!props.accountId}/><ChatAppControls version={props.appVersion??'development'}/>{props.accountId&&<ChatPushSettings accountId={props.accountId}/>}</>}
 <PublicChatContent key={room} cold={!selection.initial&&!selection.snapshot} {...props} room={room} bootstrap={bootstrap} snapshot={selection.snapshot} onSnapshot={save} onNavigate={navigate} clearSession={clearSession}/>
 {member&&(!props.pane||props.pane.conversationId)&&<DirectInbox controlledConversation={props.pane?.conversationId} key={member.id} member={member} target={dmTarget} onTargetClosed={onTargetClosed} fallbackFocus={navTrigger} sidebarHost={dmSidebarHost} conversationHost={dmConversationHost} conversationVisible={!mobileNavOpen&&props.pane?.visible!==false} roomSelection={roomSelection} onViewChange={onDmViewChange}/>}
 </MessageReactionProvider></AttachmentMetadataProvider></ChatSessionContext.Provider>;
 return sharedUpdates?contents:<ChatUpdatesProvider onUnauthorized={clearSession} room={room} serverSession={!!props.serverSession} pollingRoom={!realtime}>{contents}</ChatUpdatesProvider>;
}
