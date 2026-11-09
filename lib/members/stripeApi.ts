import Stripe from "stripe";
import type { StripeApi } from "@/lib/members/stripeEvents";

/**
 * #384: the Stripe client, on fetch (so it runs anywhere Next does). Null without
 * STRIPE_SECRET_KEY: the webhook still works from the event payloads alone, it just can't read
 * line items (product mapping then needs metadata.lb_product) or fill in missing details.
 */
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 1, timeout: 8000 });
}

export function stripeApi(client = stripeClient()): StripeApi | null {
  if (!client) return null;
  return {
    async lineItems(sessionId) {
      const items = await client.checkout.sessions.listLineItems(sessionId, { limit: 10 });
      return items.data.map((item) => {
        const price = item.price;
        const product = price?.product;
        return {
          priceId: price?.id ?? null,
          productId: typeof product === "string" ? product : (product?.id ?? null),
        };
      });
    },
    async subscription(id) {
      return (await client.subscriptions.retrieve(id)) as unknown as Record<string, unknown>;
    },
    async customerEmail(id) {
      const customer = await client.customers.retrieve(id);
      if ("deleted" in customer && customer.deleted) return null;
      const live = customer as Stripe.Customer;
      return { email: live.email ?? null, name: live.name ?? null };
    },
    async subscriptionForPaymentIntent(paymentIntentId) {
      const payments = await client.invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: paymentIntentId },
        limit: 1,
        expand: ["data.invoice"],
      });
      const invoice = payments.data[0]?.invoice as unknown;
      if (!invoice || typeof invoice !== "object") return null;
      const parent = (invoice as { parent?: { subscription_details?: { subscription?: unknown } } }).parent;
      const sub = parent?.subscription_details?.subscription;
      return typeof sub === "string" ? sub : ((sub as { id?: string } | undefined)?.id ?? null);
    },
  };
}
