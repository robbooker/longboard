import type { createChatAdminClient } from "./chatAdmin";

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
  | { mode: "ok"; user: { id: string; email: string; role: "user" | "admin" }; boardroom: boolean; shortscout: ShortScoutRenewal }
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

/**
 * Who is asking, in one database call per request (P3): the Longboard profile, chat account,
 * Boardroom tag and ShortScout copy, or the same for a chat sign-in session. Only in-flight
 * reads are shared, and only between requests from the same principal.
 */
export function createRequestContextReader() {
  const pending = new Map<string, Promise<unknown>>();
  function once<T>(key: string, run: () => Promise<T>, failed: T): Promise<T> {
    const existing = pending.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    if (pending.size >= 5000) return Promise.resolve(failed);
    const task = run()
      .catch(() => failed)
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key);
      });
    pending.set(key, task);
    return task;
  }
  const call = (admin: Admin, fn: string, args: Record<string, unknown>) =>
    admin.rpc(fn, args).abortSignal(AbortSignal.timeout(5000));
  return {
    longboard(admin: Admin, userId: string, sessionId: string): Promise<LongboardContext> {
      return once<LongboardContext>(
        `lb:${userId}:${sessionId}`,
        async () => {
          const { data, error } = await call(admin, "chat_longboard_request_context", {
            p_user: userId,
            p_session: sessionId,
          });
          if (error || !data) return { mode: "unavailable" };
          if (data.mode !== "ok") return { mode: data.mode === "no_profile" ? "no_profile" : "unauthenticated" };
          return {
            mode: "ok",
            user: { id: data.user.id, email: data.user.email, role: data.user.role === "admin" ? "admin" : "user" },
            boardroom: data.boardroom === true,
            shortscout: shortScoutFromCopy(data.shortscout),
          };
        },
        { mode: "unavailable" },
      );
    },
    session(admin: Admin, tokenHash: string): Promise<SessionContext> {
      return once<SessionContext>(
        `ss:${tokenHash}`,
        async () => {
          const { data, error } = await call(admin, "chat_session_request_context", { p_token_hash: tokenHash });
          if (error || !data) return { mode: "unavailable" };
          if (data.mode !== "ok") return { mode: "unauthenticated" };
          return {
            mode: "ok",
            account: data.account,
            longboard: data.longboard === true,
            role: data.role ?? null,
            boardroom: data.boardroom === true,
            shortscout: shortScoutFromCopy(data.shortscout),
          };
        },
        { mode: "unavailable" },
      );
    },
  };
}
export const readRequestContext = createRequestContextReader();
