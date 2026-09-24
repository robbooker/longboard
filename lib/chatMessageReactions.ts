/** Fixed reaction keys shared by the picker and API. No user-supplied image URLs. */
export const CHAT_REACTIONS = ['like', 'heart', 'laugh', 'rob'] as const;
export type ChatReaction = typeof CHAT_REACTIONS[number];
export function isChatReaction(value: unknown): value is ChatReaction {
  return typeof value === 'string' && CHAT_REACTIONS.some(reaction => reaction === value);
}
export const CHAT_REACTION_LABELS: Record<ChatReaction, string> = {
  like: 'Like', heart: 'Heart', laugh: 'Laughing', rob: 'Rob',
};
