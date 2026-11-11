"use client";
// #317: tags of real members (@Jammie) are drawn as links in posted messages and in the message box.
// A tag is checked when it is shown (not when it is sent), so older messages get links too.
// #439: a room message's tags are also stored with the person they point to. Those win over names,
// so a tag typed under someone's earlier name still links to them and shows their current name.
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { mentionCandidates, mentionKey, splitMemberMentions } from "@/lib/publicChatMentions";
import { pictureViewLabel, useMemberPictureView } from "./MemberPictureView";
import styles from "./PublicChat.module.css";

export type MentionMember = { id: string; display_name: string; avatar_path?: string };

// ---- Which names belong to members (shared by every message on the page) ----
const known = new Map<string, MentionMember | null>();
const asked = new Set<string>();
// #439: each shown room message's stored tags (tag text, lower-cased → member). The text is part
// of the key, so an edited message is asked about again.
const messageTags = new Map<string, Map<string, MentionMember>>();
const askedMessages = new Set<string>();
let messageQueue = new Set<string>();
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
const messageKey = (id: string, text: string) => `${id}\u0000${text}`;
async function flush() {
  timer = null;
  const names = [...queue].slice(0, 60);
  queue = new Set([...queue].slice(60));
  const keys = [...messageQueue].slice(0, 60);
  messageQueue = new Set([...messageQueue].slice(60));
  if (queue.size || messageQueue.size) timer = setTimeout(flush, 0);
  if (!names.length && !keys.length) return;
  const ids = [...new Set(keys.map((key) => key.slice(0, key.indexOf("\u0000"))))];
  try {
    const response = await fetch("/api/chat/mentions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids.length ? { names, messages: ids } : { names }),
      cache: "no-store",
    });
    // Signed out or not a member yet: tags stay plain text, and are asked about again later.
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    for (const name of names) known.set(name, null);
    for (const member of (data.members ?? []) as MentionMember[])
      known.set(mentionKey(member.display_name), member);
    const found = new Map<string, Map<string, MentionMember>>();
    for (const tag of (data.tags ?? []) as Array<{
      message_id: string;
      key: string;
      member: MentionMember;
    }>) {
      if (!found.has(tag.message_id)) found.set(tag.message_id, new Map());
      found.get(tag.message_id)!.set(mentionKey(tag.key), tag.member);
    }
    for (const key of keys) messageTags.set(key, found.get(key.slice(0, key.indexOf("\u0000"))) ?? new Map());
    changed();
  } catch {
    // A failed check is retried the next time a message with the tag is shown.
    for (const name of names) asked.delete(name);
    for (const key of keys) askedMessages.delete(key);
  }
}
function ask(names: string[], message?: string) {
  let added = false;
  for (const name of names) {
    if (known.has(name) || asked.has(name)) continue;
    asked.add(name);
    queue.add(name);
    added = true;
  }
  if (message && !messageTags.has(message) && !askedMessages.has(message)) {
    askedMessages.add(message);
    messageQueue.add(message);
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
  messageTags.clear();
  askedMessages.clear();
  messageQueue.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  changed();
}

/** For tests: what the server said a message's stored tags are. */
export function rememberMessageTags(messageId: string, text: string, tags: Map<string, MentionMember>) {
  messageTags.set(messageKey(messageId, text), tags);
  changed();
}

/**
 * The members tagged in this text that are known to be real, by lower-cased tag text. With the
 * room message's id (#439), its stored tags come first: they hold the person, whatever their name is now.
 */
export function useMentionMembers(text: string, messageId?: string) {
  const candidates = useMemo(() => (text.includes("@") ? mentionCandidates(text) : []), [text]);
  const key = messageId && candidates.length ? messageKey(messageId, text) : undefined;
  const current = useSyncExternalStore(subscribe, snapshot, () => 0);
  useEffect(() => {
    if (candidates.length) ask(candidates, key);
  }, [candidates, key]);
  return useMemo(() => {
    void current;
    const found = new Map<string, MentionMember>();
    const stored = key ? messageTags.get(key) : undefined;
    for (const name of candidates) {
      const member = stored?.get(name) ?? known.get(name);
      if (member) found.set(name, member);
    }
    return found;
  }, [candidates, key, current]);
}

// ---- Opening a tagged member ----
type MemberLinkContext = { selfId?: string; open: (member: MentionMember) => void };
const MemberLink = createContext<MemberLinkContext | null>(null);
export const MemberLinkProvider = MemberLink.Provider;

/** #439: a tag typed under an earlier name shows the person's name now; one typed as it is now stays as typed. */
function tagLabel(text: string, member: MentionMember) {
  return mentionKey(text.slice(1)) === mentionKey(member.display_name) ? text : `@${member.display_name}`;
}

function MemberTag({ text, member }: { text: string; member: MentionMember }) {
  const link = useContext(MemberLink);
  const openView = useMemberPictureView();
  const label = tagLabel(text, member);
  const earlier = label === text ? undefined : text;
  if (!link)
    return (
      <span className={styles.memberTag} data-tagged-as={earlier}>
        {label}
      </span>
    );
  const self = member.id === link.selfId;
  return (
    <button
      type="button"
      className={styles.memberTag}
      data-member-tag={member.id}
      data-tagged-as={earlier}
      title={
        self
          ? "Your profile"
          : openView
            ? pictureViewLabel(member.display_name)
            : `Open ${member.display_name}’s profile to message them`
      }
      onClick={(event) => {
        event.stopPropagation();
        if (self) window.dispatchEvent(new Event("chat-open-profile-settings"));
        // #414: like their name on a message, a tag opens the larger view of that member, which
        // offers the private message a tag used to open at once.
        else if (openView)
          openView(
            {
              memberId: member.id,
              path: member.avatar_path,
              name: member.display_name,
              colorKey: member.id,
              onMessage: () => link.open(member),
            },
            event.currentTarget,
          );
        else link.open(member);
      }}
    >
      {label}
    </button>
  );
}

/**
 * Text with member tags drawn as links. `highlight` names (e.g. Buddy) keep the plain highlight;
 * any other "@word" that is not a member stays ordinary text.
 */
export function MentionText({
  text,
  highlight = [],
  messageId,
}: {
  text: string;
  highlight?: string[];
  messageId?: string;
}) {
  const members = useMentionMembers(text, messageId);
  return <>{renderMentions(text, members, highlight)}</>;
}

export function renderMentions(text: string, members: Map<string, MentionMember>, highlight: string[] = []) {
  // #439: matched by the text each tag was found under (an earlier name, for a stored tag).
  const names = [...members.keys()];
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
