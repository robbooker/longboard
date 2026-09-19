"use client";
import ChatFavorite from "./ChatFavorite";
import {mergeConfirmedMessages,pendingForScope,reconcilePendingMessages,type PendingChatMessage} from "@/lib/chatPendingMessages";
import {ChatDmCache} from "@/lib/chatDmCache";
import MessageReactions from "./MessageReactions";

import {useChatRefreshGuard} from './hooks/useChatRefreshGuard';
import VoiceRecorder from './VoiceRecorder';
import { canReply,type ChatMember,type DirectConversation,type DirectMessage } from "@/lib/chatDirectMessages";
import { handleChatKeyDown } from "@/lib/chatKeyboard";
import { chatTimestamp,chatTimestampTitle } from "@/lib/chatTimestamp";
import type { ChatUpdateCoordinator } from "@/lib/chatUpdateCoordinator";
import { FormEvent,type RefObject,useCallback,useEffect,useLayoutEffect,useRef,useState } from "react";
import { createPortal } from "react-dom";
import { AttachmentPicker } from "./ChatAttachments";
import { GifComposer } from "./ChatGif";
import ChatMessageBody from "./ChatMessageBody";
import { useChatUpdates } from "./ChatUpdates";
import DirectAttachments from "./DirectAttachments";
import styles from "./DirectInbox.module.css";
import DirectMessageActions from "./DirectMessageActions";
import { useDmSound } from "./hooks/useDmSound";
import { isDmChoice } from "@/lib/dmSound";
import { useAttachments } from "./hooks/useAttachments";

const EMPTY_DIRECT_MESSAGES:DirectMessage[]=[];
type Target = { id: string; name: string };
type InboxResult = { conversations?: DirectConversation[]; messages?: DirectMessage[]; hasMore?: boolean; conversationId?: string; message?: DirectMessage | null };
class InboxError extends Error {constructor(message:string,readonly status:number){super(message);}}
async function requestInbox(body?: Record<string, unknown>, query = "", updates?:ChatUpdateCoordinator|null): Promise<InboxResult> {
  const response = await (!body&&updates ? updates.read(`/api/chat/inbox${query}`) : fetch(`/api/chat/inbox${query}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" }));
  const result = await response.json();
  if (!response.ok) throw new InboxError(result.error || "Your inbox could not load. Please try again.",response.status);
  return result;
}

export default function DirectInbox({ member, target, onTargetClosed, fallbackFocus, sidebarHost, conversationHost, conversationVisible = true, roomSelection = 0, onViewChange }: {
  member: ChatMember; target: Target | null; onTargetClosed: () => void;
  fallbackFocus?: RefObject<HTMLButtonElement | null>;
  sidebarHost?: HTMLElement | null; conversationHost?: HTMLElement | null;
  conversationVisible?: boolean; roomSelection?: number; onViewChange?: (name: string | null) => void;
}) {
  const sounds=useDmSound(member.id);
  const observeSounds=sounds.observe;
  const updates=useChatUpdates();
  const inbox=useCallback((body?:Record<string,unknown>,query="")=>requestInbox(body,query,updates),[updates]);
  const [open, setOpen] = useState(false);
  const [stateOwner,setStateOwner] = useState(member.id);
  const [conversationRows, setConversations] = useState<DirectConversation[]>([]);
  const conversations=stateOwner===member.id?conversationRows:[];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recipientState, setRecipient] = useState<Target | null>(null);
  const recipient=stateOwner===member.id?recipientState:null;
  const [messageRows, setMessages] = useState<DirectMessage[]>([]);
  const messages=stateOwner===member.id?messageRows:EMPTY_DIRECT_MESSAGES;
  const messagesRef = useRef<DirectMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraftState] = useState("");
  const draftRef=useRef("");
  const setDraft=useCallback((value:string)=>{draftRef.current=value;setDraftState(value);},[]);
  const cache=useRef(new ChatDmCache(member.id));
  const hasMoreRef=useRef(hasMore);hasMoreRef.current=hasMore;
  const restoreScroll=useRef<number|null>(null);
  const nearBottom=useRef(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [acceptsRequests, setAcceptsRequests] = useState(member.accepts_requests);
  const [listReady, setListReady] = useState(false);
  const openRef = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const focusedConversation = useRef<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const selected = useRef<string | null>(null);
  const readId = useRef("");
  const loadVersion = useRef(0);
  const historyLoaded = useRef(false);
  const listVersion = useRef(0);
  const [outbox,setOutbox] = useState<PendingChatMessage[]>([]);
  const outboxRef = useRef<PendingChatMessage[]>([]);
  const inFlight = useRef(new Set<string>());
  const owner = useRef(member.id); owner.current=member.id;
  const scopeRef = useRef<string|null>(null);
  const draftVersion = useRef(0), consumedDraft = useRef("");
  const scope = stateOwner!==member.id ? null : recipient ? `request:${recipient.id}` : activeId ? `conversation:${activeId}` : null;
  scopeRef.current=scope;
  const localRows = pendingForScope(outbox,member.id,scope);
  const requestQueued = Boolean(recipient&&localRows.length);
  const updateOutbox = useCallback((change:(rows:PendingChatMessage[])=>PendingChatMessage[])=>{
    outboxRef.current=change(outboxRef.current);setOutbox(outboxRef.current);
  },[]);
  const alive = useRef(true);
  const active = conversations.find((c) => c.id === activeId);
  const uploads=useAttachments({conversationId:activeId});
  useChatRefreshGuard(member.id,scope,draft,setDraft,uploads.blocked||uploads.files.length>0||busy||outbox.some(row=>row.status!=='sent')||report!==null,()=>{
    if(!open||!activeId)return;const url=new URL(window.location.href);url.searchParams.set('dm',activeId);url.searchParams.delete('thread');window.history.replaceState(window.history.state,'',url);
  });
  const badge = conversations.reduce((sum, c) => sum + (c.unavailable ? 0 : c.unread), 0);

  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { onViewChange?.(open ? recipient?.name ?? active?.otherName ?? "Direct messages" : null); }, [open, recipient?.name, active?.otherName, onViewChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(()=>{cache.current.reset(member.id);setStateOwner(member.id);outboxRef.current=[];setOutbox([]);setMessages([]);messagesRef.current=[];setConversations([]);setActiveId(null);selected.current=null;setRecipient(null);setDraft("");setListReady(false);loadVersion.current++;listVersion.current++;draftVersion.current++;},[member.id,setDraft]);
  const refreshList = useCallback(async () => {
    const version = ++listVersion.current;
    let result:InboxResult;
    try{result=await inbox();}catch(e){
      if(e instanceof InboxError&&[401,403].includes(e.status)&&owner.current===member.id){cache.current.reset(member.id);messagesRef.current=[];setMessages([]);setConversations([]);setDraft("");loadVersion.current++;}
      throw e;
    }
    if (!alive.current || owner.current!==member.id || version !== listVersion.current) return [];
    const rows = result.conversations ?? [];
    observeSounds(rows);
    const allowed=new Set(rows.filter(c=>!c.unavailable&&!c.blockedByMe&&c.status!=="declined").map(c=>c.id));
    cache.current.retain(allowed);
    if(selected.current&&!allowed.has(selected.current)){messagesRef.current=[];setMessages([]);setDraft("");loadVersion.current++;setLoading(false);}
    setConversations(rows); setListReady(true);
    return rows;
  }, [inbox,observeSounds,member.id,setDraft]);
  const refreshMessages = useCallback(async (id: string) => {
    const version = ++loadVersion.current;
    let result:InboxResult;
    try{result=await inbox(undefined, `?conversation=${id}`);}catch(e){
      if(e instanceof InboxError&&[401,403,404].includes(e.status)&&alive.current&&owner.current===member.id){
        if(e.status===401)cache.current.reset(member.id);else cache.current.delete(id);
        if(owner.current===member.id&&selected.current===id&&version===loadVersion.current){messagesRef.current=[];setMessages([]);setDraft("");setLoading(false);}
      }
      throw e;
    }
    if (!alive.current || owner.current!==member.id || selected.current !== id || version !== loadVersion.current) return;
    // Refresh previously paged messages too; edits/deletes must not leave old text on screen.
    const newestIds = new Set((result.messages ?? []).map(message => message.id));
    const olderIds = id === "room-summaries" ? [] : messagesRef.current.filter(message => !newestIds.has(message.id)).map(message => message.id);
    const pages: Promise<InboxResult>[] = [];
    for (let i = 0; i < olderIds.length; i += 100) pages.push(inbox(undefined, `?conversation=${id}&ids=${olderIds.slice(i, i + 100).join(",")}`));
    let olderPages:InboxResult[];
    try{olderPages=await Promise.all(pages);}catch(e){
      if(e instanceof InboxError&&[401,403,404].includes(e.status)&&owner.current===member.id){cache.current.delete(id);if(selected.current===id&&version===loadVersion.current){messagesRef.current=[];setMessages([]);setDraft("");setLoading(false);}}
      throw e;
    }
    if (!alive.current || owner.current!==member.id || selected.current !== id || version !== loadVersion.current) return;
    const confirmed=[...(result.messages??[]),...olderPages.flatMap(page=>page.messages??[])];
    setMessages(current=>{
      if(owner.current!==member.id||selected.current!==id)return current;
      const merged=mergeConfirmedMessages(current,confirmed).sort((a,b)=>a.seq-b.seq);messagesRef.current=merged;return merged;
    });
    updateOutbox(rows=>reconcilePendingMessages(rows,member.id,`conversation:${id}`,confirmed));
    if (!historyLoaded.current) { setHasMore(Boolean(result.hasMore)); historyLoaded.current = true; }
    setLoading(false);
  }, [inbox,member.id,updateOutbox,setDraft]);

  useEffect(() => {
    let cancelled=false;
    const refresh=async()=>{try{await refreshList();}catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Inbox unavailable.');}};
    const stop=updates?.watch(refresh,['inbox']);if(!updates)void refresh();
    return()=>{cancelled=true;stop?.();};
  },[updates,refreshList]);
  useEffect(()=>{
    if(!activeId||!open||!conversationVisible)return;
    let cancelled=false;
    const refresh=async()=>{try{await refreshMessages(activeId);}catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Messages unavailable.');}};
    const stop=updates?.watch(refresh,['inbox']);
    return()=>{cancelled=true;stop?.();};
  },[updates,activeId,open,conversationVisible,refreshMessages]);

  const snapshotState=useRef({conversations,loading});snapshotState.current={conversations,loading};
  const saveSnapshot=useCallback(()=>{
    const id=selected.current;
    if(id&&owner.current===member.id&&(!snapshotState.current.loading||messagesRef.current.length>0)){
      const row=snapshotState.current.conversations.find(c=>c.id===id);
      if(row&&!row.unavailable&&!row.blockedByMe&&row.status!=="declined")cache.current.put(member.id,id,{messages:messagesRef.current,hasMore:hasMoreRef.current,draft:draftRef.current,scrollTop:scroll.current?.scrollTop??0});
    }
  },[member.id]);
  useEffect(()=>{saveSnapshot();setOpen(false);},[roomSelection,saveSnapshot]);
  const selectConversation = useCallback((id: string | null) => {
    if(id&&id===selected.current&&openRef.current){void refreshMessages(id).catch(e=>setError(e.message));return;}
    saveSnapshot();
    const warm=id?cache.current.get(member.id,id):undefined;
    focusedConversation.current = null;
    messagesRef.current = warm?.messages??[];
    restoreScroll.current=warm?.scrollTop??null;nearBottom.current=!warm;
    scopeRef.current=id?`conversation:${id}`:null;draftVersion.current++;
    selected.current = id; loadVersion.current++; readId.current = ""; historyLoaded.current = Boolean(warm);
    setActiveId(id); setMessages(warm?.messages??[]); setHasMore(warm?.hasMore??false); setRecipient(null); setDraft(warm?.draft??""); setReport(null); setError(""); setNotice("");
    setLoading(Boolean(id&&!warm));
    if (id) void refreshMessages(id).catch((e) => { if (selected.current === id) { setError(e.message); setLoading(false); } });
  }, [refreshMessages,saveSnapshot,member.id,setDraft]);
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setOpen(true);
    selectConversation(null);
    // Refresh before composing, so an existing request cannot become a second one.
    void refreshList().then((rows) => {
      if (!alive.current || cancelled) return;
      const existing = rows.find((c) => c.otherId === target.id);
      if (existing) selectConversation(existing.id);
      else setRecipient(target);
    }).catch((e) => { if (alive.current && !cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [target, refreshList, selectConversation]);
  useEffect(()=>{
    let cancelled=false;
    const openFromNotification=(event:Event)=>{
      const id=(event as CustomEvent<string>).detail;
      const known=snapshotState.current.conversations.find(c=>c.id===id&&!c.unavailable&&!c.blockedByMe&&c.status!=="declined");
      if(known){setOpen(true);selectConversation(id);void refreshList().catch(e=>setError(e.message));}
      else void refreshList().then(rows=>{if(!cancelled&&rows.some(c=>c.id===id)){setOpen(true);selectConversation(id);}}).catch(e=>setError(e.message));
    };
    window.addEventListener('chat-open-dm',openFromNotification);
    return()=>{cancelled=true;window.removeEventListener('chat-open-dm',openFromNotification);};
  },[refreshList,selectConversation]);
  useEffect(()=>{
    const show=()=>{setOpen(true);void refreshList().then(()=>selectConversation('room-summaries')).catch(e=>setError(e.message));};
    window.addEventListener('chat-summary-delivered',show);
    return()=>window.removeEventListener('chat-summary-delivered',show);
  },[refreshList,selectConversation]);
  const linkedDm=useRef(false);
  useEffect(()=>{
    if(linkedDm.current||!listReady)return;
    linkedDm.current=true;const id=new URL(window.location.href).searchParams.get('dm');
    if(id&&snapshotState.current.conversations.some(row=>row.id===id&&!row.unavailable&&!row.blockedByMe&&row.status!=="declined")){setOpen(true);selectConversation(id);}
  },[listReady,selectConversation]);
  const composerKey = recipient ? `request:${recipient.id}` : active && canReply(active) ? `conversation:${active.id}` : null;
  useEffect(() => {
    if (!open) { focusedConversation.current = null; return; }
    if (!conversationVisible || !composerKey || report !== null || busy || focusedConversation.current === composerKey || document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]')) return;
    const frame = requestAnimationFrame(() => {
      if (composer.current && !composer.current.disabled) {
        composer.current.focus({ preventScroll: true });
        focusedConversation.current = composerKey;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, composerKey, busy, report, conversationVisible]);
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!open || !conversationVisible || !activeId || !lastMessage || document.hidden || readId.current === lastMessage.id) return;
    readId.current = lastMessage.id;
    void inbox({ action: "read", target: activeId, clientId: lastMessage.id }).then(()=>{window.dispatchEvent(new Event("chat-activity-refresh"));return refreshList();}).catch(() => { readId.current = ""; });
  }, [open, conversationVisible, activeId, lastMessage, refreshList,inbox]);
  useLayoutEffect(()=>{
    const pane=scroll.current;if(!pane)return;
    if(restoreScroll.current!==null){pane.scrollTop=restoreScroll.current;restoreScroll.current=null;nearBottom.current=pane.scrollHeight-pane.scrollTop-pane.clientHeight<64;}
    else if(nearBottom.current)pane.scrollTop=pane.scrollHeight;
  },[activeId,lastMessage?.id,localRows.length,open,loading]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (busy || !activeId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await inbox({ action, target: activeId, ...extra });
      await refreshList();
      if (action === "report") { setReport(null); setNotice("Report saved for Longboard review. You can also block this member."); }
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function deliver(row:PendingChatMessage) {
    if(inFlight.current.has(row.clientId)||row.ownerId!==member.id)return;
    if(row.action==='send'&&!conversations.some(c=>c.id===row.targetId&&canReply(c)))return;
    inFlight.current.add(row.clientId);
    updateOutbox(rows=>rows.map(item=>item.clientId===row.clientId?{...item,status:'sending',error:undefined}:item));
    try {
      const result=await inbox({action:row.action,target:row.targetId,body:row.body,attachmentIds:row.attachmentIds,clientId:row.clientId});
      if(!alive.current||owner.current!==row.ownerId)return;
      const id=result.conversationId??(row.action==='send'?row.targetId:null);
      updateOutbox(rows=>rows.map(item=>item.clientId===row.clientId?{...item,status:'sent',serverId:result.message?.id,...(id?{scope:`conversation:${id}`}:{})}:item));
      if(row.action==='request'&&id&&scopeRef.current===row.scope&&openRef.current){
        setConversations(rows=>rows.some(c=>c.id===id)?rows:[...rows,{id,status:'pending',incoming:false,otherId:row.targetId,otherName:recipient?.name??'Direct message',blockedByMe:false,unavailable:false,lastBody:row.body,updatedAt:row.createdAt,unread:0}]);
        selectConversation(id);
      }
      if(row.action==='request'&&!result.message)updateOutbox(rows=>rows.filter(item=>item.clientId!==row.clientId));
      if(id&&selected.current===id&&result.message){
        loadVersion.current++;
        setMessages(current=>{
          if(selected.current!==id||owner.current!==row.ownerId)return current;
          const merged=mergeConfirmedMessages(current,[result.message!]).sort((a,b)=>a.seq-b.seq);messagesRef.current=merged;return merged;
        });
        updateOutbox(rows=>reconcilePendingMessages(rows,row.ownerId,`conversation:${id}`,[{...result.message!,client_id:row.clientId}]));
      }
      void refreshList().catch(()=>{});
      if(id&&selected.current===id)void refreshMessages(id).catch(()=>{});
      window.dispatchEvent(new Event('chat-activity-refresh'));
    } catch(e) {
      if(alive.current&&owner.current===row.ownerId)updateOutbox(rows=>rows.map(item=>item.clientId===row.clientId?{...item,status:'failed',error:e instanceof Error?e.message:'Your message could not be sent.'}:item));
    } finally {inFlight.current.delete(row.clientId);}
  }
  function send(event: FormEvent) {
    event.preventDefault();
    if(busy||uploads.blocked||(!draft.trim()&&!uploads.ids.length)||(!recipient&&(!active||!canReply(active)))||!scope||requestQueued||consumedDraft.current===`${scope}:${draftVersion.current}:${uploads.ids.join(',')}`)return;
    consumedDraft.current=`${scope}:${draftVersion.current}:${uploads.ids.join(',')}`;
    const row:PendingChatMessage={ownerId:member.id,scope,clientId:crypto.randomUUID(),action:recipient?'request':'send',targetId:recipient?.id??active!.id,body:draft.trim(),attachmentIds:[...uploads.ids],createdAt:new Date().toISOString(),status:'sending'};
    updateOutbox(rows=>[...rows,row]);setDraft('');uploads.clear();setError('');
    // Focus belongs to this submit event, never a delayed network response.
    composer.current?.focus({preventScroll:true});
    void deliver(row);
  }
  async function older() {
    if (!activeId || !messages[0] || busy) return;
    const id = activeId;
    setBusy(true);
    try {
      const result = await inbox(undefined, `?conversation=${id}&before=${messages[0].seq}`);
      if (!alive.current||owner.current!==member.id||selected.current !== id) return;
      setMessages(current=>mergeConfirmedMessages(current,result.messages??[]).sort((a,b)=>a.seq-b.seq));
      updateOutbox(rows=>reconcilePendingMessages(rows,member.id,`conversation:${id}`,result.messages??[]));
      setHasMore(Boolean(result.hasMore));
    } catch (e) {
      if(e instanceof InboxError&&[401,403,404].includes(e.status)&&owner.current===member.id){cache.current.delete(id);if(selected.current===id){messagesRef.current=[];setMessages([]);setDraft("");}}
      setError(e instanceof Error ? e.message : "Earlier messages could not load.");
    }
    finally { setBusy(false); }
  }
  function close() {
    const conversationButton = sidebarHost?.querySelector<HTMLButtonElement>('button[aria-current="page"]');
    saveSnapshot();openRef.current=false;setOpen(false); onTargetClosed();
    (conversationButton?.getClientRects().length ? conversationButton : fallbackFocus?.current)?.focus({ preventScroll: true });
  }

  const conversationList = (<aside className={styles.sidebar} aria-label="Private conversations"><h2 className={styles.sectionTitle}>DMs {badge > 0 && <span className={styles.badge} aria-label={`${badge} unread messages or requests`}>{badge}</span>}</h2>
          <label className={styles.setting}><input type="checkbox" checked={acceptsRequests} disabled={busy} onChange={async (event) => {
            const value = event.target.checked; setBusy(true); setError("");
            try { await inbox({ action: "settings", value }); setAcceptsRequests(value); }
            catch (e) { setError(e instanceof Error ? e.message : "Settings could not save."); }
            finally { setBusy(false); }
          }} /> Allow new message requests</label>
          <details className={styles.soundSettings}><summary>DM sounds</summary>
            <label className={styles.setting}><input type="checkbox" checked={sounds.preferences.enabled} onChange={event=>sounds.save({...sounds.preferences,enabled:event.target.checked})}/> Enable DM sounds</label>
            <label>Default sound<select aria-label="Default DM sound" value={sounds.preferences.defaultTone} onChange={event=>sounds.save({...sounds.preferences,defaultTone:event.target.value==='pulse'?'pulse':'chime'})}><option value="chime">Chime</option><option value="pulse">Pulse</option></select></label>
            <button type="button" disabled={!sounds.preferences.enabled} onClick={()=>void sounds.test()}>Test DM sound</button>
            <p>Saved for your account in this browser. Enable sounds and test once to allow audio. Alerts work while chat is active, or when you return—not when the browser is closed.</p>
            {sounds.message&&<p role="status">{sounds.message}</p>}
          </details>
          {open&&active&&!active.system&&<details className={styles.soundSettings} data-dm-settings><summary>{active.otherName} · conversation settings</summary>
            {active&&!active.system&&!active.unavailable&&active.status!=='declined'&&<div className={styles.conversationSound}>
              <label>Conversation sound<select aria-label="Conversation DM sound" value={sounds.preferences.conversations[active.id]??'default'} onChange={event=>{const choice=event.target.value;if(isDmChoice(choice))sounds.save({...sounds.preferences,conversations:{...sounds.preferences.conversations,[active.id]:choice}});}}><option value="default">Use default</option><option value="chime">Chime</option><option value="pulse">Pulse</option><option value="mute">Mute this conversation</option></select></label>
              <button type="button" disabled={!sounds.preferences.enabled||sounds.preferences.conversations[active.id]==='mute'} onClick={()=>void sounds.test(active.id)}>Test conversation sound</button>
            </div>}
            {active.status==='accepted'&&!active.unavailable&&!active.blockedByMe&&<ChatFavorite key={`${member.id}:${active.id}`} memberId={member.id} target={{kind:"dm",conversationId:active.id}} label={active.otherName}/>}
            <div className={styles.tools}><button type="button" disabled={busy} onClick={()=>void act(active.blockedByMe?'unblock':'block')}>{active.blockedByMe?'Unblock':'Block'}</button><button type="button" disabled={busy} onClick={()=>{setReport('');onViewChange?.(active.otherName);}}>Report</button></div>
          </details>}
          {!listReady ? <p className={styles.hint}>Loading your conversations…</p> : conversations.length === 0 ? <p className={styles.hint}>Your conversations will appear here. Tap a member’s name in the room to send a request.</p> : null}
          {(["Requests", "Conversations"] as const).map((group) => {
            const rows = conversations.filter((c) => (c.status === "pending" && c.incoming && !c.unavailable) === (group === "Requests"));
            return rows.length ? <section key={group}><h3 className={styles.group}>{group}</h3>{rows.map((c) => <button type="button" key={c.id} className={styles.item} data-active={open && activeId === c.id} aria-current={open && activeId === c.id ? "page" : undefined} disabled={busy} onClick={() => { setOpen(true); selectConversation(c.id); onViewChange?.(c.otherName); }}>
              <span className={styles.itemName}>{c.otherName}{c.unread > 0 && !c.unavailable ? <span className={styles.badge} aria-label={`${c.unread} unread messages or requests`}>{c.unread}</span> : null}</span>
              <span className={styles.preview}>{c.unavailable ? "Messaging unavailable" : c.status === "pending" ? c.incoming ? "Wants to message you" : "Request sent · awaiting acceptance" : c.status === "declined" ? "Request closed" : c.lastBody}</span>
            </button>)}</section> : null;
          })}
        </aside>);
  const pendingRows = localRows.map(row=><article key={row.clientId} className={styles.message} data-own="true" data-client-id={row.clientId} data-send-state={row.status}>
    <div className={styles.messageHeader}><span>You</span></div><ChatMessageBody body={row.body}/>
    {row.attachmentIds.length>0&&<p className={styles.deliveryFiles}>{row.attachmentIds.length} attached {row.attachmentIds.length===1?'file':'files'} retained for delivery</p>}
    <time dateTime={row.createdAt}>{chatTimestamp(row.createdAt)}</time>
    <div className={styles.deliveryStatus} role="status">{row.status==='sending'?'Sending…':row.status==='sent'?'Sent':'Not sent'}
      {row.status==='failed'&&<><p>{row.error}</p><button type="button" disabled={busy||(!recipient&&(!active||!canReply(active)))} onClick={()=>void deliver(row)}>Retry message</button></>}
    </div>
  </article>);
  const conversationView = (<section className={styles.conversation} aria-label="Selected conversation">
          {active || recipient ? <>
            {recipient ? <><div className={styles.requestIntro}><h3>Start with a request.</h3><p>Send one message to {recipient.name}. You can keep chatting after they accept.</p></div>{localRows.length>0&&<div className={styles.messages} aria-live="polite">{pendingRows}</div>}</> : <>
              <div className={styles.messages} ref={scroll} onScroll={()=>{const pane=scroll.current;if(pane)nearBottom.current=pane.scrollHeight-pane.scrollTop-pane.clientHeight<64;}} aria-live="polite" aria-busy={loading}>
                {hasMore ? <button className={styles.older} disabled={busy} onClick={() => void older()}>Load earlier messages</button> : null}
                {loading ? <div className={styles.loadingSkeleton} role="status" aria-label="Loading messages"><span/><span/><span/><p>Loading messages…</p></div> : null}
                {messages.map((message) => <article key={message.id} className={styles.message} data-message-id={message.id} data-send-state={message.sender_id===member.id?"sent":undefined} data-own={message.sender_id === member.id}>
                  <div className={styles.messageHeader}><span>{message.sender_id === member.id ? "You" : active?.otherName}</span>
                    <div className={styles.headerActions}><span data-dm-reaction-host/>
                    {active && !active.system && message.sender_id === member.id && !message.deleted_at && <DirectMessageActions message={message} conversationId={active.id} canEdit={!active.unavailable && active.status !== "declined"} onChanged={updated=>{
                      if(selected.current!==active.id)return;
                      loadVersion.current++;
                      setMessages(current=>current.map(item=>item.id===updated.id && (item.revision??0)<=(updated.revision??0)?updated:item));
                      void refreshList().catch(e=>setError(e.message));
                      window.dispatchEvent(new Event("chat-activity-refresh"));
                      if(updated.deleted_at) requestAnimationFrame(()=>{
                        if(selected.current===active.id) (composer.current ?? conversationHost?.querySelector<HTMLButtonElement>("button"))?.focus({preventScroll:true});
                      });
                    }}/>}</div></div>
                  {message.deleted_at ? <p className={styles.deleted}>Message deleted</p> : <><ChatMessageBody body={message.body} />{active&&!active.system&&<DirectAttachments ids={message.attachment_ids} conversationId={active.id}/>}</>}
                  <time dateTime={message.created_at} title={chatTimestampTitle(message.created_at)}>{chatTimestamp(message.created_at)}{message.edited_at && !message.deleted_at ? " · edited" : ""}</time>
                  {active&&!active.system&&!message.deleted_at&&<MessageReactions compact active={open&&conversationVisible} target={{kind:"dm",conversationId:active.id,messageId:message.id}} disabled={active.unavailable||active.status!=="accepted"}/>}
                </article>)}
                {pendingRows}
              </div>
              {active?.unavailable ? <p className={styles.banner}>{active.blockedByMe ? "You blocked this member. No new messages can be sent." : "Messaging is unavailable for this conversation."}</p> : active?.status === "pending" ? <div className={styles.banner}>
                {active.incoming ? <><p>Accept this request to reply. You can also decline or block.</p><div className={styles.requestActions}><button disabled={busy} onClick={() => void act("accept")}>Accept request</button><button disabled={busy} onClick={() => void act("decline")}>Decline</button></div></> : "Request sent. You can send more messages after it is accepted."}
              </div> : active?.status === "declined" ? <p className={styles.banner}>This request is closed.</p> : null}
            </>}
            {active?.system&&<p className={styles.banner}>Private summaries for you. Use /summary in a room to request another.</p>}
            {report !== null ? <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void act("report", { body: report }); }}>
              <label htmlFor="dm-report">Why are you reporting this conversation?</label><textarea id="dm-report" maxLength={1000} required value={report} onChange={(e) => setReport(e.target.value)} />
              <p className={styles.hint}>Longboard can review reported messages.</p><div className={styles.requestActions}><button disabled={busy || !report.trim()}>Submit report</button><button type="button" onClick={() => setReport(null)}>Cancel</button></div>
            </form> : (recipient && !requestQueued) || (!recipient && active && canReply(active)) ? <form className={styles.composer} onSubmit={send}>
              <label className={styles.eyebrow} htmlFor="dm-body">{recipient ? "YOUR MESSAGE REQUEST" : "PRIVATE MESSAGE"}</label>
              <textarea ref={composer} onKeyDown={handleChatKeyDown} id="dm-body" maxLength={2000} required={!uploads.ids.length} onPaste={recipient?undefined:uploads.paste} value={draft} disabled={busy} placeholder={recipient ? "Introduce yourself…" : "Write a private message…"} onChange={(e) => {draftVersion.current++;setDraft(e.target.value);}} />
              {!recipient&&<AttachmentPicker uploads={uploads} disabled={busy}/>}
              {recipient&&<p className={styles.hint}>Files can be shared after your request is accepted.</p>}
              <div className={styles.composerFoot}>{!recipient&&<VoiceRecorder key={activeId} uploads={uploads} disabled={busy}/> }<GifComposer maxLength={2000} disabled={busy} onAttach={recipient?undefined:()=>uploads.input.current?.click()} onAdd={url=>{const next=[draft.trim(),url].filter(Boolean).join("\n");if(next.length>2000)return false;draftVersion.current++;setDraft(next);requestAnimationFrame(()=>composer.current?.focus());return true;}}/><span>{draft.length} / 2,000 · Enter to send · Shift+Enter for a new line</span><button disabled={busy || uploads.blocked || (!draft.trim()&&!uploads.ids.length)}>{busy ? "Sending…" : recipient ? "Send request" : "Send message"}</button></div>
            </form> : null}
          </> : <div className={styles.empty}><span aria-hidden="true">✉</span><h3>A conversation of your own.</h3><p>Choose a conversation, or tap a member’s name in the public room to send a private request.</p></div>}
        </section>);
  const feedback = <div className={styles.feedback} role={error ? "alert" : "status"}>{error || notice}</div>;
  return <>
    {sidebarHost && createPortal(<div className={styles.navigationList}>{conversationList}{!open && error && <p role="alert" className={styles.hint}>{error}</p>}</div>, sidebarHost)}
    {conversationHost && open && createPortal(<section className={styles.embedded} aria-label="Private conversation" onKeyDown={event => { if(event.key === "Escape" && !busy && !document.querySelector("dialog[open]")) close(); }}>
      {conversationView}{feedback}
    </section>, conversationHost)}
  </>;
}
