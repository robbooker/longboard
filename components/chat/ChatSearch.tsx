"use client";
import { chatTimestamp, chatTimestampTitle } from "@/lib/chatTimestamp";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CHAT_ROOMS, type ChatRoom } from "@/lib/publicChat";
import {chatSearchScopes} from "@/lib/chatSearchScopes";
import styles from "./ChatSearch.module.css";
import {useChatNameLabel} from './ChatUpdates';
type Message = { id: string; member_id?:string|null; bot_slug?:string|null; room_slug: string; author_label: string; body: string; created_at: string };
export default function ChatSearch({room,allowedRooms}:{room:ChatRoom;allowedRooms:readonly ChatRoom[]}) {
  const queryId=useId();
  const options=chatSearchScopes(allowedRooms);
  const nameLabel=useChatNameLabel();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<string>(options.some(option=>option.value===room)?room:options[0]?.value??"social");
  const [mode, setMode] = useState("meaning");
  const [searched, setSearched] = useState<{q:string;room:string;mode:string} | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [context, setContext] = useState<{id:string; messages:Message[]} | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const contextController = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); contextController.current?.abort(); }, []);
  function changeScope(value:string){controller.current?.abort();contextController.current?.abort();setScope(value);setSearched(null);setMessages([]);setMore(false);setContext(null);setBusy(false);setContextBusy(false);setError("");if(searched)void search(false,{q:searched.q,room:value,mode});}
  async function search(append = false,selected?:{q:string;room:string;mode:string}) {
    const request = selected??(append ? searched : {q:query.trim(),room:scope,mode});
    if (!request || request.q.length < 2 || !options.some(option=>option.value===request.room)) return;
    controller.current?.abort(); contextController.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setContext(null); setContextBusy(false);
    if (!append) { setMessages([]); setMore(false); setSearched(request); }
    const params = new URLSearchParams(request);
    const last = append ? messages.at(-1) : null;
    if (last) { params.set("before",last.created_at); params.set("beforeId",last.id); }
    try {
      const response = await fetch(`/api/chat/search?${params}`,{signal:abort.signal,cache:"no-store"});
      if (!response.ok) throw new Error(response.status === 429 ? "You’ve reached the hourly limit for meaning searches. Try Words & phrases, or come back later." : response.status === 401 ? "Please sign in again to search." : "Search is unavailable. Please try again.");
      const data = await response.json();
      if (abort.signal.aborted) return;
      setMessages((old) => append ? [...old,...data.messages] : data.messages); setMore(data.hasMore);
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Search failed."); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  async function showContext(id: string) {
    contextController.current?.abort();
    const abort = new AbortController(); contextController.current=abort;
    setContext({id,messages:[]}); setContextBusy(true); setError("");
    try {
      const response=await fetch(`/api/chat/search/context?id=${id}`,{signal:abort.signal,cache:"no-store"});
      if (!response.ok) throw new Error("Could not load the conversation. Please try again.");
      const data=await response.json(); if (!abort.signal.aborted) setContext({id,messages:data.messages});
    } catch(e) { if(!abort.signal.aborted) setError(e instanceof Error ? e.message : "Could not load conversation."); }
    finally { if (!abort.signal.aborted) setContextBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void search(); }
  return <section className={styles.search} aria-label="Search chat">
    <form onSubmit={submit} className={styles.form}>
      <label htmlFor={queryId}>Search conversations</label>
      <div className={styles.controls}>
        <input id={queryId} value={query} onChange={(e)=>setQuery(e.target.value)} minLength={2} maxLength={200} required placeholder={mode === "meaning" ? "What were people saying about taking profits?" : "Ticker, member, or phrase…"} />
        <select aria-label="Search method" value={mode} onChange={(e)=>setMode(e.target.value)}><option value="meaning">Meaning + words</option><option value="keywords">Words &amp; phrases</option></select>
        <select aria-label="Search room" value={scope} onChange={(e)=>changeScope(e.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <button disabled={busy || !options.length || query.trim().length<2}>Search</button>
      </div>
      <p>{mode === "meaning" ? "Find up to 20 relevant messages using AI-assisted search. New messages may take a few minutes to appear. Use Words & phrases for exact terms." : "Search saved messages in the selected rooms by words or phrases."} Private messages are excluded.</p>
    </form>
    <div className={styles.results} aria-busy={busy || contextBusy}>
      {error ? <p role="alert">{error}</p> : null}
      {context ? <>
        <button type="button" onClick={()=>{contextController.current?.abort();setContextBusy(false);setContext(null);}}>← Back to results</button>
        <h2>Conversation around this message</h2>
        {contextBusy ? <p role="status">Loading conversation…</p> : !context.messages.length ? <p>This message is no longer available.</p> : context.messages.map(m=><article key={m.id} data-target={m.id===context.id}><small>{nameLabel(m.bot_slug?null:m.member_id,m.author_label)} · {CHAT_ROOMS.find(room => room.slug === m.room_slug)?.label ?? m.room_slug.toUpperCase()} · <time dateTime={m.created_at} title={chatTimestampTitle(m.created_at)}>{chatTimestamp(m.created_at)}</time></small><p>{m.body}</p></article>)}
      </> : <>
        <p role="status">{busy ? "Searching…" : searched ? `${messages.length}${more ? "+" : ""} results for “${searched.q}”` : "Find a conversation from earlier today—or months ago."}</p>
        {messages.map(m=><article key={m.id}><small>{nameLabel(m.bot_slug?null:m.member_id,m.author_label)} · {CHAT_ROOMS.find(room => room.slug === m.room_slug)?.label ?? m.room_slug.toUpperCase()} · <time dateTime={m.created_at} title={chatTimestampTitle(m.created_at)}>{chatTimestamp(m.created_at)}</time></small><p>{m.body}</p><button type="button" onClick={()=>void showContext(m.id)}>View conversation →</button></article>)}
        {more ? <button type="button" disabled={busy} onClick={()=>void search(true)}>Load more</button> : null}
      </>}
    </div>
  </section>;
}
