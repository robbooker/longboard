import {NextRequest, NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient, requestOriginAllowed} from '@/lib/chatAdmin';
import {CHAT_UUID} from '@/lib/chatMembers';
import {parseChatRoom} from '@/lib/publicChat';
import {favoriteLabel, type FavoriteTarget, type ChatFavorite} from '@/lib/chatFavorite';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'private, no-store'}});
function parseTarget(value: unknown): FavoriteTarget | null {
 if (!value || typeof value !== 'object') return null;
 const target = value as Record<string, unknown>;
 if (target.kind === 'room' && typeof target.room === 'string') {
  const room = parseChatRoom(target.room);
  return room ? {kind: 'room', room} : null;
 }
 return target.kind === 'dm' && typeof target.conversationId === 'string' && CHAT_UUID.test(target.conversationId)
  ? {kind: 'dm', conversationId: target.conversationId} : null;
}
async function handle(req: NextRequest, write: boolean) {
 if (write && !requestOriginAllowed(req)) return json({error: 'origin_not_allowed'}, 403);
 const auth = await requireChatUser(req);
 if (!auth.ok) return json({error: auth.error}, auth.status);
 let target: FavoriteTarget | null = null, action = 'get';
 if (write) {
  const payload = await req.json().catch(() => null);
  target = parseTarget(payload?.target);
  if (!target || !['pin', 'unpin'].includes(payload?.action)) return json({error: 'invalid_pin'}, 400);
  action = payload.action;
 }
 const admin = createChatAdminClient();
 if (!admin) return json({error: 'Pins are unavailable. Please try again.'}, 503);
 try {
  const {data, error} = await admin.rpc('chat_pins', {
   p_user_id: auth.user.id, p_action: action,
   p_room: target?.kind === 'room' ? target.room : null,
   p_conversation: target?.kind === 'dm' ? target.conversationId : null,
  });
  if (error) {
   const messages: Record<string, string> = {pin_unavailable: 'This conversation is no longer available.', member_required: 'Choose your chat name first.', pin_limit: 'You can pin up to 50 conversations. Unpin one first.'};
   return json({error: messages[error.message] || 'Pins are unavailable. Please try again.'}, messages[error.message] ? 403 : 503);
  }
  const pins = (Array.isArray(data) ? data : []).flatMap<ChatFavorite>(value => {
   const identity = parseTarget(value);
   if (!identity) return [];
   if (identity.kind === 'room') return [{...identity, label: favoriteLabel(identity)}];
   return typeof value.label === 'string' ? [{...identity, label: value.label}] : [];
  });
  return json({pins});
 } catch { return json({error: 'Pins are unavailable. Please try again.'}, 503); }
}
export const GET = (req: NextRequest) => handle(req, false);
export const POST = (req: NextRequest) => handle(req, true);
