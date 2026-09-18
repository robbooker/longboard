import { requestOriginAllowed } from '@/lib/chatAdmin';
import { requireChatUser } from '@/lib/chatAuth';
import { featureAccess } from '@/lib/chatFeatures';
import { readActivity } from '@/lib/chatReads/activity';
import { readCounts } from '@/lib/chatReads/counts';
import { readFeatures } from '@/lib/chatReads/features';
import { readHistory } from '@/lib/chatReads/history';
import { readInbox } from '@/lib/chatReads/inbox';
import { readRoom } from '@/lib/chatReads/room';
import { readThread } from '@/lib/chatReads/thread';
import { NextRequest,NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers:{'Cache-Control':'private, no-store'}});
const readers = {'/api/chat':readRoom, '/api/chat/activity':readActivity, '/api/chat/inbox':readInbox, '/api/chat/thread-counts':readCounts, '/api/chat/history':readHistory, '/api/chat/thread':readThread};

// A bounded read-only batch. Identity is resolved once; every reader retains its
// room/participant checks. Never dispatch arbitrary URLs or accept an actor ID.
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({error:'origin_not_allowed'},403);
  const raw = await req.text();
  if (raw.length > 32768) return json({error:'batch_too_large'},413);
  let paths: unknown;
  try { paths = JSON.parse(raw).paths; } catch { return json({error:'invalid_batch'},400); }
  if (!Array.isArray(paths) || !paths.length || paths.length > 8 || new Set(paths).size !== paths.length) return json({error:'invalid_batch'},400);
  const urls: URL[] = [];
  for (const path of paths) {
    if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/api/chat') || path.startsWith('//')) return json({error:'invalid_resource'},400);
    const url = new URL(path,req.url);
    if (url.origin !== req.nextUrl.origin || url.hash || !(Object.hasOwn(readers,url.pathname) || url.pathname === '/api/chat/features/notifications')) return json({error:'invalid_resource'},400);
    urls.push(url);
  }
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({error:auth.error},auth.status);
  const results = await Promise.all(urls.map(async (url,index) => {
    try {
      const response = url.pathname === '/api/chat/features/notifications'
        ? await readFeatures(await featureAccess(auth))
        : await readers[url.pathname as keyof typeof readers](new NextRequest(url),auth);
      return {path:paths[index],status:response.status,data:await response.json()};
    } catch { return {path:paths[index],status:503,data:{error:'Updates temporarily unavailable.'}}; }
  }));
  return json({results});
}
