export function memberMentionQuery(value: string, cursor: number) {
  const end = Math.max(0, Math.min(cursor, value.length));
  if (!end) return null;
  const start = value.lastIndexOf("@", end - 1);
  if (start < 0 || (start > 0 && !/\s/.test(value[start - 1]))) return null;
  const query = value.slice(start + 1, end);
  if (query.length > 28 || !/^[\p{L}\p{N} _.'‘’-]*$/u.test(query)) return null;
  return { start, end, query };
}
export function insertMemberMention(value: string, range: { start: number; end: number }, name: string) {
  const text = `@${name} `;
  return { value: value.slice(0, range.start) + text + value.slice(range.end), cursor: range.start + text.length };
}
// #317: the same edges the database uses when it records a mention (record_chat_room_mentions):
// the "@" may not follow a letter, digit, "_" or "@", and the name may not run on into one.
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const NAME_CHAR = /[\p{L}\p{N} _.'‘’-]/u;
/** Longest member display name (database check: 2–28 characters). */
export const MENTION_NAME_MAX = 28;
export function mentionKey(name: string) {
  return name.normalize("NFKC").toLowerCase();
}
/**
 * #317: every name a tag in this text could be — each run after an "@" that ends on a word edge.
 * "@Jammie Smith, hi" gives "Jammie" and "Jammie Smith". Lower-cased keys, no duplicates.
 */
export function mentionCandidates(text: string, limit = 60) {
  const found = new Set<string>();
  for (let at = text.indexOf("@"); at >= 0 && found.size < limit; at = text.indexOf("@", at + 1)) {
    if (at > 0 && (WORD_CHAR.test(text[at - 1]) || text[at - 1] === "@")) continue;
    let end = at + 1;
    while (end < text.length && end - at - 1 < MENTION_NAME_MAX && NAME_CHAR.test(text[end])) {
      end++;
      const name = text.slice(at + 1, end);
      if (name.length < 2 || /\s$/.test(name) || (end < text.length && WORD_CHAR.test(text[end]))) continue;
      found.add(mentionKey(name));
      if (found.size >= limit) break;
    }
  }
  return [...found];
}
export type MentionPart = { text: string; mention: boolean; key?: string };
export function splitMemberMentions(text: string, names: string[]): MentionPart[] {
  const escaped = [...new Set(names)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return [{ text, mention: false }];
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_@])(@(?:${escaped.join("|")}))(?![\\p{L}\\p{N}_])`, "giu");
  const parts: MentionPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index! + match[1].length;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), mention: false });
    parts.push({ text: match[2], mention: true, key: mentionKey(match[2].slice(1)) });
    cursor = start + match[2].length;
  }
  if (cursor < text.length || !parts.length) parts.push({ text: text.slice(cursor), mention: false });
  return parts;
}
