import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { CHAT_UUID, findChatMember } from "@/lib/chatMembers";
import { AvatarError, parseAvatarCrop } from "@/lib/chatAvatarImage";
import {
  AVATAR_UNAVAILABLE,
  discardAvatarUpload,
  previewAvatarUpload,
  removeAvatar,
  saveAvatarUpload,
  startAvatarUpload,
} from "@/lib/chatAvatarServer";

/**
 * #410 profile pictures. POST { action } with:
 *   start   { byteSize }           -> { uploadId, url }  (PUT the file to url)
 *   preview { uploadId }           -> the cleaned picture (image/webp) for the crop circle
 *   save    { uploadId, crop }     -> { accountId, member }  (member.avatar_path is the new picture)
 *   discard { uploadId }           -> { ok }
 *   remove  { memberId? }          -> { memberId, removed }  (someone else's: admins only)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "Origin not allowed." }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  // Bots and personal API tokens can't change pictures.
  if (auth.access?.botRooms || auth.apiToken)
    return json({ error: "Pictures can only be changed in the chat." }, 403);
  const db = createChatAdminClient();
  if (!db) return json({ error: AVATAR_UNAVAILABLE }, 503);
  const body = await req.json().catch(() => null);
  const action = body?.action;
  try {
    const member = await findChatMember(db, auth.user.id).catch(() => {
      throw new AvatarError(AVATAR_UNAVAILABLE, 503);
    });
    if (!member) return json({ error: "Join the chat with a name before adding a picture." }, 403);
    switch (action) {
      case "start":
        return json(await startAvatarUpload(db, member.id, body.byteSize));
      case "preview": {
        const normal = await previewAvatarUpload(db, member.id, body.uploadId);
        return new NextResponse(new Uint8Array(normal.data), {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "private, no-store",
            "X-Avatar-Width": String(normal.width),
            "X-Avatar-Height": String(normal.height),
          },
        });
      }
      case "save": {
        const path = await saveAvatarUpload(db, member.id, body.uploadId, parseAvatarCrop(body.crop));
        return json({ accountId: auth.user.id, member: { ...member, avatar_path: path } });
      }
      case "discard":
        await discardAvatarUpload(db, member.id, body.uploadId);
        return json({ ok: true });
      case "remove": {
        const target = body.memberId === undefined || body.memberId === null ? member.id : body.memberId;
        if (typeof target !== "string" || !CHAT_UUID.test(target))
          return json({ error: "Choose a member." }, 400);
        const self = target.toLowerCase() === member.id.toLowerCase();
        // Your own picture is yours to remove; anyone else's only an admin can.
        if (!self && !auth.access?.admin)
          return json({ error: "Only admins can remove someone else's picture." }, 403);
        const removed = await removeAvatar(db, target);
        if (!self) console.info(`[chat-avatar] admin ${member.id} removed the picture of ${target}`);
        const { avatar_path: _old, ...rest } = member;
        return json({
          memberId: target,
          removed,
          ...(self ? { accountId: auth.user.id, member: rest } : {}),
        });
      }
      default:
        return json({ error: "invalid_action" }, 400);
    }
  } catch (error) {
    if (error instanceof AvatarError) return json({ error: error.message }, error.status);
    console.error("[chat-avatar]", error instanceof Error ? error.message : error);
    return json({ error: AVATAR_UNAVAILABLE }, 503);
  }
}
