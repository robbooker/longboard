import { createHash } from "node:crypto";

/**
 * #489: a short in-memory cache of "who is asking" answers, per function instance.
 *
 * Every chat request (and every batch of reads in POST /api/chat/updates, about one a second per
 * open window) used to ask the database again who the member is. A signed-in answer is now kept
 * for 30 seconds, keyed by a SHA-256 hash of the sign-in (never the raw token or session id, and
 * neither is logged), so one session's answer can never be served to another.
 *
 * What is kept: only successful answers. A denial, a missing profile, a signed-out session or a
 * failed read is never stored, so someone who has just signed in (or whose database read failed)
 * is asked about afresh on the next request.
 *
 * How it is cleared: the app's own sign-out, suspension, unlink, rename, picture and
 * entitlement routes clear the affected entries on the instance that handled them (see
 * forgetChatSession, forgetChatUser, forgetChatMember, forgetAllChatSessions). Other instances,
 * and changes made outside this app's code (a ban in the Supabase dashboard, a Stripe refund
 * webhook, the ShortScout sync, a role change in SQL), are bounded by the TTL: at most
 * CHAT_SESSION_CACHE_TTL_MS of stale access.
 */
export const CHAT_SESSION_CACHE_TTL_MS = 30_000;
export const CHAT_SESSION_CACHE_MAX = 5000;
/**
 * CHAT_SESSION_CACHE=off turns the cache off (every request asks the database, as before #489).
 * The unit tests run with it off (vitest.setup.ts) except where they test the cache itself.
 */
export const chatSessionCacheEnabled = () => process.env.CHAT_SESSION_CACHE !== "off";

/** A cache key from its parts: a SHA-256 hex digest, so no secret is ever held as a key. */
export function chatSessionCacheKey(...parts: string[]) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

/** The hashed key of a Longboard sign-in (user and session) or a chat sign-in (its token hash). */
export const longboardSessionKey = (userId: string, sessionId: string) =>
  chatSessionCacheKey("lb", userId, sessionId);
export const chatSignInSessionKey = (tokenHash: string) => chatSessionCacheKey("ss", tokenHash);

type Entry<T> = { value: T; expires: number; tags: string[] };

export type SessionCache<T> = ReturnType<typeof createSessionCache<T>>;

export function createSessionCache<T>({
  ttlMs = CHAT_SESSION_CACHE_TTL_MS,
  maxEntries = CHAT_SESSION_CACHE_MAX,
  now = () => Date.now(),
  enabled = chatSessionCacheEnabled,
}: { ttlMs?: number; maxEntries?: number; now?: () => number; enabled?: () => boolean } = {}) {
  const entries = new Map<string, Entry<T>>();
  /** Bumped on every invalidation, so a read that started before one is never stored after it. */
  let epoch = 0;
  const sweep = (at: number) => {
    for (const [key, entry] of entries) if (entry.expires <= at) entries.delete(key);
  };
  return {
    /** A copy of the stored answer, so one request can't change what the next one sees. */
    get(key: string): T | undefined {
      if (!enabled()) return undefined;
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) {
        entries.delete(key);
        return undefined;
      }
      return structuredClone(entry.value);
    },
    /** The current epoch, taken before a read starts and handed back to set. */
    epoch: () => epoch,
    set(key: string, value: T, tags: string[], startedAt: number) {
      if (startedAt !== epoch || !enabled()) return;
      const at = now();
      entries.delete(key);
      if (entries.size >= maxEntries) sweep(at);
      // Still full of live entries: drop the oldest (a Map keeps insertion order).
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      entries.set(key, { value: structuredClone(value), expires: at + ttlMs, tags });
    },
    delete(key: string) {
      epoch++;
      entries.delete(key);
    },
    invalidateTag(tag: string) {
      epoch++;
      for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key);
    },
    clear() {
      epoch++;
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

type Forget = {
  session: (tokenHash: string) => void;
  tag: (tag: string) => void;
  all: () => void;
};
const listeners = new Set<Forget>();
/** Caches register here so the routes that change who someone is can clear them. */
export function onChatSessionForget(listener: Forget) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tags: a Longboard user or chat account id, and a chat member id. */
export const userTag = (id: string) => `user:${id.toLowerCase()}`;
export const memberTag = (id: string) => `member:${id.toLowerCase()}`;
/** Everything kept for one sign-in (its sessionKey). */
export const sessionTag = (sessionKey: string) => `session:${sessionKey}`;

/** A chat sign-in session ended (sign-out). tokenHash is chatSecretHash(token). */
export function forgetChatSession(tokenHash: string) {
  for (const l of listeners) l.session(tokenHash);
}
/** Someone's access or profile changed: suspension, unlink, rename, picture, DM settings. */
export function forgetChatUser(id: string) {
  for (const l of listeners) l.tag(userTag(id));
}
/** A member's profile changed by someone else (an admin removed their picture). */
export function forgetChatMember(memberId: string) {
  for (const l of listeners) l.tag(memberTag(memberId));
}
/** A change that can't be traced to one account (an entitlement granted or revoked by email). */
export function forgetAllChatSessions() {
  for (const l of listeners) l.all();
}
