import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memberKeys } from "@/lib/memberAccess";

/**
 * #384: the Booker Stock Club sign-up. The buyer proves the purchase email with a six-digit code
 * we email them (no passwords anywhere), and gets a chat sign-in session like the ShortScout
 * sign-in's (the lb-chat-session cookie). Codes: 10 minutes, 5 tries each, 5 per email an hour;
 * only a hash is stored.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODES_PER_HOUR = 5;
export const CHECKOUT_SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export function newJoinCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
export function joinCodeHash(id: string, code: string) {
  return createHash("sha256").update(`${id}:${code}`).digest("hex");
}
export function joinCodeMatches(id: string, code: unknown, hash: string) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return false;
  const a = Buffer.from(joinCodeHash(id, code.trim()), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type JoinStatus =
  | { status: "ready"; email?: string }
  | { status: "pending" }
  | { status: "inactive" }
  | { status: "longboard_account" };

/** Whether this email (or checkout session) has club access yet. */
export async function joinStatus(db: SupabaseClient, by: { email?: string; sessionId?: string }): Promise<JoinStatus> {
  let email = by.email ?? null;
  if (by.sessionId) {
    const { data, error } = await db
      .from("member_purchases")
      .select("person_id")
      .eq("stripe_checkout_session_id", by.sessionId)
      .maybeSingle();
    if (error) throw new Error("status_unavailable");
    if (!data) return { status: "pending" };
    const person = await db.from("member_people").select("email").eq("id", data.person_id).maybeSingle();
    if (person.error || !person.data) throw new Error("status_unavailable");
    email = person.data.email as string;
  }
  if (!email) return { status: "pending" };
  const { data, error } = await db.rpc("member_email_entitlements", { p_email: email });
  if (error) throw new Error("status_unavailable");
  if (!memberKeys(data).length) return { status: by.sessionId ? "inactive" : "pending" };
  if (await isLongboardEmail(db, email)) return { status: "longboard_account" };
  // The email comes back only to the holder of the checkout session id, to fill in the form.
  return by.sessionId ? { status: "ready", email } : { status: "ready" };
}

export async function isLongboardEmail(db: SupabaseClient, email: string) {
  const { data, error } = await db.from("profiles").select("id").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(1);
  if (error) throw new Error("status_unavailable");
  return (data ?? []).length > 0;
}

/** Make a code row; returns the code to email, or a reason it can't be sent now. */
export async function createJoinCode(db: SupabaseClient, email: string, now = new Date()): Promise<{ ok: true; code: string } | { ok: false; error: "too_many_codes" | "unavailable" }> {
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const recent = await db.from("member_login_codes").select("id").eq("email", email).gt("created_at", since);
  if (recent.error) return { ok: false, error: "unavailable" };
  if ((recent.data ?? []).length >= CODES_PER_HOUR) return { ok: false, error: "too_many_codes" };
  const id = randomUUID();
  const code = newJoinCode();
  const { error } = await db.from("member_login_codes").insert({
    id,
    email,
    code_hash: joinCodeHash(id, code),
    expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
  });
  return error ? { ok: false, error: "unavailable" } : { ok: true, code };
}

/** Check a code against the newest live one for this email. Each try counts; a match is used up. */
export async function redeemJoinCode(db: SupabaseClient, email: string, code: unknown, now = new Date()): Promise<"ok" | "wrong_code" | "code_expired" | "too_many_attempts" | "unavailable"> {
  const { data, error } = await db
    .from("member_login_codes")
    .select("id,code_hash,attempts,expires_at")
    .eq("email", email)
    .is("consumed_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return "unavailable";
  const row = (data ?? [])[0] as { id: string; code_hash: string; attempts: number } | undefined;
  if (!row) return "code_expired";
  if (row.attempts >= CODE_MAX_ATTEMPTS) return "too_many_attempts";
  const counted = await db
    .from("member_login_codes")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .is("consumed_at", null)
    .select("id");
  if (counted.error) return "unavailable";
  if (!(counted.data ?? []).length) return "wrong_code"; // a parallel try got there first
  if (!joinCodeMatches(row.id, code, row.code_hash)) return row.attempts + 1 >= CODE_MAX_ATTEMPTS ? "too_many_attempts" : "wrong_code";
  const used = await db
    .from("member_login_codes")
    .update({ consumed_at: now.toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (used.error) return "unavailable";
  return (used.data ?? []).length ? "ok" : "code_expired";
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The code email, through Resend (RESEND_API_KEY; from MEMBERS_FROM_EMAIL). */
export async function sendJoinCodeEmail(email: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MEMBERS_FROM_EMAIL;
  if (!apiKey || !from) return false;
  const text = `Your Booker Stock Club sign-in code is ${code}\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${code} is your Booker Stock Club code`,
      text,
      html: `<div style="font-family:Georgia,serif;line-height:1.5;color:#17211f">
<p style="margin:0 0 12px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#a8342e">Booker Stock Club</p>
<p style="margin:0 0 8px;font-size:16px">Your sign-in code:</p>
<p style="margin:0 0 18px;font-size:32px;font-weight:700;letter-spacing:6px">${escapeHtml(code)}</p>
<p style="margin:0;font-size:14px;color:#53605a">It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
      tags: [{ name: "kind", value: "club-sign-in" }],
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  return !!response?.ok;
}
