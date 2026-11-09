import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import {
  NEW_LINKS_PER_HOUR,
  issueWelcomeToken,
  resendMailer,
  supabaseWelcomeStore,
  validWelcomeToken,
  welcomeEmail,
  welcomeLink,
  welcomeTokenHash,
} from "@/lib/members/welcome";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * #390: "Email me a new link" on an expired or used welcome link. The old link (whatever its state)
 * says who it was for; the new one goes only to that person's purchase email, at most
 * NEW_LINKS_PER_HOUR an hour. The answer never shows the email.
 */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const payload = await request.json().catch(() => null);
  if (!validWelcomeToken(payload?.t)) return json({ error: "invalid" }, 404);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  const store = supabaseWelcomeStore(db);
  try {
    const old = await store.tokenByHash(welcomeTokenHash(payload.t));
    const person = old ? await store.person(old.person_id) : null;
    if (!old || !person || person.email !== old.email) return json({ error: "invalid" }, 404);
    if (await store.isLongboardEmail(person.email)) return json({ error: "longboard_account" }, 409);
    if (!(await store.hasAccess(person.email))) return json({ error: "no_access" }, 403);
    const since = new Date(Date.now() - 60 * 60 * 1000);
    if ((await store.countTokens({ personId: person.id }, "email", since)) >= NEW_LINKS_PER_HOUR) return json({ error: "too_many_links" }, 429);
    const token = await issueWelcomeToken(store, person, "email");
    const sent = await resendMailer({ to: person.email, ...welcomeEmail("club", welcomeLink(token), person.name) });
    if (!sent.ok) return json({ error: "email_unavailable" }, 503);
    return json({ sent: true });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
