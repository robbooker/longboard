import type { SupabaseClient } from '@supabase/supabase-js';
import { membershipLabels, type ChatMembership } from './chatMemberships';
import { CHAT_UUID } from './chatMembers';

/** Call only after authorizing the message result. Never accepts client-selected members. */
export async function withMessageMemberships<T extends { member_id?: string | null; sender_id?: string | null; bot_slug?: string | null }>(db: SupabaseClient, messages: T[]): Promise<Array<T & { memberships: ChatMembership[] }>> {
  const memberId = (message: T) => message.bot_slug ? null : message.member_id ?? message.sender_id;
  const ids = [...new Set(messages.map(memberId).filter((id): id is string => typeof id === 'string' && CHAT_UUID.test(id)))];
  const badges = new Map<string, ChatMembership[]>();
  try {
    // Readers are bounded, but chunk defensively rather than widening the RPC input.
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      const { data, error } = await db.rpc('chat_member_memberships', { p_member_ids: batch });
      if (error || !Array.isArray(data)) continue;
      for (const row of data) if (batch.includes(row.member_id)) badges.set(row.member_id, membershipLabels(row.memberships));
    }
  } catch { /* Badge lookup failures hide badges; they never block authorized messages. */ }
  return messages.map(message => ({ ...message, memberships: badges.get(memberId(message) ?? '') ?? [] }));
}
