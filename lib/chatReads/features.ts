import { defaultNotificationPreferences } from '@/lib/chatFeatureNotifications';
import type { featureAccess } from '@/lib/chatFeatures';
import { NextResponse } from 'next/server';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function readFeatures(access: Awaited<ReturnType<typeof featureAccess>>) {
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
