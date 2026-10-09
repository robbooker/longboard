import type { createChatAdminClient } from "./chatAdmin";

type Admin = NonNullable<ReturnType<typeof createChatAdminClient>>;
type Identity = { subject: string; membership_level: string; bridged?: boolean; source_account_id?: string };
export type ShortScoutRenewal = {
  identity: Identity | null;
  bridged: boolean;
  unavailable?: boolean;
  invalid?: boolean;
};

/**
 * Reads the local ShortScout copy (A6). Sign-in and the nightly sync (or an owner's Sync now)
 * are the only things that ask ShortScout; chat requests never do. Only in-flight work is
 * shared here; the copy and its expiry live in SQL.
 */
export function createShortScoutRenewer() {
  const pending = new Map<string, Promise<ShortScoutRenewal>>();
  return async function renew(
    admin: Admin,
    accountId: string,
    sessionHash: string | null = null,
  ): Promise<ShortScoutRenewal> {
    const key = `${accountId}:${sessionHash ?? "longboard"}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const run = async (): Promise<ShortScoutRenewal> => {
      const next = await admin
        .rpc("begin_chat_shortscout_renewal", { p_account: accountId, p_session_hash: sessionHash })
        .abortSignal(AbortSignal.timeout(5000));
      if (next.error || !next.data) return { identity: null, bridged: false, unavailable: true };
      const value = next.data;
      const bridged = value.binding?.bridged === true;
      if (value.mode === "absent") return { identity: null, bridged: false };
      if (value.mode === "invalid") return { identity: null, bridged: false, invalid: true };
      if (value.mode === "ready")
        return {
          identity: value.decision === "allow" ? { ...value.binding, membership_level: value.level } : null,
          bridged,
        };
      // "unavailable": no current answer in the copy (sync overdue). SS access waits for it.
      return { identity: null, bridged, unavailable: true };
    };
    if (pending.size >= 5000) return { identity: null, bridged: false, unavailable: true };
    const task = run()
      .catch(() => ({ identity: null, bridged: false, unavailable: true }) as ShortScoutRenewal)
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key);
      });
    pending.set(key, task);
    return task;
  };
}
export const renewChatShortScout = createShortScoutRenewer();
