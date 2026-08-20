export type BoardroomChatReaction = {
  message_id: string;
  user_id: string;
  cohort: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function sameReaction(left: BoardroomChatReaction, right: BoardroomChatReaction): boolean {
  return left.message_id === right.message_id && left.user_id === right.user_id;
}

export function mergeReaction(
  reactions: BoardroomChatReaction[],
  incoming: BoardroomChatReaction,
): BoardroomChatReaction[] {
  return [
    ...reactions.filter((reaction) => !sameReaction(reaction, incoming)),
    incoming,
  ].slice(-500);
}

export function restoreReaction(
  reactions: BoardroomChatReaction[],
  messageId: string,
  userId: string,
  previous: BoardroomChatReaction | undefined,
): BoardroomChatReaction[] {
  const withoutCurrent = reactions.filter((reaction) =>
    reaction.message_id !== messageId || reaction.user_id !== userId
  );
  return previous ? [...withoutCurrent, previous] : withoutCurrent;
}

export function reactionSummary(
  reactions: BoardroomChatReaction[],
  messageId: string,
  currentUserId: string,
): { count: number; reacted: boolean } {
  const active = reactions.filter((reaction) =>
    reaction.message_id === messageId && reaction.active
  );
  return {
    count: active.length,
    reacted: active.some((reaction) => reaction.user_id === currentUserId),
  };
}
