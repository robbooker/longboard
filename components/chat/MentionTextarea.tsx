"use client";
import { useEffect, useId, useRef, useState, type RefObject, type TextareaHTMLAttributes } from "react";
import { memberMentionQuery, insertMemberMention } from "@/lib/publicChatMentions";
import { handleChatKeyDown } from "@/lib/chatKeyboard";
import styles from "./PublicChat.module.css";
type Member = { id: string; display_name: string };
type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; inputRef?: RefObject<HTMLTextAreaElement | null>; listClassName?: string; enabled: boolean; buddyEnabled?: boolean; onValue: (value: string) => void };
export default function MentionTextarea({ value, enabled, buddyEnabled = true, inputRef, listClassName, onValue, ...props }: Props) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;
  const listId = useId();
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [results, setResults] = useState<{ query: string; members: Member[] } | null>(null);
  const [active, setActive] = useState(0);
  const range = enabled && !dismissed ? memberMentionQuery(value, cursor) : null;
  const query = range?.query;
  const members = results && results.query === query ? results.members : [];
  useEffect(() => {
    if (query === undefined) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/chat/mentions?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json();
        if (controller.signal.aborted) return;
        const list: Member[] = data.members || [];
        if (buddyEnabled && "buddy".startsWith(query.toLowerCase())) list.unshift({ id: "buddy", display_name: "Buddy" });
        setResults({ query, members: list }); setActive(0);
      } catch { if (!controller.signal.aborted) setResults({ query, members: [] }); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, buddyEnabled]);
  function choose(person: Member) {
    if (!range) return;
    const next = insertMemberMention(value, range, person.display_name);
    if (props.maxLength && next.value.length > props.maxLength) return;
    onValue(next.value); setDismissed(true);
    requestAnimationFrame(() => {
      // A fast subsequent keystroke must not have its caret moved backwards.
      if (!ref.current || ref.current.value !== next.value) return;
      ref.current.focus(); ref.current.setSelectionRange(next.cursor, next.cursor); setCursor(next.cursor);
    });
  }
  return <>
    <textarea {...props} ref={ref} value={value} aria-autocomplete={enabled ? "list" : undefined}
      aria-controls={members.length && range ? listId : undefined}
      aria-activedescendant={members.length && range ? `${listId}-${active}` : undefined}
      onChange={(event) => { onValue(event.target.value); setCursor(event.target.selectionStart); setDismissed(false); setActive(0); }}
      onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
      onBlur={() => setDismissed(true)}
      onKeyDown={(event) => {
        if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && range && members.length) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + members.length) % members.length); return; }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!event.repeat) choose(members[active] || members[0]); return; }
        }
        if (props.onKeyDown) props.onKeyDown(event); else handleChatKeyDown(event);
      }} />
    {range && members.length ? <div id={listId} role="listbox" aria-label="Mention a member" className={`${styles.mentionList} ${listClassName ?? ""}`}>
      {members.map((person, index) => <button key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} type="button" tabIndex={-1}
        onPointerDown={(event) => event.preventDefault()} onClick={() => choose(person)}>
        @{person.display_name}<span>{person.id === "buddy" ? "Chat assistant" : "Member"}</span>
      </button>)}
    </div> : null}
  </>;
}
