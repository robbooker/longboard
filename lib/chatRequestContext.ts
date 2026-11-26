import type { createChatAdminClient } from "./chatAdmin";
import { memberKeys } from "./memberAccess";
import {
  chatSignInSessionKey,
  createSessionCache,
  longboardSessionKey,
  onChatSessionForget,
  userTag,
  type SessionCache,
} from "./chatSessionCache";
import { isPaidShortScoutLevel } from "./shortscoutPolicy";

type Admin = NonNullable<ReturnType<typeof createChatAdminClient>>;
type Identity = { subject: string; membership_level: string; bridged?: boolean; source_account_id?: string };
export type ShortScoutRenewal = {
  identity: Identity | null;
  bridged: boolean;
  unavailable?: boolean;
  invalid?: boolean;
};
type CopyRead = { mode?: string; decision?: string; level?: string; binding?: Partial<Identity> & { subject: string } };

export type LongboardContext =
  | { mode: "ok"; user: { id: string; email: string; role: "user" | "admin" }; boardroom: boolean; shortscout: ShortScoutRenewal; member?: string[] }
  | { mode: "unauthenticated" | "no_profile" }
  | { mode: "unavailable" };
export type SessionContext =
  | {
      mode: "ok";
      account: string;
      longboard: boolean;
      role: string | null;
      boardroom: boolean;
      shortscout: ShortScoutRenewal;
      /** #384: active entitlement keys (member_account_entitlements). */
      member?: string[];
    }
  | { mode: "unauthenticated" }
  | { mode: "unavailable" };

/**
 * The local ShortScout copy's answer (A6). Sign-in and the nightly sync (or an owner's Sync now)
 * are the only things that ask ShortScout; chat requests never do.
 */
export function shortScoutFromCopy(value: CopyRead | null | undefined): ShortScoutRenewal {
  if (!value) return { identity: null, bridged: false, unavailable: true };
  const bridged = value.binding?.bridged === true;
  if (value.mode === "absent") return { identity: null, bridged: false };
  if (value.mode === "invalid") return { identity: null, bridged: false, invalid: true };
  if (value.mode === "ready")
    return {
      identity: value.decision === "allow" && value.binding ? { ...value.binding, membership_level: value.level! } : null,
      bridged,
    };
  // "unavailable": no current answer in the copy (sync overdue). SS access waits for it.
  return { identity: null, bridged, unavailable: true };
}

export { chatSignInSessionKey, longboardSessionKey };

type CachedContext = Extract<LongboardContext, { mode: "ok" }> | Extract<SessionContext, { mode: "ok" }>;

/**
 * #489: whether requireChatUser lets this answer in. Only those are cached: an invalid or
 * overdue ShortScout copy, or a chat sign-in without paid access, is read again next time.
 */
export function grants(context: LongboardContext | SessionContext): context is CachedContext {
  if (context.mode !== "ok") return false;
  const renewal = context.shortscout;
  if (renewal.invalid || renewal.unavailable) return false;
  if ("user" in context) return true;
  const clubOnly = !renewal.bridged && !renewal.identity;
  if (clubOnly && memberKeys(context.member).length && !context.longboard) return true;
  return !!renewal.identity && isPaidShortScoutLevel(renewal.identity.membership_level);
}

/**
 * Who is asking, in one database call per request (P3): the Longboard profile, chat account,
 * Boardroom tag and ShortScout copy, or the same for a chat sign-in session. In-flight reads are
 * shared between requests from the same principal, and (#489) a signed-in answer is kept for
 * 30 seconds per sign-in (lib/chatSessionCache.ts). Denials and failures are never kept.
 */
export function createRequestContextReader({
  cache = createSessionCache<CachedContext>(),
}: { cache?: SessionCache<CachedContext> | false } = {}) {
  const pending = new Map<string, Promise<unknown>>();
  if (cache)
    onChatSessionForget({
      session: (tokenHash) => {
        pending.clear();
        cache.delete(chatSignInSessionKey(tokenHash));
      },
      tag: (tag) => {
        pending.clear();
        cache.invalidateTag(tag);
      },
      all: () => {
        pending.clear();
        cache.clear();
      },
    });
  /** `fresh` (#522): never answered from the kept answer; the read (or one already under way) is used. */
  function once<T extends LongboardContext | SessionContext>(key: string, run: () => Promise<T>, failed: T, fresh = false): Promise<T> {
    const hit = cache && !fresh ? (cache.get(key) as T | undefined) : undefined;
    if (hit) return Promise.resolve(hit);
    const existing = pending.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    if (pending.size >= 5000) return Promise.resolve(failed);
    const task = run()
      .then((value) => {
        // #522: a fresh read that no longer lets the person in also drops what was kept for them here.
        if (fresh && cache && !grants(value as LongboardContext | SessionContext)) cache.delete(key);
        return value;
      })
      .catch(() => failed)
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key);
      });
    pending.set(key, task);
    return task;
  }
  /**
   * Keeps only an answer that lets the person in (see grants), and only if nothing was cleared
   * while it was being read, so a refusal is always asked about again on the next request.
   */
  const keep = <T extends LongboardContext | SessionContext>(key: string, tags: string[], epoch: number, value: T): T => {
    if (cache && grants(value)) cache.set(key, value, tags, epoch);
    return value;
  };
  const call = (admin: Admin, fn: string, args: Record<string, unknown>) =>
    admin.rpc(fn, args).abortSignal(AbortSignal.timeout(5000));
  return {
    longboard(admin: Admin, userId: string, sessionId: string, fresh = false): Promise<LongboardContext> {
      const key = longboardSessionKey(userId, sessionId);
      return once<LongboardContext>(
        key,
        async () => {
          const epoch = cache ? cache.epoch() : 0;
          const { data, error } = await call(admin, "chat_longboard_request_context", {
            p_user: userId,
            p_session: sessionId,
          });
          if (error || !data) return { mode: "unavailable" };
          if (data.mode !== "ok") return { mode: data.mode === "no_profile" ? "no_profile" : "unauthenticated" };
          return keep(key, [userTag(userId), userTag(String(data.user.id))], epoch, {
            mode: "ok",
            user: { id: data.user.id, email: data.user.email, role: data.user.role === "admin" ? "admin" : "user" },
            boardroom: data.boardroom === true,
            shortscout: shortScoutFromCopy(data.shortscout),
            member: memberKeys(data.member),
          } as LongboardContext);
        },
        { mode: "unavailable" },
        fresh,
      );
    },
    session(admin: Admin, tokenHash: string, fresh = false): Promise<SessionContext> {
      const key = chatSignInSessionKey(tokenHash);
      return once<SessionContext>(
        key,
        async () => {
          const epoch = cache ? cache.epoch() : 0;
          const { data, error } = await call(admin, "chat_session_request_context", { p_token_hash: tokenHash });
          if (error || !data) return { mode: "unavailable" };
          if (data.mode !== "ok") return { mode: "unauthenticated" };
          return keep(key, [userTag(String(data.account))], epoch, {
            mode: "ok",
            account: data.account,
            longboard: data.longboard === true,
            role: data.role ?? null,
            boardroom: data.boardroom === true,
            shortscout: shortScoutFromCopy(data.shortscout),
            member: memberKeys(data.member),
          } as SessionContext);
        },
        { mode: "unavailable" },
        fresh,
      );
    },
  };
}
export const readRequestContext = createRequestContextReader();
