export type MentionQuery = {
  start: number;
  end: number;
  query: string;
};

export type MentionTextPart =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; handle: string };

const HANDLE_PATTERN = /^[a-z0-9_]{0,32}$/i;
const MENTION_PATTERN = /(^|\s)(@[a-z0-9_]{2,32})/gi;

export function findMentionQuery(value: string, cursor: number): MentionQuery | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const beforeCursor = value.slice(0, safeCursor);
  const at = beforeCursor.lastIndexOf("@");

  if (at < 0) return null;
  if (at > 0 && !/\s/.test(value[at - 1])) return null;

  const query = value.slice(at + 1, safeCursor);
  if (!HANDLE_PATTERN.test(query)) return null;

  return { start: at, end: safeCursor, query: query.toLowerCase() };
}

export function applyMention(
  value: string,
  mention: MentionQuery,
  handle: string,
): { value: string; cursor: number } {
  const inserted = `@${handle} `;
  const replaceEnd = value[mention.end] === " " ? mention.end + 1 : mention.end;
  const nextValue = value.slice(0, mention.start) + inserted + value.slice(replaceEnd);
  return {
    value: nextValue,
    cursor: mention.start + inserted.length,
  };
}

export function tokenizeMentionText(value: string): MentionTextPart[] {
  const parts: MentionTextPart[] = [];
  let cursor = 0;

  for (const match of value.matchAll(MENTION_PATTERN)) {
    const matchStart = match.index ?? 0;
    const prefix = match[1] ?? "";
    const mention = match[2];
    const mentionStart = matchStart + prefix.length;

    if (mentionStart > cursor) {
      parts.push({ kind: "text", value: value.slice(cursor, mentionStart) });
    }
    parts.push({ kind: "mention", value: mention, handle: mention.slice(1).toLowerCase() });
    cursor = mentionStart + mention.length;
  }

  if (cursor < value.length) parts.push({ kind: "text", value: value.slice(cursor) });
  return parts.length > 0 ? parts : [{ kind: "text", value }];
}
