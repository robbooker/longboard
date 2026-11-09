import type { SupabaseClient } from "@supabase/supabase-js";
import { validAvatarPath } from "./chatAvatar";
import { CHAT_UUID, withAvatarColumn } from "./chatMembers";

// #410: pictures for lists of members. Kept apart from chatAvatarServer.ts so list routes don't load
// the image tools.
/**
 * Picture names for members shown in a list (member list, DM list, tag suggestions): one read per
 * list, never per message. A failed read (or the column not there yet) just means initials.
 */
export async function memberAvatars(db: SupabaseClient, ids: Array<string | null | undefined>) {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && CHAT_UUID.test(id)))];
  const avatars = new Map<string, string>();
  try {
    for (let offset = 0; offset < wanted.length; offset += 200) {
      const batch = wanted.slice(offset, offset + 200);
      const { data, error } = await withAvatarColumn((avatar) =>
        db
          .from("longboard_chat_members")
          .select(avatar ? "id,avatar_path" : "id")
          .in("id", batch),
      );
      if (error) continue;
      for (const row of (data ?? []) as unknown as Array<{ id: string; avatar_path?: unknown }>)
        if (validAvatarPath(row.avatar_path)) avatars.set(String(row.id).toLowerCase(), row.avatar_path);
    }
  } catch {
    /* Initials instead. */
  }
  return avatars;
}

/** Adds `avatar_path` to the listed members that have a picture (others are left as they were). */
export async function withMemberAvatars<T extends { id: string }>(db: SupabaseClient, members: T[]) {
  const avatars = await memberAvatars(
    db,
    members.map((member) => member.id),
  );
  return members.map((member) => {
    const avatar = avatars.get(String(member.id).toLowerCase());
    return avatar ? { ...member, avatar_path: avatar } : member;
  });
}

/** `{ avatar_path }` for a member with a picture, `{}` otherwise (so the response is unchanged). */
export function avatarField(avatars: Map<string, string>, id: string) {
  const avatar = avatars.get(String(id).toLowerCase());
  return avatar ? { avatar_path: avatar } : {};
}
