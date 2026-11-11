import { createHash, randomUUID } from "node:crypto";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { CHAT_ATTACHMENT_BUCKET } from "@/lib/chatAttachments";
import { ensureAttachmentPreview } from "@/lib/chatAttachmentPreview";
import { attachmentSignature } from "@/lib/chatAttachmentValidation";
import { imageDimensions, rebuildChatImage } from "@/lib/chatImageRebuild";
import { WHATS_NEW_PICTURE_MAX_BYTES, whatsNewAuthorized, whatsNewPictureFilename } from "@/lib/chatWhatsNew";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * #443: uploads one "after" picture for a PR's What's New note. Called by
 * scripts/whats-new/post-whats-new.mjs (and post-pictures.mjs) with WHATS_NEW_TOKEN, never by a
 * member. The body is the PNG or JPEG itself; ?pr= names the PR, ?caption= the text shown under
 * it, and ?followUp=1 says the PR's note is already posted (the pictures go after it).
 *
 * The image is rebuilt from its pixels (metadata and anything hidden in the file dropped), saved
 * in the chat-attachments bucket like a member's image, and recorded as a ready file of Booker
 * Chat Updates. The note's post binds it; an unused upload is removed by the attachment cron.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.WHATS_NEW_TOKEN;
  if (!secret || secret.length < 32) return json({ error: "whats_new_not_configured" }, 503);
  if (!whatsNewAuthorized(request.headers.get("authorization"), secret))
    return json({ error: "unauthorized" }, 401);
  const mime = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "image/png" && mime !== "image/jpeg") return json({ error: "invalid_content_type" }, 415);
  const params = request.nextUrl.searchParams;
  const pr = Number(params.get("pr"));
  if (!/^\d{1,10}$/.test(params.get("pr") ?? "") || !Number.isSafeInteger(pr) || pr < 1 || pr > 1_000_000_000)
    return json({ error: "invalid_pr" }, 400);
  const caption = params.get("caption") ?? "";
  if (caption.length > 300) return json({ error: "invalid_caption" }, 400);
  const followUp = params.get("followUp") === "1";
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > WHATS_NEW_PICTURE_MAX_BYTES) return json({ error: "picture_too_large" }, 413);
  const raw = await request.arrayBuffer().catch(() => null);
  if (!raw) return json({ error: "invalid_body" }, 400);
  if (raw.byteLength > WHATS_NEW_PICTURE_MAX_BYTES) return json({ error: "picture_too_large" }, 413);
  const bytes = new Uint8Array(raw);
  if (!bytes.length || !attachmentSignature(bytes, mime)) return json({ error: "invalid_picture" }, 400);

  const db = createChatAdminClient();
  if (!db) return json({ error: "whats_new_unavailable" }, 503);
  // A PR's note goes out once: its pictures upload before it (or, with followUp, after it, once).
  const known = await db
    .from("chat_whats_new_changes")
    .select("pr_number,pictures_posted_at")
    .eq("pr_number", pr);
  if (known.error) return json({ error: "whats_new_unavailable" }, 503);
  const change = known.data?.[0] as { pictures_posted_at: string | null } | undefined;
  if (change?.pictures_posted_at) return json({ error: "pictures_already_posted" }, 409);
  if (change && !followUp) return json({ error: "already_announced" }, 409);
  if (!change && followUp) return json({ error: "not_announced" }, 409);

  const safe = await rebuildChatImage(bytes, mime, true);
  if (!safe) return json({ error: "invalid_picture" }, 400);
  const id = randomUUID(),
    path = `clean/${randomUUID()}`;
  const stored = await db.storage
    .from(CHAT_ATTACHMENT_BUCKET)
    .upload(path, safe, { contentType: mime, upsert: false, cacheControl: "0" });
  if (stored.error) return json({ error: "whats_new_unavailable" }, 503);
  const dims = await imageDimensions(safe);
  const row = {
    id,
    member_id: null,
    room_slug: "whats-new",
    filename: whatsNewPictureFilename(caption, mime),
    mime_type: mime,
    byte_size: safe.length,
    // Never handed out: server uploads skip the quarantine step, but the column is required.
    upload_path: `whats-new/${randomUUID()}`,
    object_path: path,
    sha256: createHash("sha256").update(safe).digest("hex"),
    status: "ready",
    whats_new_pr: pr,
    ...(dims ? { width: dims[0], height: dims[1] } : {}),
  };
  const saved = await db.from("chat_attachments").insert(row).select("id").maybeSingle();
  if (saved.error || !saved.data) {
    await db.storage.from(CHAT_ATTACHMENT_BUCKET).remove([path]);
    return json({ error: "whats_new_unavailable" }, 503);
  }
  // The small preview members see first; it is made again on first view if this fails.
  await ensureAttachmentPreview(db, { ...row, preview_unavailable: false }, safe).catch(() => undefined);
  return json({
    id,
    filename: row.filename,
    byteSize: safe.length,
    width: dims?.[0] ?? null,
    height: dims?.[1] ?? null,
  });
}
