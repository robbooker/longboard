import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatName } from "@/lib/chatDisplayName";
import { memberKeys } from "@/lib/memberAccess";
import { isLongboardEmail } from "@/lib/members/join";
import type { MemberPerson } from "@/lib/members/types";

/**
 * #390: the Booker Stock Club welcome. When Stripe first grants a person access, we email them
 * "Welcome to the Booker Stock Club" with one button that signs them in (no typing). The link
 * carries a random token; only its sha256 is stored, it works once, for 7 days, for that person.
 * The thank-you page can make a short-lived token from the Stripe checkout session instead
 * (2 hours after the purchase, one sign-in per session). Email of a Longboard account: the welcome
 * says the club is on their Longboard account and links to the Longboard sign-in (no token).
 *
 * Sending never fails the Stripe webhook: the status is recorded on the person (welcome_*), a
 * failed send is retried once (on a later webhook or the member-welcomes cron), and admins can
 * resend from the Members page.
 */
export const WELCOME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CHECKOUT_TOKEN_TTL_MS = 15 * 60 * 1000;
export const CHECKOUT_SIGN_IN_WINDOW_MS = 2 * 60 * 60 * 1000;
/** "Email me a new link": this many links per person an hour. */
export const NEW_LINKS_PER_HOUR = 3;
/** Thank-you button presses per checkout session an hour. */
export const CHECKOUT_TOKENS_PER_HOUR = 5;
export const WELCOME_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const GAINERS_PATH = "/chat?room=gainers";

export type WelcomeStatus = "pending" | "sent" | "failed" | "not_needed";
export type WelcomeKind = "club" | "longboard";
export type WelcomeToken = {
  id: string;
  person_id: string;
  email: string;
  token_hash: string;
  purpose: "email" | "checkout";
  checkout_session_id: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};
export type RedeemResult =
  | { status: "ok"; account: string; member: boolean; name: string | null }
  | { status: "invalid" | "used" | "expired" | "session_used" | "longboard_account" | "no_access" | "no_purchase" };

/** What the welcome reads and writes. Supabase in the app, memory in tests. */
export interface WelcomeStore {
  /** Mark the welcome 'pending' if it may go now ('first': never sent; 'admin': always). */
  claim(personId: string, mode: "first" | "admin"): Promise<MemberPerson | null>;
  /** Claim the welcomes due their one automatic retry. */
  claimRetries(limit: number): Promise<MemberPerson[]>;
  finish(personId: string, fields: { welcome_status: WelcomeStatus; welcome_kind?: WelcomeKind | null; welcome_error?: string | null; welcome_sent_at?: string | null }): Promise<void>;
  person(id: string): Promise<MemberPerson | null>;
  hasAccess(email: string): Promise<boolean>;
  isLongboardEmail(email: string): Promise<boolean>;
  insertToken(row: Omit<WelcomeToken, "id" | "created_at" | "consumed_at">): Promise<void>;
  tokenByHash(hash: string): Promise<WelcomeToken | null>;
  countTokens(by: { personId: string } | { sessionId: string }, purpose: WelcomeToken["purpose"], since: Date): Promise<number>;
  checkoutPurchase(sessionId: string): Promise<{ person_id: string; created_at: string } | null>;
  checkoutSessionUsed(sessionId: string): Promise<boolean>;
  /** Use the token and open a chat session (hash of the cookie value) in one transaction. */
  redeem(tokenHash: string, sessionHash: string, expiresAt: Date): Promise<RedeemResult>;
}

export const newWelcomeToken = () => randomBytes(32).toString("base64url");
export const welcomeTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const validWelcomeToken = (token: unknown): token is string => typeof token === "string" && WELCOME_TOKEN_RE.test(token);

/** The club chat's address in links (MEMBERS_CHAT_URL, for tests and previews). */
export function chatUrl() {
  return (process.env.MEMBERS_CHAT_URL || "https://chat.robbooker.com").replace(/\/+$/, "");
}
export const welcomeLink = (token: string) => `${chatUrl()}/join/club/welcome?t=${encodeURIComponent(token)}`;
export const longboardSignInLink = () => `${chatUrl()}/login?next=${encodeURIComponent(GAINERS_PATH)}`;
/** The Stripe name, if it works as a chat name, to fill in the name box. */
export const suggestedName = (name: string | null | undefined) => chatName(name ?? "") ?? "";

export async function issueWelcomeToken(store: WelcomeStore, person: Pick<MemberPerson, "id" | "email">, purpose: WelcomeToken["purpose"], sessionId: string | null = null, now = new Date()) {
  const token = newWelcomeToken();
  await store.insertToken({
    person_id: person.id,
    email: person.email,
    token_hash: welcomeTokenHash(token),
    purpose,
    checkout_session_id: purpose === "checkout" ? sessionId : null,
    expires_at: new Date(now.getTime() + (purpose === "checkout" ? CHECKOUT_TOKEN_TTL_MS : WELCOME_TTL_MS)).toISOString(),
  });
  return token;
}

export type TokenState = { state: "ready"; token: WelcomeToken } | { state: "used" | "expired"; token: WelcomeToken } | { state: "invalid" };

/** What a link is, without using it up (the welcome page's GET). */
export async function welcomeTokenState(store: WelcomeStore, token: unknown, now = new Date()): Promise<TokenState> {
  if (!validWelcomeToken(token)) return { state: "invalid" };
  const row = await store.tokenByHash(welcomeTokenHash(token));
  if (!row) return { state: "invalid" };
  if (row.consumed_at) return { state: "used", token: row };
  if (Date.parse(row.expires_at) <= now.getTime()) return { state: "expired", token: row };
  return { state: "ready", token: row };
}

export type Mail = { to: string; subject: string; text: string; html: string; tag: string };
export type Mailer = (mail: Mail) => Promise<{ ok: boolean; error?: string }>;

/** Resend (RESEND_API_KEY), from MEMBERS_FROM_EMAIL. */
export const resendMailer: Mailer = async (mail) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MEMBERS_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false, error: "email_not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, tags: [{ name: "kind", value: mail.tag }] }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? { ok: true } : { ok: false, error: `resend_${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === "TimeoutError" ? "resend_timeout" : "resend_unreachable" };
  }
};

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The welcome email. 'club': the one-tap link; 'longboard': sign in with Longboard. */
export function welcomeEmail(kind: WelcomeKind, link: string, name: string | null): Omit<Mail, "to"> {
  const first = (name ?? "").trim().split(/\s+/)[0]?.slice(0, 40) ?? "";
  const hello = first ? `Hi ${first},` : "Hi,";
  const button = kind === "club" ? "Open the club chat" : "Sign in with Longboard";
  const body =
    kind === "club"
      ? [
          "Thanks for joining. Your membership comes with the Gainers room, the Gainers Table, the News Feed, the Reader and the Booker Stock Club room.",
          "Tap the button to open the club chat. No password needed. The button works once, for 7 days; after that you can ask for a new one.",
        ]
      : [
          "Thanks for joining. The Booker Stock Club is now on your Longboard account: the Gainers room, the Gainers Table, the News Feed, the Reader and the Booker Stock Club room.",
          "Sign in with Longboard as you always do, using this email address, and you'll find them in the chat.",
        ];
  const text = `${hello}\n\n${body.join("\n\n")}\n\n${button}: ${link}\n\nIf you didn't buy a Booker Stock Club membership, you can ignore this email.\n\nBooker Stock Club`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4efe6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf8;border:1px solid #e3dccd;border-radius:10px">
<tr><td style="padding:32px 32px 8px;font-family:Georgia,serif;color:#17211f">
<p style="margin:0 0 18px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#a8342e">Booker Stock Club</p>
<h1 style="margin:0 0 18px;font-size:26px;line-height:1.25;font-weight:600">Welcome to the Booker Stock Club</h1>
<p style="margin:0 0 14px;font-size:16px;line-height:1.55">${escapeHtml(hello)}</p>
${body.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55">${escapeHtml(p)}</p>`).join("\n")}
</td></tr>
<tr><td style="padding:10px 32px 28px">
<a href="${escapeHtml(link)}" style="display:inline-block;background:#17211f;color:#fffdf8;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:14px 26px;border-radius:8px">${button}</a>
</td></tr>
<tr><td style="padding:0 32px 28px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#53605a">
If the button doesn't work, copy this address into your browser:<br><a href="${escapeHtml(link)}" style="color:#53605a;word-break:break-all">${escapeHtml(link)}</a><br><br>
If you didn't buy a Booker Stock Club membership, you can ignore this email.
</td></tr></table></td></tr></table></body></html>`;
  return { subject: "Welcome to the Booker Stock Club", text, html, tag: kind === "club" ? "club-welcome" : "club-welcome-longboard" };
}

type SendDeps = { mailer?: Mailer; now?: () => Date };

/** Send a claimed ('pending') welcome and record how it went. Never throws. */
async function sendClaimed(store: WelcomeStore, person: MemberPerson, force: boolean, deps: SendDeps): Promise<WelcomeStatus> {
  const now = deps.now?.() ?? new Date();
  let kind: WelcomeKind | null = null;
  try {
    // Already has a chat account (signed up with a code first): nothing to send unless an admin asks.
    if (person.chat_account_id && !force) {
      await store.finish(person.id, { welcome_status: "not_needed" });
      return "not_needed";
    }
    kind = (await store.isLongboardEmail(person.email)) ? "longboard" : "club";
    if (kind === "club" && !(await store.hasAccess(person.email))) {
      await store.finish(person.id, { welcome_status: "not_needed", welcome_error: "no_access" });
      return "not_needed";
    }
    const link = kind === "club" ? welcomeLink(await issueWelcomeToken(store, person, "email", null, now)) : longboardSignInLink();
    const sent = await (deps.mailer ?? resendMailer)({ to: person.email, ...welcomeEmail(kind, link, person.name) });
    await store.finish(
      person.id,
      sent.ok
        ? { welcome_status: "sent", welcome_kind: kind, welcome_sent_at: now.toISOString(), welcome_error: null }
        : { welcome_status: "failed", welcome_kind: kind, welcome_error: (sent.error ?? "send_failed").slice(0, 300) },
    );
    return sent.ok ? "sent" : "failed";
  } catch (error) {
    await store
      .finish(person.id, { welcome_status: "failed", welcome_kind: kind, welcome_error: (error instanceof Error ? error.message : "failed").slice(0, 300) })
      .catch(() => {});
    return "failed";
  }
}

/** The first welcome for a person (from the webhook), or an admin's resend. */
export async function deliverWelcome(store: WelcomeStore, personId: string, mode: "first" | "admin", deps: SendDeps = {}): Promise<WelcomeStatus | "skipped"> {
  const person = await store.claim(personId, mode).catch(() => null);
  if (!person) return "skipped";
  return sendClaimed(store, person, mode === "admin", deps);
}

/** The one automatic retry of failed (or stuck) welcomes. */
export async function retryWelcomes(store: WelcomeStore, limit = 5, deps: SendDeps = {}) {
  const due = await store.claimRetries(limit).catch(() => [] as MemberPerson[]);
  const results: WelcomeStatus[] = [];
  for (const person of due) results.push(await sendClaimed(store, person, false, deps));
  return results;
}

/** After a webhook's database work is done: welcome the people it first granted, then retry old failures. */
export async function welcomeAfterWebhook(store: WelcomeStore, granted: Iterable<string>, deps: SendDeps = {}) {
  for (const id of granted) await deliverWelcome(store, id, "first", deps);
  await retryWelcomes(store, 3, deps);
}

export type CheckoutSignIn =
  | { ok: true; personId: string; email: string }
  | { ok: false; reason: "pending" | "too_old" | "linked" | "session_used" | "no_access" | "longboard_account" };

/** May this checkout session sign its buyer in with one tap (thank-you page)? */
export async function checkoutSignIn(store: WelcomeStore, sessionId: string, now = new Date()): Promise<CheckoutSignIn> {
  const purchase = await store.checkoutPurchase(sessionId);
  if (!purchase) return { ok: false, reason: "pending" };
  if (now.getTime() - Date.parse(purchase.created_at) > CHECKOUT_SIGN_IN_WINDOW_MS) return { ok: false, reason: "too_old" };
  const person = await store.person(purchase.person_id);
  if (!person) return { ok: false, reason: "pending" };
  if (person.chat_account_id) return { ok: false, reason: "linked" };
  if (await store.checkoutSessionUsed(sessionId)) return { ok: false, reason: "session_used" };
  if (await store.isLongboardEmail(person.email)) return { ok: false, reason: "longboard_account" };
  if (!(await store.hasAccess(person.email))) return { ok: false, reason: "no_access" };
  return { ok: true, personId: person.id, email: person.email };
}

/** The welcome tables through the service-role client. */
export function supabaseWelcomeStore(db: SupabaseClient): WelcomeStore {
  const fail = (what: string, error: { message?: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message ?? "failed"}`);
  };
  return {
    async claim(personId, mode) {
      const { data, error } = await db.rpc("member_welcome_claim", { p_person: personId, p_mode: mode });
      fail("welcome_claim", error);
      return (data as MemberPerson | null) ?? null;
    },
    async claimRetries(limit) {
      const { data, error } = await db.rpc("member_welcome_claim_retries", { p_limit: limit });
      fail("welcome_retries", error);
      return Array.isArray(data) ? (data as MemberPerson[]) : [];
    },
    async finish(personId, fields) {
      const stamp = new Date().toISOString();
      const { error } = await db
        .from("member_people")
        .update({ ...fields, welcome_updated_at: stamp, updated_at: stamp })
        .eq("id", personId);
      fail("welcome_finish", error);
    },
    async person(id) {
      const { data, error } = await db.from("member_people").select("*").eq("id", id).maybeSingle();
      fail("person_read", error);
      return (data as MemberPerson) ?? null;
    },
    async hasAccess(email) {
      const { data, error } = await db.rpc("member_email_entitlements", { p_email: email });
      fail("access_read", error);
      return memberKeys(data).length > 0;
    },
    isLongboardEmail: (email) => isLongboardEmail(db, email),
    async insertToken(row) {
      const { error } = await db.from("member_welcome_tokens").insert(row);
      fail("token_insert", error);
    },
    async tokenByHash(hash) {
      const { data, error } = await db.from("member_welcome_tokens").select("*").eq("token_hash", hash).maybeSingle();
      fail("token_read", error);
      return (data as WelcomeToken) ?? null;
    },
    async countTokens(by, purpose, since) {
      let query = db.from("member_welcome_tokens").select("id").eq("purpose", purpose).gt("created_at", since.toISOString());
      query = "personId" in by ? query.eq("person_id", by.personId) : query.eq("checkout_session_id", by.sessionId);
      const { data, error } = await query;
      fail("token_count", error);
      return (data ?? []).length;
    },
    async checkoutPurchase(sessionId) {
      const { data, error } = await db
        .from("member_purchases")
        .select("person_id,created_at")
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();
      fail("purchase_read", error);
      return (data as { person_id: string; created_at: string }) ?? null;
    },
    async checkoutSessionUsed(sessionId) {
      const { data, error } = await db
        .from("member_welcome_tokens")
        .select("id")
        .eq("checkout_session_id", sessionId)
        .gt("consumed_at", "1970-01-01T00:00:00Z") // = used (not null); the test fixture has no not.is
        .limit(1);
      fail("token_read", error);
      return (data ?? []).length > 0;
    },
    async redeem(tokenHash, sessionHash, expiresAt) {
      const { data, error } = await db.rpc("member_redeem_welcome_token", {
        p_token_hash: tokenHash,
        p_session_hash: sessionHash,
        p_expires_at: expiresAt.toISOString(),
      });
      fail("token_redeem", error);
      return data as RedeemResult;
    },
  };
}
