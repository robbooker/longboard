/** Device-specific disclosure levels. Unknown/legacy settings always stay private. */
export type ChatPushPreview = 'off' | 'sender' | 'message';
export function isChatPushPreview(value: unknown): value is ChatPushPreview {
  return value === 'off' || value === 'sender' || value === 'message';
}
export function pushPreviewText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  // Notifications are plain text. Strip hidden controls and formatting, never fetch media.
  const text = value.slice(0, 2000).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).replace(/[\ud800-\udbff]$/, '') + '…' : text;
}
export function chatPushBody(input: { preview?: unknown; sender?: unknown; body?: unknown; kind?: unknown; hasAttachments?: unknown }): string {
  if (input.preview !== 'sender' && input.preview !== 'message') return 'You have a new chat notification.';
  const sender = pushPreviewText(input.sender, 40) || 'Someone';
  if (input.preview === 'sender') return input.kind === 'room' ? `${sender} mentioned or replied to you.` : `${sender} sent you a message.`;
  const body = pushPreviewText(input.body, 110) || (input.hasAttachments === true ? 'Sent an attachment.' : 'Sent a message.');
  return `${sender}: ${body}`;
}
