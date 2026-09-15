"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { canReply, type ChatMember, type DirectConversation, type DirectMessage } from "@/lib/chatDirectMessages";
import styles from "./DirectInbox.module.css";

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

export default function DirectInbox({ member, target, onTargetClosed }: { member: ChatMember; target: Target | null; onTargetClosed: () => void }) {
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
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const selected = useRef<string | null>(null);
  const readId = useRef("");
  const loadVersion = useRef(0);
  const historyLoaded = useRef(false);
  const listVersion = useRef(0);
  const retry = useRef<{ key: string; id: string } | null>(null);
  const alive = useRef(true);
  const active = conversations.find((c) => c.id === activeId);
  const badge = conversations.reduce((sum, c) => sum + (c.unavailable ? 0 : c.status === "pending" && c.incoming ? 1 : c.unread), 0);

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
        if (selected.current && dialog.current?.open) await refreshMessages(selected.current);
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
    return () => { clearTimeout(timer); clearInterval(interval); document.removeEventListener("visibilitychange", foreground); void client.removeChannel(channel); };
  }, [member.id, refreshList, refreshMessages]);

  const selectConversation = useCallback((id: string | null) => {
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
    setRecipient(target);
    // Refresh before composing, so an existing request cannot become a second one.
    void refreshList().then((rows) => {
      if (!alive.current || cancelled) return;
      const existing = rows.find((c) => c.otherId === target.id);
      if (existing) selectConversation(existing.id);
    }).catch((e) => { if (alive.current && !cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [target, refreshList, selectConversation]);
  useEffect(() => {
    if (open) dialog.current?.showModal(); else dialog.current?.close();
  }, [open]);
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!open || !activeId || !lastMessage || document.hidden || readId.current === lastMessage.id) return;
    readId.current = lastMessage.id;
    void inbox({ action: "read", target: activeId, clientId: lastMessage.id }).then(refreshList).catch(() => { readId.current = ""; });
  }, [open, activeId, lastMessage, refreshList]);
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
  function close() { setOpen(false); onTargetClosed(); }

  return <>
    <button type="button" className={styles.launch} onClick={() => { setOpen(true); void refreshList().catch((e) => setError(e.message)); }} aria-haspopup="dialog">
      Inbox {badge > 0 ? <span className={styles.badge} aria-label={`${badge} unread messages or requests`}>{badge}</span> : null}
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="dm-title" onCancel={close} onClose={close}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>MEMBERS · PRIVATE MESSAGES</span><h2 id="dm-title">Your inbox</h2></div>
        <button type="button" className={styles.close} onClick={close} aria-label="Close inbox">×</button>
      </header>
      <div className={styles.layout} data-selected={Boolean(activeId || recipient)}>
        <aside className={styles.sidebar} aria-label="Private conversations">
          <label className={styles.setting}><input type="checkbox" checked={acceptsRequests} disabled={busy} onChange={async (event) => {
            const value = event.target.checked; setBusy(true); setError("");
            try { await inbox({ action: "settings", value }); setAcceptsRequests(value); }
            catch (e) { setError(e instanceof Error ? e.message : "Settings could not save."); }
            finally { setBusy(false); }
          }} /> Allow new message requests</label>
          {!listReady ? <p className={styles.hint}>Loading your inbox…</p> : conversations.length === 0 ? <p className={styles.hint}>Your conversations will appear here. Tap a member’s name in the room to send a request.</p> : null}
          {(["Requests", "Conversations"] as const).map((group) => {
            const rows = conversations.filter((c) => (c.status === "pending" && c.incoming && !c.unavailable) === (group === "Requests"));
            return rows.length ? <section key={group}><h3 className={styles.group}>{group}</h3>{rows.map((c) => <button type="button" key={c.id} className={styles.item} data-active={activeId === c.id} disabled={busy} onClick={() => selectConversation(c.id)}>
              <span className={styles.itemName}>{c.otherName}{c.unread > 0 && !c.unavailable ? <span className={styles.badge}>{c.unread}</span> : null}</span>
              <span className={styles.preview}>{c.unavailable ? "Messaging unavailable" : c.status === "pending" ? c.incoming ? "Wants to message you" : "Request sent · awaiting acceptance" : c.status === "declined" ? "Request closed" : c.lastBody}</span>
            </button>)}</section> : null;
          })}
        </aside>
        <section className={styles.conversation} aria-label="Selected conversation">
          {active || recipient ? <>
            <div className={styles.conversationHeader}>
              <button className={styles.back} type="button" disabled={busy} onClick={() => selectConversation(null)}>← Inbox</button>
              <strong>{recipient?.name ?? active?.otherName}</strong>
              {active ? <div className={styles.tools}><button type="button" disabled={busy} onClick={() => void act(active.blockedByMe ? "unblock" : "block")}>{active.blockedByMe ? "Unblock" : "Block"}</button><button type="button" disabled={busy} onClick={() => setReport("")}>Report</button></div> : null}
            </div>
            {recipient ? <div className={styles.requestIntro}><h3>Start with a request.</h3><p>Send one message to {recipient.name}. You can keep chatting after they accept.</p></div> : <>
              <div className={styles.messages} ref={scroll} aria-live="polite" aria-busy={loading}>
                {hasMore ? <button className={styles.older} disabled={busy} onClick={() => void older()}>Load earlier messages</button> : null}
                {loading ? <p className={styles.hint}>Loading messages…</p> : null}
                {messages.map((message) => <article key={message.id} className={styles.message} data-own={message.sender_id === member.id}>
                  <span>{message.sender_id === member.id ? "You" : active?.otherName}</span><p>{message.body}</p><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                </article>)}
              </div>
              {active?.unavailable ? <p className={styles.banner}>{active.blockedByMe ? "You blocked this member. No new messages can be sent." : "Messaging is unavailable for this conversation."}</p> : active?.status === "pending" ? <div className={styles.banner}>
                {active.incoming ? <><p>Accept this request to reply. You can also decline or block.</p><div className={styles.requestActions}><button disabled={busy} onClick={() => void act("accept")}>Accept request</button><button disabled={busy} onClick={() => void act("decline")}>Decline</button></div></> : "Request sent. You can send more messages after it is accepted."}
              </div> : active?.status === "declined" ? <p className={styles.banner}>This request is closed.</p> : null}
            </>}
            {report !== null ? <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void act("report", { body: report }); }}>
              <label htmlFor="dm-report">Why are you reporting this conversation?</label><textarea id="dm-report" maxLength={1000} required value={report} onChange={(e) => setReport(e.target.value)} />
              <p className={styles.hint}>Longboard can review reported messages.</p><div className={styles.requestActions}><button disabled={busy || !report.trim()}>Submit report</button><button type="button" onClick={() => setReport(null)}>Cancel</button></div>
            </form> : recipient || (active && canReply(active)) ? <form className={styles.composer} onSubmit={send}>
              <label className={styles.eyebrow} htmlFor="dm-body">{recipient ? "YOUR MESSAGE REQUEST" : "PRIVATE MESSAGE"}</label>
              <textarea id="dm-body" maxLength={2000} required value={draft} disabled={busy} placeholder={recipient ? "Introduce yourself…" : "Write a private message…"} onChange={(e) => setDraft(e.target.value)} />
              <div className={styles.composerFoot}><span>{draft.length} / 2,000</span><button disabled={busy || !draft.trim()}>{busy ? "Sending…" : recipient ? "Send request" : "Send message"}</button></div>
            </form> : null}
          </> : <div className={styles.empty}><span aria-hidden="true">✉</span><h3>A conversation of your own.</h3><p>Choose a conversation, or tap a member’s name in the public room to send a private request.</p></div>}
        </section>
      </div>
      <div className={styles.feedback} role={error ? "alert" : "status"}>{error || notice}</div>
    </dialog>
  </>;
}
