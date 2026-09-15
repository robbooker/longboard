export function memberMentionQuery(value: string, cursor: number) {
  const end = Math.max(0, Math.min(cursor, value.length));
  if (!end) return null;
  const start = value.lastIndexOf("@", end - 1);
  if (start < 0 || (start > 0 && !/\s/.test(value[start - 1]))) return null;
  const query = value.slice(start + 1, end);
  if (query.length > 28 || !/^[\p{L}\p{N} _.'-]*$/u.test(query)) return null;
  return { start, end, query };
}
export function insertMemberMention(value: string, range: { start: number; end: number }, name: string) {
  const text = `@${name} `;
  return { value: value.slice(0, range.start) + text + value.slice(range.end), cursor: range.start + text.length };
}
export function splitMemberMentions(text: string, names: string[]) {
  const escaped = [...new Set(names)].filter(Boolean).sort((a,b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return [{ text, mention: false }];
  const pattern = new RegExp(`(^|\\s)(@(?:${escaped.join("|")}))(?=$|[\\s,!?;:.)])`, "giu");
  const parts: { text: string; mention: boolean }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index! + match[1].length;
    parts.push({ text: text.slice(cursor, start), mention: false }, { text: match[2], mention: true });
    cursor = start + match[2].length;
  }
  parts.push({ text: text.slice(cursor), mention: false });
  return parts;
}
