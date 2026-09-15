import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReservedChatName } from "@/lib/publicChat";

export const CHAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function chatName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return name.length >= 2 && name.length <= 28 && /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u.test(name) && !isReservedChatName(name) ? name : null;
}
export async function findChatMember(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("longboard_chat_members")
    .select("id, display_name, accepts_requests").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("member_lookup_failed");
  return data as { id: string; display_name: string; accepts_requests: boolean } | null;
}
export function guestTokenHash(token: unknown) {
  return typeof token === "string" && CHAT_UUID.test(token) ? createHash("sha256").update(token).digest("hex") : null;
}
