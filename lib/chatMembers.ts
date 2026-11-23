import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chatSignInSessionKey,
  chatSessionCacheKey,
  createSessionCache,
  memberTag,
  onChatSessionForget,
  sessionTag,
  userTag,
} from "./chatSessionCache";
export { chatName } from "./chatDisplayName";

export const CHAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * #410: true when a read failed only because the picture column isn't there yet (the code went
 * live before its migration). Such reads are retried without it for five minutes.
 */
export function avatarColumnMissing(error: { code?: string; message?: string } | null | undefined) {
  return !!error && (error.code === "42703" || /avatar_path/.test(error.message ?? ""));
}
let avatarColumnMissingAt = -Infinity;
/** Reads with the picture column, or without it while it's missing (see avatarColumnMissing). */
export async function withAvatarColumn<R extends { error: { code?: string; message?: string } | null }>(
  read: (avatar: boolean) => PromiseLike<R>,
): Promise<R> {
  if (Date.now() - avatarColumnMissingAt < 300_000) return read(false);
  const result = await read(true);
  if (!avatarColumnMissing(result.error)) return result;
  avatarColumnMissingAt = Date.now();
  return read(false);
}
export async function findChatMember(admin: SupabaseClient, userId: string) {
  const { data, error } = await withAvatarColumn((avatar) =>
    admin
      .from("longboard_chat_members")
      .select(`id, display_name, accepts_requests, name_revision${avatar ? ", avatar_path" : ""}`)
      .eq("user_id", userId)
      .maybeSingle(),
  );
  if (error) throw new Error("member_lookup_failed");
  if (!data) return null;
  // #410: no picture means no field, so members without one look exactly as before.
  const { avatar_path, ...member } = data as unknown as {
    id: string;
    display_name: string;
    accepts_requests: boolean;
    name_revision?: number;
    avatar_path?: string | null;
  };
  return (typeof avatar_path === "string" ? { ...member, avatar_path } : member) as {
    id: string;
    display_name: string;
    accepts_requests: boolean;
    name_revision?: number;
    avatar_path?: string;
  };
}
type ChatMemberRow = NonNullable<Awaited<ReturnType<typeof findChatMember>>>;
/**
 * #489: the member row behind one sign-in, kept for 30 seconds per function instance (see
 * lib/chatSessionCache.ts), for the batch of reads in POST /api/chat/updates. Keyed by the
 * sign-in's hashed sessionKey and the account, so it never crosses between sessions. Only a found
 * row is kept: "no member yet" and failed reads are asked again, so a name picked a moment ago
 * shows at once. cached tells the window the row may be up to 30 seconds old.
 */
export function createMemberCache(cache = createSessionCache<ChatMemberRow>()) {
  onChatSessionForget({
    session: (tokenHash) => cache.invalidateTag(sessionTag(chatSignInSessionKey(tokenHash))),
    tag: (tag) => cache.invalidateTag(tag),
    all: () => cache.clear(),
  });
  return async function findChatMemberForSession(
    admin: SupabaseClient,
    userId: string,
    sessionKey: string | undefined,
  ): Promise<{ member: ChatMemberRow | null; cached: boolean }> {
    if (!sessionKey) return { member: await findChatMember(admin, userId), cached: false };
    const key = chatSessionCacheKey("member", sessionKey, userId);
    const hit = cache.get(key);
    if (hit) return { member: hit, cached: true };
    const epoch = cache.epoch();
    const member = await findChatMember(admin, userId);
    if (member) cache.set(key, member, [userTag(userId), memberTag(member.id), sessionTag(sessionKey)], epoch);
    return { member, cached: false };
  };
}
export const findChatMemberForSession = createMemberCache();
export function guestTokenHash(token: unknown) {
  return typeof token === "string" && CHAT_UUID.test(token)
    ? createHash("sha256").update(token).digest("hex")
    : null;
}
