"use client";
// #317: tags of real members (@Jammie) are drawn as links in posted messages and in the message box.
// A tag is checked when it is shown (not when it is sent), so older messages get links too.
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { mentionCandidates, mentionKey, splitMemberMentions } from "@/lib/publicChatMentions";
import styles from "./PublicChat.module.css";

export type MentionMember = { id: string; display_name: string };

// ---- Which names belong to members (shared by every message on the page) ----
const known = new Map<string, MentionMember | null>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
function changed() {
  version++;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
const snapshot = () => version;
async function flush() {
  timer = null;
  const names = [...queue].slice(0, 60);
  queue = new Set([...queue].slice(60));
  if (queue.size) timer = setTimeout(flush, 0);
  if (!names.length) return;
  try {
    const response = await fetch("/api/chat/mentions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
      cache: "no-store",
    });
    // Signed out or not a member yet: tags stay plain text, and are asked about again later.
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    for (const name of names) known.set(name, null);
    for (const member of (data.members ?? []) as MentionMember[])
      known.set(mentionKey(member.display_name), member);
    changed();
  } catch {
    // A failed check is retried the next time a message with the tag is shown.
    for (const name of names) asked.delete(name);
  }
}
function ask(names: string[]) {
  let added = false;
  for (const name of names) {
    if (known.has(name) || asked.has(name)) continue;
    asked.add(name);
    queue.add(name);
    added = true;
  }
  if (added && !timer && typeof window !== "undefined") timer = setTimeout(flush, 150);
}
/** A member picked from the suggestions is known at once, without asking the server. */
export function rememberMentionMember(member: MentionMember) {
  const key = mentionKey(member.display_name);
  if (known.get(key)?.id === member.id) return;
  known.set(key, member);
  changed();
}
/** For tests: forget every answer. */
export function resetMentionMembers() {
  known.clear();
  asked.clear();
  queue.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  changed();
}

/** The members tagged in this text that are known to be real, by lower-cased name. */
export function useMentionMembers(text: string) {
  const candidates = useMemo(() => (text.includes("@") ? mentionCandidates(text) : []), [text]);
  const current = useSyncExternalStore(subscribe, snapshot, () => 0);
  useEffect(() => {
    if (candidates.length) ask(candidates);
  }, [candidates]);
  return useMemo(() => {
    void current;
    const found = new Map<string, MentionMember>();
    for (const name of candidates) {
      const member = known.get(name);
      if (member) found.set(name, member);
    }
    return found;
  }, [candidates, current]);
}

// ---- Opening a tagged member ----
type MemberLinkContext = { selfId?: string; open: (member: MentionMember) => void };
const MemberLink = createContext<MemberLinkContext | null>(null);
export const MemberLinkProvider = MemberLink.Provider;

function MemberTag({ text, member }: { text: string; member: MentionMember }) {
  const link = useContext(MemberLink);
  if (!link) return <span className={styles.memberTag}>{text}</span>;
  const self = member.id === link.selfId;
  return (
    <button
      type="button"
      className={styles.memberTag}
      data-member-tag={member.id}
      title={self ? "Your profile" : `Open ${member.display_name}’s profile to message them`}
      onClick={(event) => {
        event.stopPropagation();
        if (self) window.dispatchEvent(new Event("chat-open-profile-settings"));
        else link.open(member);
      }}
    >
      {text}
    </button>
  );
}

/**
 * Text with member tags drawn as links. `highlight` names (e.g. Buddy) keep the plain highlight;
 * any other "@word" that is not a member stays ordinary text.
 */
export function MentionText({ text, highlight = [] }: { text: string; highlight?: string[] }) {
  const members = useMentionMembers(text);
  return <>{renderMentions(text, members, highlight)}</>;
}

export function renderMentions(text: string, members: Map<string, MentionMember>, highlight: string[] = []) {
  const names = [...members.values()].map((member) => member.display_name);
  const extra = highlight.filter((name) => !members.has(mentionKey(name)));
  if (!names.length && !extra.length) return [text] as ReactNode[];
  return splitMemberMentions(text, [...names, ...extra]).map((part, index) => {
    if (!part.mention) return part.text;
    const member = part.key ? members.get(part.key) : undefined;
    return member ? (
      <MemberTag key={index} text={part.text} member={member} />
    ) : (
      <mark className={styles.mention} key={index}>
        {part.text}
      </mark>
    );
  });
}

/** The message box's copy: tags are plain marks (the layer cannot be clicked). */
export function renderComposerTags(text: string, members: Map<string, MentionMember>) {
  const names = [...members.values()].map((member) => member.display_name);
  return splitMemberMentions(text, names).map((part, index) =>
    part.mention ? <mark key={index}>{part.text}</mark> : part.text,
  );
}
