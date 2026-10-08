import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_UUID, findChatMember } from "@/lib/chatMembers";

export type ClarityPerson = "Liz" | "Rob";
export type ClarityConversation = {
  conversationId: string;
  senderMemberId: string;
  sender: ClarityPerson;
  recipient: ClarityPerson;
};

/**
 * The two chat members this feature exists for, from CHAT_CLARITY_PAIR
 * ("Rob:<member uuid>,Liz:<member uuid>"). Anything malformed disables the feature.
 */
export function clarityPair(value = process.env.CHAT_CLARITY_PAIR): Map<string, ClarityPerson> | null {
  if (!value) return null;
  const pair = new Map<string, ClarityPerson>();
  for (const entry of value.split(",")) {
    const [name, id] = entry.split(":").map((part) => part.trim());
    if ((name !== "Rob" && name !== "Liz") || !id || !CHAT_UUID.test(id)) return null;
    pair.set(id.toLowerCase(), name);
  }
  const names = [...pair.values()];
  return pair.size === 2 && names.includes("Rob") && names.includes("Liz") ? pair : null;
}

/**
 * Resolves the sender from the authenticated account and the recipient from verified
 * membership of an accepted two-person DM between exactly the configured pair.
 * Returns null for every other account or conversation, so callers answer 404.
 */
export async function resolveClarityConversation(
  db: SupabaseClient,
  accountUserId: string,
  conversationId: unknown,
  pair = clarityPair(),
): Promise<ClarityConversation | null> {
  if (!pair || typeof conversationId !== "string" || !CHAT_UUID.test(conversationId)) return null;
  const member = await findChatMember(db, accountUserId);
  const sender = member ? pair.get(member.id.toLowerCase()) : undefined;
  if (!member || !sender) return null;
  const conversation = await db
    .from("longboard_chat_conversations")
    .select("id,requester_id,recipient_id,status")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversation.error) throw new Error("clarity_unavailable");
  const row = conversation.data as { requester_id: string; recipient_id: string; status: string } | null;
  if (!row || row.status !== "accepted") return null;
  const ids = [row.requester_id, row.recipient_id].map((id) => id.toLowerCase());
  if (!ids.includes(member.id.toLowerCase()) || !ids.every((id) => pair.has(id))) return null;
  return { conversationId, senderMemberId: member.id, sender, recipient: sender === "Rob" ? "Liz" : "Rob" };
}
