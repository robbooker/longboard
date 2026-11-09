import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_AVATAR_BUCKET, CHAT_AVATAR_SIZES, chatAvatarFile, validAvatarPath } from "./chatAvatar";
import {
  AvatarError,
  AVATAR_MAX_BYTES,
  normalizeAvatar,
  renderAvatar,
  type AvatarCrop,
} from "./chatAvatarImage";
import { CHAT_UUID, withAvatarColumn } from "./chatMembers";

/**
 * #410 profile pictures, the server's side. Only these functions (service role) write the picture
 * buckets; browsers only ever get a one-time link to send their original photo to the private
 * upload bucket, and read the finished WebP files from the public one.
 *
 *   start   -> a reserved upload (per-member limit in the database) and its one-time upload link
 *   preview -> the original is checked and replaced by its cleaned copy, which the member sees
 *   save    -> the member's square at 256px and 64px, under a new random name; old files deleted
 *   remove  -> back to initials (yourself, or anyone when an admin asks); files deleted
 */
export const AVATAR_UPLOAD_BUCKET = "chat-avatar-uploads";
export const AVATAR_UNAVAILABLE = "Pictures aren't available right now. Please try again later.";
export const AVATAR_RATE_LIMITED = "You've changed your picture a lot recently. Please try again in an hour.";
const uploadPath = (memberId: string, uploadId: string) => `${memberId}/${uploadId}`;
const pictureFiles = (path: string) => CHAT_AVATAR_SIZES.map((size) => chatAvatarFile(path, size));

export async function startAvatarUpload(db: SupabaseClient, memberId: string, byteSize: unknown) {
  if (typeof byteSize !== "number" || !Number.isSafeInteger(byteSize) || byteSize < 1)
    throw new AvatarError("Choose a picture to upload.");
  if (byteSize > AVATAR_MAX_BYTES) throw new AvatarError("Pictures must be 10 MB or smaller.", 413);
  const { data: uploadId, error } = await db.rpc("chat_avatar_reserve", { p_member: memberId });
  if (error)
    throw error.message?.includes("avatar_rate_limited")
      ? new AvatarError(AVATAR_RATE_LIMITED, 429)
      : new AvatarError(AVATAR_UNAVAILABLE, 503);
  if (typeof uploadId !== "string" || !CHAT_UUID.test(uploadId))
    throw new AvatarError(AVATAR_UNAVAILABLE, 503);
  // Uploads this member started and never saved (another try, a closed dialog) are cleared out.
  const stale = await db
    .from("chat_avatar_uploads")
    .select("id")
    .eq("member_id", memberId)
    .is("used_at", null)
    .neq("id", uploadId)
    .limit(30);
  if (!stale.error && stale.data?.length)
    await db.storage
      .from(AVATAR_UPLOAD_BUCKET)
      .remove(stale.data.map((row: { id: string }) => uploadPath(memberId, row.id)))
      .catch(() => undefined);
  const signed = await db.storage
    .from(AVATAR_UPLOAD_BUCKET)
    .createSignedUploadUrl(uploadPath(memberId, uploadId));
  if (signed.error || !signed.data) throw new AvatarError(AVATAR_UNAVAILABLE, 503);
  return { uploadId, url: signed.data.signedUrl };
}

/** This member's upload that hasn't been saved yet (or an error a member can read). */
async function openUpload(db: SupabaseClient, memberId: string, uploadId: unknown) {
  if (typeof uploadId !== "string" || !CHAT_UUID.test(uploadId))
    throw new AvatarError("That upload has expired. Please choose your picture again.", 410);
  const row = await db
    .from("chat_avatar_uploads")
    .select("id,member_id,used_at,created_at")
    .eq("id", uploadId)
    .eq("member_id", memberId)
    .maybeSingle();
  if (row.error) throw new AvatarError(AVATAR_UNAVAILABLE, 503);
  if (!row.data || row.data.used_at || Date.parse(row.data.created_at) < Date.now() - 86_400_000)
    throw new AvatarError("That upload has expired. Please choose your picture again.", 410);
  const path = uploadPath(memberId, uploadId);
  const file = await db.storage.from(AVATAR_UPLOAD_BUCKET).download(path);
  if (file.error || !file.data)
    throw new AvatarError("Your picture didn't finish uploading. Please try again.", 409);
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  return { path, bytes };
}

const discard = (db: SupabaseClient, path: string) =>
  db.storage
    .from(AVATAR_UPLOAD_BUCKET)
    .remove([path])
    .catch(() => undefined);

/**
 * Checks the uploaded file and swaps it for its cleaned copy (upright, no metadata or location),
 * which is returned for the member's preview. A file that isn't a picture is deleted at once.
 */
export async function previewAvatarUpload(db: SupabaseClient, memberId: string, uploadId: unknown) {
  const upload = await openUpload(db, memberId, uploadId);
  let normal;
  try {
    normal = await normalizeAvatar(upload.bytes);
  } catch (error) {
    await discard(db, upload.path);
    throw error;
  }
  const stored = await db.storage
    .from(AVATAR_UPLOAD_BUCKET)
    .upload(upload.path, normal.data, { contentType: "image/webp", upsert: true });
  if (stored.error) throw new AvatarError(AVATAR_UNAVAILABLE, 503);
  return normal;
}

/** Makes the upload the member's picture. Returns the new picture name. */
export async function saveAvatarUpload(
  db: SupabaseClient,
  memberId: string,
  uploadId: unknown,
  crop: AvatarCrop,
) {
  const upload = await openUpload(db, memberId, uploadId);
  let rendered;
  try {
    rendered = await renderAvatar(upload.bytes, crop);
  } catch (error) {
    await discard(db, upload.path);
    throw error;
  }
  const path = crypto.randomUUID();
  const bucket = db.storage.from(CHAT_AVATAR_BUCKET);
  const written = await Promise.all(
    (
      [
        [256, rendered.large],
        [64, rendered.small],
      ] as const
    ).map(([size, bytes]) =>
      bucket.upload(chatAvatarFile(path, size), bytes, {
        contentType: "image/webp",
        // A picture never changes under its name: a new picture gets a new name.
        cacheControl: "31536000",
        upsert: false,
      }),
    ),
  );
  if (written.some((result) => result.error)) {
    await bucket.remove(pictureFiles(path)).catch(() => undefined);
    throw new AvatarError(AVATAR_UNAVAILABLE, 503);
  }
  const { data: old, error } = await db.rpc("chat_avatar_set", {
    p_member: memberId,
    p_upload: uploadId,
    p_path: path,
  });
  if (error) {
    await bucket.remove(pictureFiles(path)).catch(() => undefined);
    throw error.message?.includes("avatar_upload_invalid")
      ? new AvatarError("That upload has expired. Please choose your picture again.", 410)
      : new AvatarError(AVATAR_UNAVAILABLE, 503);
  }
  await Promise.all([
    discard(db, upload.path),
    validAvatarPath(old) ? bucket.remove(pictureFiles(old)).catch(() => undefined) : undefined,
  ]);
  return path;
}

/** Back to initials. Returns whether there was a picture to remove. */
export async function removeAvatar(db: SupabaseClient, memberId: string) {
  const { data: old, error } = await db.rpc("chat_avatar_clear", { p_member: memberId });
  if (error)
    throw error.message?.includes("member_required")
      ? new AvatarError("That member wasn't found.", 404)
      : new AvatarError(AVATAR_UNAVAILABLE, 503);
  if (validAvatarPath(old))
    await db.storage
      .from(CHAT_AVATAR_BUCKET)
      .remove(pictureFiles(old))
      .catch(() => undefined);
  return validAvatarPath(old);
}

/** Drops an upload the member gave up on (they closed the dialog or chose another photo). */
export async function discardAvatarUpload(db: SupabaseClient, memberId: string, uploadId: unknown) {
  if (typeof uploadId !== "string" || !CHAT_UUID.test(uploadId)) return;
  await discard(db, uploadPath(memberId, uploadId));
}
