import type { ChatMember } from "./chatDirectMessages";
export type ChatMemberNameUpdate = { accountId: string; member: ChatMember };
export function validChatMember(value: unknown): value is ChatMember {
  if (!value || typeof value !== "object") return false;
  const m = value as ChatMember;
  return (
    typeof m.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.id) &&
    typeof m.display_name === "string" &&
    m.display_name.length >= 2 &&
    m.display_name.length <= 28 &&
    typeof m.accepts_requests === "boolean" &&
    (m.name_revision === undefined || (Number.isSafeInteger(m.name_revision) && m.name_revision >= 0))
  );
}
/** Revision omission from an older server cannot undo an acknowledged rename. */
export function newerChatMember(current: ChatMember | null, incoming: ChatMember): ChatMember {
  if (!current) return incoming;
  if (current.id !== incoming.id || (current.name_revision ?? 0) > (incoming.name_revision ?? 0))
    return current;
  return incoming;
}
/** Display-only identity selection; a different member can never supply a self label. */
export function chatSelfName(
  memberId: string | null | undefined,
  member: ChatMember | null | undefined,
  current: ChatMember | null | undefined,
): string | undefined {
  const supplied = memberId && member?.id === memberId ? member : null;
  const shared = memberId && current?.id === memberId ? current : null;
  return (supplied && shared ? newerChatMember(supplied, shared) : (supplied ?? shared))?.display_name;
}
