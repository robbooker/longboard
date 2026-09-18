"use client";

import VoiceRecorder from './VoiceRecorder';
import { canReply,type ChatMember,type DirectConversation,type DirectMessage } from "@/lib/chatDirectMessages";
import { handleChatKeyDown } from "@/lib/chatKeyboard";
import { chatTimestamp,chatTimestampTitle } from "@/lib/chatTimestamp";
import type { ChatUpdateCoordinator } from "@/lib/chatUpdateCoordinator";
import { FormEvent,type RefObject,useCallback,useEffect,useRef,useState } from "react";
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

type Target = { id: string; name: string };
type InboxResult = { conversations?: DirectConversation[]; messages?: DirectMessage[]; hasMore?: boolean; conversationId?: string };
async function requestInbox(body?: Record<string, unknown>, query = "", updates?:ChatUpdateCoordinator|null): Promise<InboxResult> {
  const response = await (!body&&updates ? updates.read(`/api/chat/inbox${query}`) : fetch(`/api/chat/inbox${query}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" }));
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Your inbox could not load. Please try again.");
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
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<Target | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const messagesRef = useRef<DirectMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [acceptsRequests, setAcceptsRequests] = useState(member.accepts_requests);
  const [listReady, setListReady] = useState(false);
  const openRef = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sendFocusCleanup = useRef<(() => void) | null>(null);
  const sendFocus = useRef<{input: HTMLTextAreaElement; cancelled: boolean} | null>(null);
  const focusedConversation = useRef<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const selected = useRef<string | null>(null);
  const readId = useRef("");
  const loadVersion = useRef(0);
  const historyLoaded = useRef(false);
  const listVersion = useRef(0);
  const retry = useRef<{ key: string; id: string } | null>(null);
  const alive = useRef(true);
  const active = conversations.find((c) => c.id === activeId);
  const uploads=useAttachments({conversationId:activeId});
  const badge = conversations.reduce((sum, c) => sum + (c.unavailable ? 0 : c.unread), 0);

  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { setOpen(false); if(sendFocus.current)sendFocus.current.cancelled=true; }, [roomSelection]);
  useEffect(() => { if((!open||!conversationVisible)&&sendFocus.current)sendFocus.current.cancelled=true; }, [open,conversationVisible]);
  useEffect(() => { onViewChange?.(open ? recipient?.name ?? active?.otherName ?? "Direct messages" : null); }, [open, recipient?.name, active?.otherName, onViewChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sendFocusCleanup.current?.(); if(sendFocus.current)sendFocus.current.cancelled=true; }; }, []);
  const refreshList = useCallback(async () => {
    const version = ++listVersion.current;
    const result = await inbox();
    if (!alive.current || version !== listVersion.current) return [];
    const rows = result.conversations ?? [];
    observeSounds(rows);
    setConversations(rows); setListReady(true);
    return rows;
  }, [inbox,observeSounds]);
  const refreshMessages = useCallback(async (id: string) => {
    const version = ++loadVersion.current;
    const result = await inbox(undefined, `?conversation=${id}`);
    if (!alive.current || selected.current !== id || version !== loadVersion.current) return;
    // Refresh previously paged messages too; edits/deletes must not leave old text on screen.
    const newestIds = new Set((result.messages ?? []).map(message => message.id));
    const olderIds = id === "room-summaries" ? [] : messagesRef.current.filter(message => !newestIds.has(message.id)).map(message => message.id);
    const pages: Promise<InboxResult>[] = [];
    for (let i = 0; i < olderIds.length; i += 100) pages.push(inbox(undefined, `?conversation=${id}&ids=${olderIds.slice(i, i + 100).join(",")}`));
    const olderPages = await Promise.all(pages);
    if (!alive.current || selected.current !== id || version !== loadVersion.current) return;
    setMessages((current) => {
      const merged = new Map(current.map((m) => [m.id, m]));
      [...(result.messages ?? []), ...olderPages.flatMap(page => page.messages ?? [])].forEach((m) => {
        if ((merged.get(m.id)?.revision ?? 0) <= (m.revision ?? 0)) merged.set(m.id, m);
      });
      return [...merged.values()].sort((a, b) => a.seq - b.seq);
    });
    if (!historyLoaded.current) { setHasMore(Boolean(result.hasMore)); historyLoaded.current = true; }
    setLoading(false);
  }, [inbox]);

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

  const selectConversation = useCallback((id: string | null) => {
    if(sendFocus.current)sendFocus.current.cancelled=true;
    focusedConversation.current = null;
    messagesRef.current = [];
    selected.current = id; loadVersion.current++; readId.current = ""; historyLoaded.current = false;
    setActiveId(id); setMessages([]); setHasMore(false); setRecipient(null); setDraft(""); setReport(null); setError(""); setNotice("");
    setLoading(Boolean(id));
    if (id) void refreshMessages(id).catch((e) => { if (selected.current === id) { setError(e.message); setLoading(false); } });
  }, [refreshMessages]);
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
      void refreshList().then(rows=>{if(!cancelled&&rows.some(c=>c.id===id)){setOpen(true);selectConversation(id);}}).catch(e=>setError(e.message));
    };
    window.addEventListener('chat-open-dm',openFromNotification);
    return()=>{cancelled=true;window.removeEventListener('chat-open-dm',openFromNotification);};
  },[refreshList,selectConversation]);
  useEffect(()=>{
    const show=()=>{setOpen(true);void refreshList().then(()=>selectConversation('room-summaries')).catch(e=>setError(e.message));};
    window.addEventListener('chat-summary-delivered',show);
    return()=>window.removeEventListener('chat-summary-delivered',show);
  },[refreshList,selectConversation]);
  const composerKey = recipient ? `request:${recipient.id}` : active && canReply(active) ? `conversation:${active.id}` : null;
  useEffect(() => {
    if (!open) { focusedConversation.current = null; return; }
    if (!conversationVisible || !composerKey || report !== null || busy || focusedConversation.current === composerKey || sendFocus.current?.cancelled || document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]')) return;
    const frame = requestAnimationFrame(() => {
      if (composer.current && !composer.current.disabled) {
        composer.current.focus({ preventScroll: true });
        focusedConversation.current = composerKey;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, composerKey, busy, report, conversationVisible]);
  // Consume a send-specific intent only after React enables the textarea again.
  // Polling, settings changes, and other busy operations never create this intent.
  useEffect(() => {
    if(busy||!sendFocus.current)return;
    const intent=sendFocus.current;sendFocus.current=null;
    if(!intent.cancelled&&open&&conversationVisible&&composer.current===intent.input&&
      !intent.input.disabled&&intent.input.getClientRects().length&&!document.hidden&&
      !document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]'))intent.input.focus({preventScroll:true});
  },[busy,open,conversationVisible]);
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!open || !conversationVisible || !activeId || !lastMessage || document.hidden || readId.current === lastMessage.id) return;
    readId.current = lastMessage.id;
    void inbox({ action: "read", target: activeId, clientId: lastMessage.id }).then(()=>{window.dispatchEvent(new Event("chat-activity-refresh"));return refreshList();}).catch(() => { readId.current = ""; });
  }, [open, conversationVisible, activeId, lastMessage, refreshList,inbox]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [lastMessage?.id, open]);

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
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || uploads.blocked || (!draft.trim()&&!uploads.ids.length) || (!recipient && !active)) return;
    const targetId = recipient?.id ?? active!.id;
    const action = recipient ? "request" : "send";
    const key = `${action}:${targetId}:${draft.trim()}:${uploads.ids.join(",")}`;
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    const input=composer.current;
    const intent=input?{input,cancelled:false}:null;sendFocus.current=intent;
    const form=input?.form;
    const relinquish=(event:Event)=>{
      if(intent&&event.target instanceof Node&&event.target!==document.body&&!form?.contains(event.target))intent.cancelled=true;
    };
    document.addEventListener('pointerdown',relinquish,true);
    document.addEventListener('focusin',relinquish,true);
    const cleanup=()=>{document.removeEventListener('pointerdown',relinquish,true);document.removeEventListener('focusin',relinquish,true);};
    sendFocusCleanup.current=cleanup;
    setBusy(true); setError("");
    try {
      const result = await inbox({ action, target: targetId, body: draft.trim(), attachmentIds:uploads.ids, clientId: retry.current.id });
      setDraft("");uploads.clear();
      retry.current = null;
      if (recipient && result.conversationId) selectConversation(result.conversationId);
      await refreshList();
      if (result.conversationId) {
        await refreshMessages(result.conversationId);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Your message could not be sent."); }
    finally {
      cleanup();sendFocusCleanup.current=null;
      setBusy(false);
    }
  }
  async function older() {
    if (!activeId || !messages[0] || busy) return;
    const id = activeId;
    setBusy(true);
    try {
      const result = await inbox(undefined, `?conversation=${id}&before=${messages[0].seq}`);
      if (selected.current !== id) return;
      setMessages((current) => [...(result.messages ?? []), ...current.filter((m) => !result.messages?.some((old) => old.id === m.id))]);
      setHasMore(Boolean(result.hasMore));
    } catch (e) { setError(e instanceof Error ? e.message : "Earlier messages could not load."); }
    finally { setBusy(false); }
  }
  function close() {
    if(sendFocus.current)sendFocus.current.cancelled=true;
    const conversationButton = sidebarHost?.querySelector<HTMLButtonElement>('button[aria-current="page"]');
    setOpen(false); onTargetClosed();
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
  const conversationView = (<section className={styles.conversation} aria-label="Selected conversation">
          {active || recipient ? <>
            {recipient ? <div className={styles.requestIntro}><h3>Start with a request.</h3><p>Send one message to {recipient.name}. You can keep chatting after they accept.</p></div> : <>
              <div className={styles.messages} ref={scroll} aria-live="polite" aria-busy={loading}>
                {hasMore ? <button className={styles.older} disabled={busy} onClick={() => void older()}>Load earlier messages</button> : null}
                {loading ? <p className={styles.hint}>Loading messages…</p> : null}
                {messages.map((message) => <article key={message.id} className={styles.message} data-message-id={message.id} data-own={message.sender_id === member.id}>
                  <div className={styles.messageHeader}><span>{message.sender_id === member.id ? "You" : active?.otherName}</span>
                    {active && !active.system && message.sender_id === member.id && !message.deleted_at && <DirectMessageActions message={message} conversationId={active.id} canEdit={!active.unavailable && active.status !== "declined"} onChanged={updated=>{
                      if(selected.current!==active.id)return;
                      loadVersion.current++;
                      setMessages(current=>current.map(item=>item.id===updated.id && (item.revision??0)<=(updated.revision??0)?updated:item));
                      void refreshList().catch(e=>setError(e.message));
                      window.dispatchEvent(new Event("chat-activity-refresh"));
                      if(updated.deleted_at) requestAnimationFrame(()=>{
                        if(selected.current===active.id) (composer.current ?? conversationHost?.querySelector<HTMLButtonElement>("button"))?.focus({preventScroll:true});
                      });
                    }}/>}</div>
                  {message.deleted_at ? <p className={styles.deleted}>Message deleted</p> : <><ChatMessageBody body={message.body} />{active&&!active.system&&<DirectAttachments ids={message.attachment_ids} conversationId={active.id}/>}</>}
                  <time dateTime={message.created_at} title={chatTimestampTitle(message.created_at)}>{chatTimestamp(message.created_at)}{message.edited_at && !message.deleted_at ? " · edited" : ""}</time>
                </article>)}
              </div>
              {active?.unavailable ? <p className={styles.banner}>{active.blockedByMe ? "You blocked this member. No new messages can be sent." : "Messaging is unavailable for this conversation."}</p> : active?.status === "pending" ? <div className={styles.banner}>
                {active.incoming ? <><p>Accept this request to reply. You can also decline or block.</p><div className={styles.requestActions}><button disabled={busy} onClick={() => void act("accept")}>Accept request</button><button disabled={busy} onClick={() => void act("decline")}>Decline</button></div></> : "Request sent. You can send more messages after it is accepted."}
              </div> : active?.status === "declined" ? <p className={styles.banner}>This request is closed.</p> : null}
            </>}
            {active?.system&&<p className={styles.banner}>Private summaries for you. Use /summary in a room to request another.</p>}
            {report !== null ? <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void act("report", { body: report }); }}>
              <label htmlFor="dm-report">Why are you reporting this conversation?</label><textarea id="dm-report" maxLength={1000} required value={report} onChange={(e) => setReport(e.target.value)} />
              <p className={styles.hint}>Longboard can review reported messages.</p><div className={styles.requestActions}><button disabled={busy || !report.trim()}>Submit report</button><button type="button" onClick={() => setReport(null)}>Cancel</button></div>
            </form> : recipient || (active && canReply(active)) ? <form className={styles.composer} onSubmit={send}>
              <label className={styles.eyebrow} htmlFor="dm-body">{recipient ? "YOUR MESSAGE REQUEST" : "PRIVATE MESSAGE"}</label>
              <textarea ref={composer} onKeyDown={handleChatKeyDown} id="dm-body" maxLength={2000} required={!uploads.ids.length} onPaste={recipient?undefined:uploads.paste} value={draft} disabled={busy} placeholder={recipient ? "Introduce yourself…" : "Write a private message…"} onChange={(e) => setDraft(e.target.value)} />
              {!recipient&&<AttachmentPicker uploads={uploads} disabled={busy}/>}
              {recipient&&<p className={styles.hint}>Files can be shared after your request is accepted.</p>}
              <div className={styles.composerFoot}>{!recipient&&<VoiceRecorder key={activeId} uploads={uploads} disabled={busy}/> }<GifComposer maxLength={2000} disabled={busy} onAttach={recipient?undefined:()=>uploads.input.current?.click()} onAdd={url=>{const next=[draft.trim(),url].filter(Boolean).join("\n");if(next.length>2000)return false;setDraft(next);requestAnimationFrame(()=>composer.current?.focus());return true;}}/><span>{draft.length} / 2,000 · Enter to send · Shift+Enter for a new line</span><button disabled={busy || uploads.blocked || (!draft.trim()&&!uploads.ids.length)}>{busy ? "Sending…" : recipient ? "Send request" : "Send message"}</button></div>
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
