import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { resolveClarityConversation } from "@/lib/clarity/pair";
import { transcribeVoice } from "@/lib/chatTranscription";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const MAX_BYTES = 8_000_000;
const TYPES: Record<string, string> = {
  "audio/webm": "dictation.webm",
  "audio/mp4": "dictation.mp4",
  "audio/mpeg": "dictation.mp3",
  "audio/ogg": "dictation.ogg",
  "audio/wav": "dictation.wav",
};

/** Dictation: audio in, editable draft text out. The audio is not stored or shared. */
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES + 10_000)
    return json({ error: "That recording is too long. Keep dictation under about 4 minutes." }, 413);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || !file.size || file.size > MAX_BYTES)
    return json({ error: "That recording couldn't be used. Try again." }, 400);
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (!TYPES[type]) return json({ error: "That audio format isn't supported." }, 415);
  try {
    const target = await resolveClarityConversation(db, auth.user.id, form.get("conversationId"));
    if (!target) return json({ error: "not_found" }, 404);
    const text = await transcribeVoice(new Uint8Array(await file.arrayBuffer()), fetch, {
      type,
      name: TYPES[type],
    });
    // The shared helper returns a placeholder sentence on silence; never put that in a draft.
    if (text === "No speech could be recognized.")
      return json({ error: "No speech was recognized. Try again." }, 422);
    return json({ text });
  } catch {
    return json({ error: "Transcription isn't available right now. Type your message instead." }, 502);
  }
}
