// #522: a member who loses access stops watching. Server only.
// When an admin suspends or deletes someone, changes their role, removes their Boardroom tag or
// revokes an entitlement, or a member unlinks ShortScout, that person's connections to any live
// video room are closed here. It is deliberately blunt: they are removed from every video room
// that exists, and tokens they already hold stop working. A player that is removed asks for a new
// token once (useStageLink.ts), and the token route reads their access fresh: someone who may still
// watch that room is back in a second or two, someone who may not stays out.
// Best effort and bounded: nothing happens unless LiveKit is set up; one call lists the video rooms
// that exist (normally none or one), then one call per seat per room. It never throws, and the
// admin's action never waits for it or fails because of it.
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createChatAdminClient } from "./chatAdmin";
import { findChatMember } from "./chatMembers";
import { stageVideoApi } from "./chatStageLiveKit";
import { chatRoomOfStageVideoRoom, stageVideoConfig, stageViewerIdentities, type StageVideoApi } from "./chatStageVideo";

/** Closes every connection a chat member has to any video room. Returns how many were closed. */
export async function removeStageMember(api: Pick<StageVideoApi, "videoRooms" | "removeViewer">, memberId: string): Promise<number> {
  const videoRooms = (await api.videoRooms()).filter((name) => chatRoomOfStageVideoRoom(name));
  const removed = await Promise.all(
    videoRooms.flatMap((videoRoom) => stageViewerIdentities(memberId).map((identity) => api.removeViewer(videoRoom, identity, true).catch(() => false))),
  );
  return removed.filter(Boolean).length;
}

/** The chat member ids behind these accounts (a Longboard user id is its chat account's id). */
async function memberIds(db: SupabaseClient, userIds: readonly string[]) {
  const found = await Promise.all(userIds.map((id) => findChatMember(db, id).catch(() => null)));
  return found.flatMap((member) => (member ? [member.id] : []));
}

/**
 * The chat member id of an account, for a caller about to delete that account (afterwards it can no
 * longer be looked up). Null when LiveKit is not set up (nothing is read then) or there is none.
 */
export async function stageMemberIdOf(userId: string): Promise<string | null> {
  try {
    if (!stageVideoConfig()) return null;
    const db = createChatAdminClient();
    return db ? ((await memberIds(db, [userId]))[0] ?? null) : null;
  } catch {
    return null;
  }
}

function afterResponse(run: () => Promise<void>) {
  const safe = async () => {
    try {
      await run();
    } catch {
      // No name, id or token in the log.
      console.info("[chat-stage] remove-failed");
    }
  };
  try {
    after(safe);
  } catch {
    void safe();
  }
}

/** After the response: these chat members' video connections are closed. */
export function removeStageMembersAfterResponse(ids: readonly (string | null | undefined)[]) {
  const config = stageVideoConfig();
  const members = [...new Set(ids.filter((id): id is string => !!id))];
  if (!config || !members.length) return;
  afterResponse(async () => {
    const api = stageVideoApi(config);
    for (const member of members) await removeStageMember(api, member);
  });
}

/** After the response: this account's video connections are closed (its access just changed). */
export function removeStageViewerAfterResponse(userId: string) {
  const config = stageVideoConfig();
  if (!config) return;
  afterResponse(async () => {
    const db = createChatAdminClient();
    if (!db) return;
    const api = stageVideoApi(config);
    for (const member of await memberIds(db, [userId])) await removeStageMember(api, member);
  });
}

/**
 * After the response: the same for whoever a member entitlement belongs to. Entitlements are held
 * by a person (an email), who is a club sign-in's chat account, a Longboard account with that
 * email, or both (public.member_account_entitlements is the rule this mirrors).
 */
export function removeStagePersonAfterResponse(personId: string) {
  const config = stageVideoConfig();
  if (!config) return;
  afterResponse(async () => {
    const db = createChatAdminClient();
    if (!db) return;
    const { data: person } = await db.from("member_people").select("email, chat_account_id").eq("id", personId).maybeSingle();
    if (!person) return;
    const accounts = new Set<string>();
    if (typeof person.chat_account_id === "string") accounts.add(person.chat_account_id);
    if (typeof person.email === "string" && person.email) {
      const { data: profiles } = await db.from("profiles").select("id").ilike("email", person.email.replace(/[\\%_]/g, "\\$&")).limit(5);
      for (const profile of profiles ?? []) if (typeof profile.id === "string") accounts.add(profile.id);
    }
    const api = stageVideoApi(config);
    for (const member of await memberIds(db, [...accounts])) await removeStageMember(api, member);
  });
}
