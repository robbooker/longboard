import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type Broker = "alpaca" | "tradezero";
export const BROKERS: readonly Broker[] = ["alpaca", "tradezero"] as const;

/** Which key_label values are true secrets (never returned to the client)
 *  vs routing/identification values that are stored in the vault for uniform
 *  encryption but can be decrypted and shown in the UI. */
const SECRET_LABELS: Record<Broker, readonly string[]> = {
  alpaca: ["api_key", "api_secret"],
  tradezero: ["proxy_api_key"],
};

/** Whitelist of accepted key_label values per broker. The POST handler
 *  rejects anything not in this list. */
export const ALLOWED_LABELS: Record<Broker, readonly string[]> = {
  alpaca: ["api_key", "api_secret", "base_url"],
  tradezero: ["proxy_url", "proxy_api_key", "account_id"],
};

function isSecret(broker: Broker, label: string): boolean {
  return SECRET_LABELS[broker].includes(label);
}

export type AlpacaKeysView = {
  configured: boolean;
  api_key_set: boolean;
  api_secret_set: boolean;
  base_url: string | null;
  updated_at: string | null;
};

export type TradeZeroKeysView = {
  configured: boolean;
  proxy_url: string | null;
  proxy_api_key_set: boolean;
  account_id: string | null;
  updated_at: string | null;
};

export type BrokerKeysGetResult = {
  alpaca: AlpacaKeysView;
  tradezero: TradeZeroKeysView;
};

type KeyRow = {
  user_id: string;
  broker: Broker;
  vault_secret_id: string;
  key_label: string;
  created_at: string;
  updated_at: string;
};

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("broker_keys_server_misconfigured: missing Supabase URL or service-role key");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function vaultRead(admin: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await admin.rpc("app_vault_read_secret", { p_id: id });
  if (error) throw new Error(`vault_read_failed: ${error.message}`);
  return typeof data === "string" ? data : null;
}

async function vaultCreate(admin: SupabaseClient, value: string, name: string): Promise<string> {
  const { data, error } = await admin.rpc("app_vault_create_secret", { p_value: value, p_name: name });
  if (error) throw new Error(`vault_create_failed: ${error.message}`);
  if (typeof data !== "string") throw new Error("vault_create_no_id");
  return data;
}

async function vaultUpdate(admin: SupabaseClient, id: string, value: string): Promise<void> {
  const { error } = await admin.rpc("app_vault_update_secret", { p_id: id, p_value: value });
  if (error) throw new Error(`vault_update_failed: ${error.message}`);
}

async function vaultDelete(admin: SupabaseClient, id: string): Promise<void> {
  const { error } = await admin.rpc("app_vault_delete_secret", { p_id: id });
  if (error) throw new Error(`vault_delete_failed: ${error.message}`);
}

/** Build the client-safe view of a user's broker keys. Secrets are returned
 *  only as booleans (<label>_set); non-secret routing values (base_url,
 *  proxy_url, account_id) are decrypted and returned in plaintext. */
export async function getUserBrokerKeys(userId: string): Promise<BrokerKeysGetResult> {
  const admin = adminClient();
  const { data: rows, error } = await admin
    .from("user_broker_keys")
    .select("user_id, broker, vault_secret_id, key_label, created_at, updated_at")
    .eq("user_id", userId);
  if (error) throw new Error(`broker_keys_fetch_failed: ${error.message}`);

  const byKey = new Map<string, KeyRow>();
  for (const r of (rows ?? []) as KeyRow[]) {
    byKey.set(`${r.broker}:${r.key_label}`, r);
  }

  // Pre-decrypt every non-secret we found.
  const decrypted = new Map<string, string>();
  const entries = Array.from(byKey.entries());
  for (const [key, row] of entries) {
    if (!isSecret(row.broker, row.key_label)) {
      const value = await vaultRead(admin, row.vault_secret_id);
      if (value !== null) decrypted.set(key, value);
    }
  }

  function latestUpdated(broker: Broker): string | null {
    let latest: string | null = null;
    for (const r of Array.from(byKey.values())) {
      if (r.broker === broker && (!latest || r.updated_at > latest)) latest = r.updated_at;
    }
    return latest;
  }

  const alpacaKeySet = byKey.has("alpaca:api_key");
  const alpacaSecretSet = byKey.has("alpaca:api_secret");

  const tzProxyApiKeySet = byKey.has("tradezero:proxy_api_key");
  const tzProxyUrl = decrypted.get("tradezero:proxy_url") ?? null;
  const tzAccountId = decrypted.get("tradezero:account_id") ?? null;

  return {
    alpaca: {
      configured: alpacaKeySet && alpacaSecretSet,
      api_key_set: alpacaKeySet,
      api_secret_set: alpacaSecretSet,
      base_url: decrypted.get("alpaca:base_url") ?? null,
      updated_at: latestUpdated("alpaca"),
    },
    tradezero: {
      configured: !!(tzProxyUrl && tzProxyApiKeySet && tzAccountId),
      proxy_url: tzProxyUrl,
      proxy_api_key_set: tzProxyApiKeySet,
      account_id: tzAccountId,
      updated_at: latestUpdated("tradezero"),
    },
  };
}

/** Create or update a single (user, broker, label) secret. Empty strings are
 *  rejected — use deleteUserBrokerKey() to remove a value. */
export async function setUserBrokerKey(userId: string, broker: Broker, label: string, value: string): Promise<void> {
  if (!value) throw new Error("empty_value");
  if (!ALLOWED_LABELS[broker].includes(label)) throw new Error(`invalid_label: ${label}`);

  const admin = adminClient();
  const { data: existing, error: selErr } = await admin
    .from("user_broker_keys")
    .select("vault_secret_id")
    .eq("user_id", userId)
    .eq("broker", broker)
    .eq("key_label", label)
    .maybeSingle();
  if (selErr) throw new Error(`lookup_failed: ${selErr.message}`);

  if (existing?.vault_secret_id) {
    await vaultUpdate(admin, existing.vault_secret_id, value);
    const { error: upErr } = await admin
      .from("user_broker_keys")
      .update({ updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("broker", broker)
      .eq("key_label", label);
    if (upErr) throw new Error(`table_update_failed: ${upErr.message}`);
    return;
  }

  const secretName = `${userId}_${broker}_${label}`;
  const newId = await vaultCreate(admin, value, secretName);
  const { error: insErr } = await admin.from("user_broker_keys").insert({
    user_id: userId,
    broker,
    vault_secret_id: newId,
    key_label: label,
  });
  if (insErr) {
    // Best-effort cleanup so we don't leak an orphan vault row.
    try { await vaultDelete(admin, newId); } catch {}
    throw new Error(`table_insert_failed: ${insErr.message}`);
  }
}

/** Delete a single key (when label is provided) or all keys for a broker
 *  (when omitted). Vault secret goes first, then the table row. */
export async function deleteUserBrokerKey(userId: string, broker: Broker, label?: string): Promise<void> {
  const admin = adminClient();

  const selBase = admin
    .from("user_broker_keys")
    .select("vault_secret_id, key_label")
    .eq("user_id", userId)
    .eq("broker", broker);
  const { data: rows, error } = label ? await selBase.eq("key_label", label) : await selBase;
  if (error) throw new Error(`delete_lookup_failed: ${error.message}`);
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    await vaultDelete(admin, row.vault_secret_id);
  }

  const delBase = admin
    .from("user_broker_keys")
    .delete()
    .eq("user_id", userId)
    .eq("broker", broker);
  const { error: delErr } = label ? await delBase.eq("key_label", label) : await delBase;
  if (delErr) throw new Error(`table_delete_failed: ${delErr.message}`);
}

/** Server-side decryption entry point for Step 6's broker API routes.
 *  Returns null if the user hasn't stored that key. */
export async function readUserBrokerSecret(userId: string, broker: Broker, label: string): Promise<string | null> {
  const admin = adminClient();
  const { data: row, error } = await admin
    .from("user_broker_keys")
    .select("vault_secret_id")
    .eq("user_id", userId)
    .eq("broker", broker)
    .eq("key_label", label)
    .maybeSingle();
  if (error) throw new Error(`read_lookup_failed: ${error.message}`);
  if (!row?.vault_secret_id) return null;
  return vaultRead(admin, row.vault_secret_id);
}
