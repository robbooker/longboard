import 'server-only';
import { NextRequest } from 'next/server';
import { canAccessChatRoom } from '@/lib/chatAccess';
import { createChatAdminClient, readPublicRoomState } from '@/lib/chatAdmin';
import type { ChatAuthResult } from '@/lib/chatAuth';
import { featureAccess } from '@/lib/chatFeatures';
import { findChatMember } from '@/lib/chatMembers';
import { readHistory } from '@/lib/chatReads/history';
import { readCounts } from '@/lib/chatReads/counts';
import type { ChatBootstrap } from '@/lib/chatBootstrapTypes';
import type { ChatRoom } from '@/lib/publicChat';

/** Request-local only. Never cache this result across identities or requests. */
export async function loadChatBootstrap(auth: ChatAuthResult, room: ChatRoom): Promise<ChatBootstrap> {
  if (!auth.ok || !canAccessChatRoom(auth.access, room)) throw new Error('room_forbidden');
  const db = createChatAdminClient();
  if (!db) throw new Error('chat_unavailable');
  const history = async () => {
    // Shared readers preserve the same room authorization as later reconciliations.
    const response = await readHistory(new NextRequest(`https://chat.internal/api/chat/history?room=${room}`), auth);
    if (!response.ok) throw new Error('history_unavailable');
    const data = await response.json();
    const ids = data.messages.map((m: {id:string}) => m.id).join(',');
    const counts = await readCounts(new NextRequest(`https://chat.internal/api/chat/thread-counts?room=${room}&ids=${ids}`), auth);
    return {...data, counts: counts.ok ? (await counts.json()).counts : {}};
  };
  const [member, roomState, initial, features] = await Promise.all([
    findChatMember(db, auth.user.id),
    readPublicRoomState(db, room),
    history(),
    featureAccess(auth),
  ]);
  return {accountId:auth.user.id, room, member, roomState, messages:initial.messages,
    reactions:initial.reactions, counts:initial.counts, featureChannel:!!features};
}
