import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
export {chatName} from './chatDisplayName';

export const CHAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function findChatMember(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("longboard_chat_members")
    .select("id, display_name, accepts_requests, name_revision").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("member_lookup_failed");
  return data as { id: string; display_name: string; accepts_requests: boolean; name_revision?: number } | null;
}
export function guestTokenHash(token: unknown) {
  return typeof token === "string" && CHAT_UUID.test(token) ? createHash("sha256").update(token).digest("hex") : null;
}
