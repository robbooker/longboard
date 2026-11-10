import { NextResponse, type NextRequest } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { RADIO_CLIP_MAX_BYTES, validRadioClip } from "@/lib/chatRadioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A clip never changes (its name is a hash of its content), so the CDN and the browser keep it. */
const FOREVER = "public, max-age=31536000, immutable";
const decoded = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};
const unavailable = () =>
  NextResponse.json(
    { error: "radio_unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
const missing = (error: string, cdnSeconds: number) =>
  NextResponse.json(
    { error },
    {
      status: 404,
      headers: { "Cache-Control": "no-store", "CDN-Cache-Control": `public, s-maxage=${cdnSeconds}` },
    },
  );

/**
 * #415 Trader Radio: one clip. The signature in the address is the proof (only the member-only
 * playout hands them out), so there is no sign-in check and the CDN can serve every listener from
 * its copy: the database is read for a clip about once. The player fetches without a Range header
 * on purpose, because the CDN does not keep answers to Range requests.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ signature: string; path: string[] }> },
) {
  const { signature, path: parts } = await context.params;
  // Whether or not the framework has already decoded the address, the signed path is the one used.
  const path = [parts.join("/"), parts.map(decoded).join("/")].find((candidate) =>
    validRadioClip(signature, candidate),
  );
  if (!path)
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  const db = createChatAdminClient();
  if (!db) return unavailable();
  // Size first: the sound itself is only ever selected for this one clip, and only if it is small
  // enough for the CDN to keep. (Long evening episodes are not; the player skips them.)
  const about = await db
    .from("squawkbox_relay_audio")
    .select("content_type,byte_length")
    .eq("path", path)
    .maybeSingle();
  if (about.error) return unavailable();
  // The relay puts a pruned station ID back within minutes, so "missing" is remembered only briefly.
  if (!about.data) return missing("clip_missing", 60);
  if (!(about.data.byte_length <= RADIO_CLIP_MAX_BYTES)) return missing("clip_too_large", 3600);
  const clip = await db.from("squawkbox_relay_audio").select("body_base64").eq("path", path).maybeSingle();
  if (clip.error) return unavailable();
  if (!clip.data?.body_base64) return missing("clip_missing", 60);
  const body = Buffer.from(clip.data.body_base64 as string, "base64");
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": /^audio\/[\w.+-]+$/.test(about.data.content_type ?? "")
        ? about.data.content_type
        : "audio/mpeg",
      "Content-Length": String(body.byteLength),
      "Cache-Control": FOREVER,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
