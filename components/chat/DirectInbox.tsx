"use client";

import ChatMessageBody from "./ChatMessageBody";
import { createPortal } from "react-dom";
import { chatTimestamp, chatTimestampTitle } from "@/lib/chatTimestamp";
import { FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { canReply, type ChatMember, type DirectConversation, type DirectMessage } from "@/lib/chatDirectMessages";
import styles from "./DirectInbox.module.css";
import { handleChatKeyDown } from "@/lib/chatKeyboard";

type Target = { id: string; name: string };
type InboxResult = { conversations?: DirectConversation[]; messages?: DirectMessage[]; hasMore?: boolean; conversationId?: string };
async function inbox(body?: Record<string, unknown>, query = ""): Promise<InboxResult> {
  const response = await fetch(`/api/chat/inbox${query}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
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
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<Target | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
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
  const badge = conversations.reduce((sum, c) => sum + (c.unavailable ? 0 : c.unread), 0);

  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { setOpen(false); }, [roomSelection]);
  useEffect(() => { onViewChange?.(open ? recipient?.name ?? active?.otherName ?? "Direct messages" : null); }, [open, recipient?.name, active?.otherName, onViewChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refreshList = useCallback(async () => {
    const version = ++listVersion.current;
    const result = await inbox();
    if (!alive.current || version !== listVersion.current) return [];
    const rows = result.conversations ?? [];
    setConversations(rows); setListReady(true);
    return rows;
  }, []);
  const refreshMessages = useCallback(async (id: string) => {
    const version = ++loadVersion.current;
    const result = await inbox(undefined, `?conversation=${id}`);
    if (!alive.current || selected.current !== id || version !== loadVersion.current) return;
    setMessages((current) => {
      const merged = new Map(current.map((m) => [m.id, m]));
      (result.messages ?? []).forEach((m) => merged.set(m.id, m));
      return [...merged.values()].sort((a, b) => a.seq - b.seq);
    });
    if (!historyLoaded.current) { setHasMore(Boolean(result.hasMore)); historyLoaded.current = true; }
    setLoading(false);
  }, []);

  useEffect(() => {
    const client = createClient();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        await refreshList();
        if (selected.current && openRef.current) await refreshMessages(selected.current);
      } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Inbox unavailable."); }
    }
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 150); };
    const channel = client.channel(`longboard-inbox-${member.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "longboard_chat_conversations" }, changed)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "longboard_chat_direct_messages" }, changed)
      .subscribe((status) => { if (status === "SUBSCRIBED") changed(); });
    void refresh();
    const interval = setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const foreground = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("chat-inbox-refresh", foreground);
    return () => { clearTimeout(timer); clearInterval(interval); document.removeEventListener("visibilitychange", foreground); window.removeEventListener("chat-inbox-refresh", foreground); void client.removeChannel(channel); };
  }, [member.id, refreshList, refreshMessages]);

  const selectConversation = useCallback((id: string | null) => {
    focusedConversation.current = null;
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
    if (!composerKey || report !== null || busy || focusedConversation.current === composerKey) return;
    const frame = requestAnimationFrame(() => {
      if (composer.current && !composer.current.disabled) {
        composer.current.focus({ preventScroll: true });
        focusedConversation.current = composerKey;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, composerKey, busy, report]);
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!open || !conversationVisible || !activeId || !lastMessage || document.hidden || readId.current === lastMessage.id) return;
    readId.current = lastMessage.id;
    void inbox({ action: "read", target: activeId, clientId: lastMessage.id }).then(()=>{window.dispatchEvent(new Event("chat-activity-refresh"));return refreshList();}).catch(() => { readId.current = ""; });
  }, [open, conversationVisible, activeId, lastMessage, refreshList]);
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
    if (busy || !draft.trim() || (!recipient && !active)) return;
    const targetId = recipient?.id ?? active!.id;
    const action = recipient ? "request" : "send";
    const key = `${action}:${targetId}:${draft.trim()}`;
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    setBusy(true); setError("");
    try {
      const result = await inbox({ action, target: targetId, body: draft.trim(), clientId: retry.current.id });
      setDraft("");
      retry.current = null;
      if (recipient && result.conversationId) selectConversation(result.conversationId);
      await refreshList();
      if (result.conversationId) {
        await refreshMessages(result.conversationId);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Your message could not be sent."); }
    finally { setBusy(false); }
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
            <div className={styles.conversationHeader}>
              <strong>{recipient?.name ?? active?.otherName}</strong>
              {active && !active.system ? <div className={styles.tools}><button type="button" disabled={busy} onClick={() => void act(active.blockedByMe ? "unblock" : "block")}>{active.blockedByMe ? "Unblock" : "Block"}</button><button type="button" disabled={busy} onClick={() => setReport("")}>Report</button></div> : null}
            </div>
            {recipient ? <div className={styles.requestIntro}><h3>Start with a request.</h3><p>Send one message to {recipient.name}. You can keep chatting after they accept.</p></div> : <>
              <div className={styles.messages} ref={scroll} aria-live="polite" aria-busy={loading}>
                {hasMore ? <button className={styles.older} disabled={busy} onClick={() => void older()}>Load earlier messages</button> : null}
                {loading ? <p className={styles.hint}>Loading messages…</p> : null}
                {messages.map((message) => <article key={message.id} className={styles.message} data-own={message.sender_id === member.id}>
                  <span>{message.sender_id === member.id ? "You" : active?.otherName}</span><ChatMessageBody body={message.body} /><time dateTime={message.created_at} title={chatTimestampTitle(message.created_at)}>{chatTimestamp(message.created_at)}</time>
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
              <textarea ref={composer} onKeyDown={handleChatKeyDown} id="dm-body" maxLength={2000} required value={draft} disabled={busy} placeholder={recipient ? "Introduce yourself…" : "Write a private message…"} onChange={(e) => setDraft(e.target.value)} />
              <div className={styles.composerFoot}><span>{draft.length} / 2,000 · Enter to send · Shift+Enter for a new line</span><button disabled={busy || !draft.trim()}>{busy ? "Sending…" : recipient ? "Send request" : "Send message"}</button></div>
            </form> : null}
          </> : <div className={styles.empty}><span aria-hidden="true">✉</span><h3>A conversation of your own.</h3><p>Choose a conversation, or tap a member’s name in the public room to send a private request.</p></div>}
        </section>);
  const feedback = <div className={styles.feedback} role={error ? "alert" : "status"}>{error || notice}</div>;
  return <>
    {sidebarHost && createPortal(<div className={styles.navigationList}>{conversationList}{!open && error && <p role="alert" className={styles.hint}>{error}</p>}</div>, sidebarHost)}
    {conversationHost && open && createPortal(<section className={styles.embedded} aria-label="Private conversation" onKeyDown={event => { if(event.key === "Escape" && !busy) close(); }}>
      <header className={styles.embeddedHeader}><span className={styles.eyebrow}>PRIVATE MESSAGES</span><button type="button" disabled={busy} className={styles.launch} onClick={close}>Back to room</button></header>
      {conversationView}{feedback}
    </section>, conversationHost)}
  </>;
}
