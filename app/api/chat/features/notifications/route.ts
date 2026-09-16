import { NextRequest, NextResponse } from 'next/server';
import { featureAccess } from '@/lib/chatFeatures';
import { requestOriginAllowed } from '@/lib/chatAdmin';
import { defaultNotificationPreferences, validNotificationPreferences } from '@/lib/chatFeatureNotifications';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function GET() {
  const access = await featureAccess();
  if (!access) return json({ error: 'not_found' }, 404);
  const { db, user } = access;
  const [inbox, unread, preferences, muted] = await Promise.all([
    db.from('chat_feature_notifications').select('id,request_id,category,label,request_title,important,created_at,read_at').eq('account_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100),
    db.from('chat_feature_notifications').select('id', { count: 'exact', head: true }).eq('account_id', user.id).is('read_at', null),
    db.from('chat_feature_notification_preferences').select('requests,replies,mentions,assistant,status').eq('account_id', user.id).maybeSingle(),
    db.from('chat_feature_notification_mutes').select('request_id').eq('account_id', user.id),
  ]);
  if ([inbox, unread, preferences, muted].some(result => result.error)) return json({ error: 'Notifications are unavailable. Please retry.' }, 503);
  return json({ notifications: inbox.data, unread: unread.count ?? 0, preferences: preferences.data ?? defaultNotificationPreferences, muted: muted.data?.map(row => row.request_id) ?? [] });
}

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: 'invalid_origin' }, 403);
  const access = await featureAccess();
  if (!access) return json({ error: 'not_found' }, 404);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_request' }, 400);
  const { db, user } = access;
  let result;
  if (body.action === 'read' && uuid(body.id)) {
    result = await db.from('chat_feature_notifications').update({ read_at: new Date().toISOString() }).eq('account_id', user.id).eq('id', body.id).is('read_at', null);
  } else if (body.action === 'read_all' && typeof body.before === 'string' && Number.isFinite(Date.parse(body.before))) {
    // Only mark alerts present when the inbox was loaded; concurrent arrivals stay unread.
    result = await db.from('chat_feature_notifications').update({ read_at: new Date().toISOString() }).eq('account_id', user.id).is('read_at', null).lte('created_at', body.before);
  } else if (body.action === 'preferences' && validNotificationPreferences(body.preferences)) {
    result = await db.from('chat_feature_notification_preferences').upsert({ account_id: user.id, ...body.preferences });
  } else if (body.action === 'mute' && uuid(body.requestId) && typeof body.muted === 'boolean') {
    result = body.muted
      ? await db.from('chat_feature_notification_mutes').upsert({ account_id: user.id, request_id: body.requestId }, { onConflict: 'account_id,request_id' })
      : await db.from('chat_feature_notification_mutes').delete().eq('account_id', user.id).eq('request_id', body.requestId);
  } else return json({ error: 'invalid_request' }, 400);
  if (result.error) return json({ error: 'Could not save notification settings. Please retry.' }, 503);
  return json({ ok: true });
}
