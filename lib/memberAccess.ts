import { createChatAdminClient } from "@/lib/chatAdmin";
import type { ChatEntitlements } from "@/lib/chatAccess";

/**
 * #384: the one access check for things people buy (Booker Stock Club and later products).
 *
 * The stable API for other features (#385 Reader, #386 Club room, #387 News):
 *
 *   accessHasEntitlement(auth.access, "reader")      // no database call: requireChatUser already
 *                                                    // loaded the keys with the sign-in
 *   await hasEntitlement(auth.user.id, "club-room")  // reads the database (or pass an email)
 *   await memberEntitlements(auth.user.id)           // Set of active keys
 *
 * `userId` is the chat account id, i.e. `auth.user.id` from requireChatUser (a Longboard member's
 * profile id, or a club member's chat account id). A Longboard member who bought with their
 * Longboard email gets the keys through that email; nobody has to link anything.
 *
 * Active = not revoked, starts_at passed, ends_at not reached. All of it is decided in the database
 * (member_account_entitlements), so the room rules there and this code always agree.
 */

/** Entitlement keys in use. A product unlocks some of them (member_product_entitlements). */
export const ENTITLEMENTS = {
  gainers: "gainers",
  reader: "reader",
  clubRoom: "club-room",
} as const;
export type EntitlementKey = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS] | (string & {});

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isEntitlementKey(value: unknown): value is string {
  return typeof value === "string" && KEY_RE.test(value);
}

/** Emails are compared trimmed and lower-cased everywhere (member_people.email is stored so). */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && EMAIL_RE.test(email) ? email : null;
}

/** The keys a request context returned ('member'), or [] for anything else. */
export function memberKeys(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(isEntitlementKey))].sort() : [];
}

/** Synchronous check on a signed-in request's access. Bots never have entitlements. */
export function accessHasEntitlement(access: Pick<ChatEntitlements, "member" | "botRooms"> | null | undefined, key: string) {
  return !!access && !access.botRooms && Array.isArray(access.member) && access.member.includes(key);
}

/** Active entitlement keys of a chat account (or of an email). Empty on any failure. */
export async function memberEntitlements(userIdOrEmail: string): Promise<Set<string>> {
  const db = createChatAdminClient();
  if (!db || typeof userIdOrEmail !== "string") return new Set();
  const email = userIdOrEmail.includes("@") ? normalizeEmail(userIdOrEmail) : null;
  if (!email && !UUID_RE.test(userIdOrEmail)) return new Set();
  const { data, error } = email
    ? await db.rpc("member_email_entitlements", { p_email: email })
    : await db.rpc("member_account_entitlements", { p_account: userIdOrEmail });
  if (error) return new Set();
  return new Set(memberKeys(data));
}

export async function hasEntitlement(userIdOrEmail: string, key: EntitlementKey): Promise<boolean> {
  return (await memberEntitlements(userIdOrEmail)).has(key);
}
