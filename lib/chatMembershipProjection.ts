import type { SupabaseClient } from '@supabase/supabase-js';
import { type ChatMembership } from './chatMemberships';
import {currentShortScoutBadgeSubjects} from './chatMembershipExport';
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
      const { data, error } = await db.rpc('chat_member_membership_sources', { p_member_ids: batch });
      if (error || !Array.isArray(data)) continue;
      const sources=data.filter(row=>row&&batch.includes(row.member_id));
      const paid=await currentShortScoutBadgeSubjects(sources.map(row=>row.shortscout_subject).filter((subject):subject is string=>typeof subject==='string'));
      for (const row of sources) badges.set(row.member_id,[...(row.longboard===true?['LB' as const]:[]),...(paid.has(row.shortscout_subject)?['SS' as const]:[])]);
    }
  } catch { /* Badge lookup failures hide badges; they never block authorized messages. */ }
  return messages.map(message => ({ ...message, memberships: badges.get(memberId(message) ?? '') ?? [] }));
}
