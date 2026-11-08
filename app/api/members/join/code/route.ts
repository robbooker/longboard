import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { normalizeEmail } from "@/lib/memberAccess";
import { createJoinCode, joinStatus, sendJoinCodeEmail } from "@/lib/members/join";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** #384: email a six-digit sign-in code to a club buyer. Only an email with club access gets one. */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const payload = await request.json().catch(() => null);
  const email = normalizeEmail(payload?.email);
  if (!email) return json({ error: "email_required" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  let status;
  try {
    status = (await joinStatus(db, { email })).status;
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  if (status === "pending") return json({ error: "no_purchase" }, 404);
  if (status === "longboard_account") return json({ error: "longboard_account" }, 409);
  if (status !== "ready") return json({ error: "no_access" }, 403);
  const made = await createJoinCode(db, email);
  if (!made.ok) return json({ error: made.error }, made.error === "too_many_codes" ? 429 : 503);
  if (!(await sendJoinCodeEmail(email, made.code))) return json({ error: "email_unavailable" }, 503);
  return json({ sent: true });
}
