export type ChatMember = { id: string; display_name: string; accepts_requests: boolean };
export type DirectConversation = {
  id: string; status: "pending" | "accepted" | "declined"; incoming: boolean;
  otherId: string; otherName: string; blockedByMe: boolean; unavailable: boolean;
  lastBody: string | null; updatedAt: string; unread: number;
};
export type DirectMessage = { id: string; seq: number; sender_id: string; body: string; created_at: string };
export const DM_ERRORS: Record<string, string> = {
  member_required: "Sign in and choose your member chat name first.",
  conversation_not_found: "This conversation is not available.",
  invalid_recipient: "Choose another member to message.",
  conversation_unavailable: "Messaging is unavailable for this conversation.",
  request_not_pending: "This request has already been handled.",
  request_not_accepted: "Wait for the recipient to accept your request before sending more messages.",
  requests_unavailable: "This member is not accepting message requests.",
  rate_limited: "Please pause before sending more messages.",
  request_rate_limited: "You can start up to 10 new requests per day. Please try again tomorrow.",
  invalid_message: "Write a message between 1 and 2,000 characters.",
  invalid_report: "Add a reason for your report (up to 1,000 characters).",
};
export function canReply(conversation: DirectConversation) {
  return conversation.status === "accepted" && !conversation.unavailable;
}
