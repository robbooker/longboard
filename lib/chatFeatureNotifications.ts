export const notificationCategories = ['requests', 'replies', 'mentions', 'assistant', 'status'] as const;
export type NotificationCategory = typeof notificationCategories[number];
export type NotificationPreferences = Record<NotificationCategory, boolean>;
export const defaultNotificationPreferences: NotificationPreferences = {
  requests: true, replies: true, mentions: true, assistant: true, status: true,
};
export type FeatureNotification = {
  id: string; request_id: string; category: NotificationCategory; label: string; request_title: string;
  important: boolean; created_at: string; read_at: string | null;
};
export function validNotificationPreferences(value: unknown): value is NotificationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === notificationCategories.length && notificationCategories.every(key => typeof v[key] === 'boolean');
}
