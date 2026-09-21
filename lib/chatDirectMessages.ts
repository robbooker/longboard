import type { ChatMembership } from './chatMemberships';
export type ChatMember = { id: string; display_name: string; accepts_requests: boolean };
export type DirectConversation = {
  system?: boolean;
  latestIncomingSeq?: number;
  id: string; status: "pending" | "accepted" | "declined"; incoming: boolean;
  otherId: string; otherName: string; blockedByMe: boolean; unavailable: boolean;
  lastBody: string | null; updatedAt: string; unread: number;
};
export type DirectMessage = { memberships?: ChatMembership[]; client_id?: string; id: string; seq: number; sender_id: string; body: string; created_at: string; edited_at?: string | null; deleted_at?: string | null; attachment_ids?: string[]; revision?: number };
export const DM_ERRORS: Record<string, string> = {
  message_not_found: "This message is not available or is not yours.",
  message_deleted: "This message was already deleted.",
  message_changed: "This message changed in another window. Close this editor and try again.",
  member_required: "Sign in and choose your member chat name first.",
  conversation_not_found: "This conversation is not available.",
  invalid_recipient: "Choose another member to message.",
  conversation_unavailable: "Messaging is unavailable for this conversation.",
  request_not_pending: "This request has already been handled.",
  request_not_accepted: "Wait for the recipient to accept your request before sending more messages.",
  requests_unavailable: "This member is not accepting message requests.",
  rate_limited: "Please pause before sending more messages.",
  request_rate_limited: "You can start up to 10 new requests per day. Please try again tomorrow.",
  invalid_message: "Write a message up to 2,000 characters, or attach a file.",
  attachment_not_ready: "A file is not ready to send. Remove it and upload it again.",
  attachment_wrong_conversation: "This file belongs to another conversation. Upload it here instead.",
  invalid_attachments: "Attach up to three different files.",
  invalid_report: "Add a reason for your report (up to 1,000 characters).",
};
export function canReply(conversation: DirectConversation) {
  return !conversation.system && conversation.status === "accepted" && !conversation.unavailable;
}
