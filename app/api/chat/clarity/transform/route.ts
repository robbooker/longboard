import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { resolveClarityConversation } from "@/lib/clarity/pair";
import {
  CLARITY_MAX_DRAFT,
  ClarityUnavailable,
  clarityStandards,
  transformDraft,
} from "@/lib/clarity/transform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Two people use this; a per-instance cap is enough to stop runaway cost from a stuck client.
const recent = new Map<string, number[]>();
function allow(memberId: string, now = Date.now()) {
  const window = (recent.get(memberId) ?? []).filter((at) => now - at < 10 * 60_000);
  if (window.length >= 40) return false;
  recent.set(memberId, [...window, now]);
  return true;
}

/** Returns a suggestion for review. Never sends or stores a message. */
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const raw = await req.text();
  if (raw.length > 12_000) return json({ error: "Your draft is too long to review." }, 413);
  let payload: { conversationId?: unknown; draft?: unknown; variant?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const draft = payload.draft;
  const variant = payload.variant ?? 0;
  if (typeof draft !== "string" || !draft.trim() || draft.length > CLARITY_MAX_DRAFT)
    return json({ error: "Write a message of up to 2,000 characters first." }, 400);
  if (!Number.isInteger(variant) || (variant as number) < 0 || (variant as number) > 50)
    return json({ error: "invalid_request" }, 400);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  try {
    const target = await resolveClarityConversation(db, auth.user.id, payload.conversationId);
    if (!target) return json({ error: "not_found" }, 404);
    if (!allow(target.senderMemberId))
      return json(
        { error: "Too many reviews in a short time. Wait a few minutes, or send your original." },
        429,
      );
    const result = await transformDraft({
      sender: target.sender,
      recipient: target.recipient,
      originalMessage: draft,
      variant: variant as number,
    });
    return json({ result, standardsSha256: clarityStandards().sha256 });
  } catch (error) {
    if (error instanceof ClarityUnavailable) return json({ error: error.message }, 502);
    console.error("[clarity] transform-failed", error instanceof Error ? error.name : "unknown");
    return json(
      { error: "The review couldn't run. Your draft is unchanged; try again or send your original." },
      502,
    );
  }
}
