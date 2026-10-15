import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_UUID, findChatMember } from "./chatMembers";

/** At most this many DMs (most recently active first) carry typing rights in one token. */
const MAX_TYPING_CONVERSATIONS = 50;

/**
 * Who the token is for and which DMs it may signal typing in: accepted conversations the
 * member is part of, minus any with a block either way. Fails closed: any read error
 * returns no member, so the token carries no typing rights at all.
 */
export async function chatTypingGrants(
  admin: SupabaseClient,
  userId: string,
): Promise<{ memberId: string | null; conversations: string[] }> {
  const none = { memberId: null, conversations: [] };
  try {
    const member = await findChatMember(admin, userId);
    if (!member || !CHAT_UUID.test(member.id)) return none;
    const id = member.id;
    const [conversations, blocks] = await Promise.all([
      admin
        .from("longboard_chat_conversations")
        .select("id,requester_id,recipient_id")
        .eq("status", "accepted")
        .or(`requester_id.eq.${id},recipient_id.eq.${id}`)
        .order("updated_at", { ascending: false })
        .limit(MAX_TYPING_CONVERSATIONS),
      admin
        .from("longboard_chat_blocks")
        .select("blocker_id,blocked_id")
        .or(`blocker_id.eq.${id},blocked_id.eq.${id}`)
        .limit(5000),
    ]);
    if (conversations.error || blocks.error) return none;
    const blocked = new Set(
      ((blocks.data ?? []) as Array<{ blocker_id: string; blocked_id: string }>).map((row) =>
        row.blocker_id === id ? row.blocked_id : row.blocker_id,
      ),
    );
    return {
      memberId: id,
      conversations: ((conversations.data ?? []) as Array<{ id: string; requester_id: string; recipient_id: string }>)
        .filter((row) => !blocked.has(row.requester_id === id ? row.recipient_id : row.requester_id))
        .map((row) => row.id),
    };
  } catch {
    return none;
  }
}
