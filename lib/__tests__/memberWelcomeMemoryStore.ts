import { randomUUID } from "node:crypto";
import type { MemberPerson } from "@/lib/members/types";
import type { RedeemResult, WelcomeStore, WelcomeToken } from "@/lib/members/welcome";
import type { memoryMemberStore } from "./memberMemoryStore";

/**
 * #390 tests: the welcome tables in memory, over a memoryMemberStore's people, with the rules of
 * supabase/migrations/20261109130000_member_welcome.sql (claims, one retry, single-use tokens,
 * one sign-in per checkout session) and member_open_chat_session.
 */
export function memoryWelcomeStore(mem: ReturnType<typeof memoryMemberStore>, opts: { now?: () => Date; longboardEmails?: string[] } = {}) {
  const now = () => opts.now?.() ?? new Date();
  const tokens: WelcomeToken[] = [];
  const sessions: { hash: string; account: string }[] = [];
  const longboard = new Set(opts.longboardEmails ?? []);
  const members = new Set<string>();
  const row = (id: string) => mem.people.find((p) => p.id === id);
  const claimRow = (p: MemberPerson) => {
    Object.assign(p, { welcome_status: "pending", welcome_attempts: (p.welcome_attempts ?? 0) + 1, welcome_error: null, welcome_updated_at: now().toISOString() });
    return { ...p };
  };
  const ago = (p: MemberPerson) => now().getTime() - Date.parse(p.welcome_updated_at ?? "1970-01-01");
  const store: WelcomeStore = {
    async claim(id, mode) {
      const p = row(id);
      if (!p || (mode === "first" && p.welcome_status)) return null;
      return claimRow(p);
    },
    async claimRetries(limit) {
      return mem.people
        .filter(
          (p) =>
            (p.welcome_attempts ?? 0) < 2 &&
            !p.chat_account_id &&
            ((p.welcome_status === "failed" && ago(p) > 120_000) || (p.welcome_status === "pending" && ago(p) > 600_000)),
        )
        .slice(0, limit)
        .map(claimRow);
    },
    async finish(id, fields) {
      Object.assign(row(id)!, fields, { welcome_updated_at: now().toISOString() });
    },
    async person(id) {
      const p = row(id);
      return p ? { ...p } : null;
    },
    async hasAccess(email) {
      return mem.activeKeys(email, now()).length > 0;
    },
    async isLongboardEmail(email) {
      return longboard.has(email);
    },
    async insertToken(t) {
      if (tokens.some((x) => x.token_hash === t.token_hash)) throw new Error("duplicate token");
      tokens.push({ ...t, id: randomUUID(), created_at: now().toISOString(), consumed_at: null });
    },
    async tokenByHash(hash) {
      const t = tokens.find((x) => x.token_hash === hash);
      return t ? { ...t } : null;
    },
    async countTokens(by, purpose, since) {
      return tokens.filter(
        (t) => t.purpose === purpose && Date.parse(t.created_at) > since.getTime() && ("personId" in by ? t.person_id === by.personId : t.checkout_session_id === by.sessionId),
      ).length;
    },
    async checkoutPurchase(sessionId) {
      const p = mem.purchases.find((x) => x.stripe_checkout_session_id === sessionId);
      return p ? { person_id: p.person_id, created_at: p.created_at } : null;
    },
    async checkoutSessionUsed(sessionId) {
      return tokens.some((t) => t.checkout_session_id === sessionId && t.consumed_at);
    },
    async redeem(tokenHash, sessionHash): Promise<RedeemResult> {
      const t = tokens.find((x) => x.token_hash === tokenHash);
      if (!t) return { status: "invalid" };
      if (t.consumed_at) return { status: "used" };
      if (Date.parse(t.expires_at) <= now().getTime()) return { status: "expired" };
      if (t.checkout_session_id && tokens.some((x) => x.checkout_session_id === t.checkout_session_id && x.consumed_at)) return { status: "session_used" };
      const p = row(t.person_id);
      if (!p || p.email !== t.email) return { status: "invalid" };
      if (longboard.has(p.email)) return { status: "longboard_account" };
      if (!mem.activeKeys(p.email, now()).length) return { status: "no_access" };
      p.chat_account_id ??= randomUUID();
      sessions.push({ hash: sessionHash, account: p.chat_account_id });
      t.consumed_at = now().toISOString();
      return { status: "ok", account: p.chat_account_id, member: members.has(p.chat_account_id), name: p.name };
    },
  };
  return { store, tokens, sessions, members, longboard };
}
