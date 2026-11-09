import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { supabaseMemberStore } from "@/lib/members/memberStore";
import { stripeApi } from "@/lib/members/stripeApi";
import { handleStripeEvent, parseProductMap } from "@/lib/members/stripeEvents";
import { supabaseWelcomeStore, welcomeAfterWebhook } from "@/lib/members/welcome";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * #384: Stripe -> members tables. Stripe signs every delivery with the endpoint's secret
 * (STRIPE_WEBHOOK_SECRET); anything unsigned or signed with another secret is refused before it
 * is read. Each event id is processed once (member_stripe_events). A failure answers 500 so Stripe
 * delivers it again later. See lib/members/stripeEvents.ts for what each event does.
 *
 * #390: once the event's database work is done, a person it gave access for the first time gets
 * the welcome email (lib/members/welcome.ts), and older failed welcomes get their one retry. That
 * part never changes the answer: a failed send is recorded and retried by us, not by Stripe.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook_not_configured" }, 503);
  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing_signature" }, 400);
  // The exact bytes Stripe signed: read the body as text, never as parsed JSON.
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return json({ error: "invalid_signature" }, 400);
  }
  const db = createChatAdminClient();
  if (!db) return json({ error: "members_unavailable" }, 503);
  const granted = new Set<string>();
  let result;
  try {
    result = await handleStripeEvent(event as unknown as Parameters<typeof handleStripeEvent>[0], {
      store: supabaseMemberStore(db),
      api: stripeApi(),
      productMap: parseProductMap(process.env.STRIPE_PRODUCT_MAP),
      granted,
    });
  } catch (error) {
    console.error(`stripe webhook ${event.type} ${event.id}: ${error instanceof Error ? error.message : "failed"}`);
    return json({ error: "processing_failed" }, 500);
  }
  try {
    await welcomeAfterWebhook(supabaseWelcomeStore(db), granted);
  } catch (error) {
    console.error(`stripe webhook ${event.id}: welcome ${error instanceof Error ? error.message : "failed"}`);
  }
  return json({ received: true, ...result });
}
