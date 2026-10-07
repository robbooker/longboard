import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveClarityConversation } from "./pair";
import { CLARITY_MODEL, clarityStandards } from "./transform";

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max ? value : value == null ? null : undefined;

/** Parses the client's review metadata. Anything unexpected is rejected, never coerced. */
export function parseClarityPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const original = text(v.original, 2000);
  const suggested = text(v.suggested, 4000);
  const intent = text(v.intent, 2000);
  const whyChanged = text(v.whyChanged, 2000);
  const ambiguityNote = text(v.ambiguityNote, 2000);
  if (!original?.trim() || [suggested, intent, whyChanged, ambiguityNote].includes(undefined)) return null;
  if (typeof v.usedSuggestion !== "boolean") return null;
  return { original, suggested, intent, whyChanged, ambiguityNote, usedSuggestion: v.usedSuggestion };
}

/**
 * Stores the sender's private original and review notes for a DM they just sent, only for the
 * configured pair's conversation and only when the server-confirmed message belongs to them.
 * The final text comes from the saved message, never from the client.
 */
export async function saveClarityDraft(
  db: SupabaseClient,
  accountUserId: string,
  conversationId: unknown,
  message: { id: string; sender_id: string; body: string },
  rawClarity: unknown,
) {
  const clarity = parseClarityPayload(rawClarity);
  if (!clarity) return false;
  const target = await resolveClarityConversation(db, accountUserId, conversationId);
  if (!target || message.sender_id !== target.senderMemberId) return false;
  const saved = await db.from("chat_clarity_drafts").upsert(
    {
      message_id: message.id,
      conversation_id: target.conversationId,
      sender_member_id: target.senderMemberId,
      original_body: clarity.original,
      suggested_body: clarity.suggested,
      final_body: message.body,
      intent: clarity.intent,
      why_changed: clarity.whyChanged,
      ambiguity_note: clarity.ambiguityNote,
      used_suggestion: clarity.usedSuggestion,
      standards_sha256: clarityStandards().sha256,
      model: CLARITY_MODEL,
    },
    { onConflict: "message_id", ignoreDuplicates: true },
  );
  if (saved.error) throw new Error("clarity_draft_unavailable");
  return true;
}
