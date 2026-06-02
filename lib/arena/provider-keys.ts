import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ARENA_PROVIDERS, getProviderDef, type ArenaProviderKey } from "./providers";

export type ProviderKeysView = {
  providerKey: ArenaProviderKey;
  displayName: string;
  apiKeySet: boolean;
  baseUrl: string | null;
  envFallback: string | null;
  updatedAt: string | null;
};

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("arena_provider_keys_misconfigured");
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

function readEnvFallback(envName: string | null): boolean {
  if (!envName) return false;
  const v = process.env[envName];
  return typeof v === "string" && v.trim().length > 0;
}

/** Client-safe view — never returns secret values. */
export async function listArenaProviderKeys(): Promise<ProviderKeysView[]> {
  const admin = adminClient();
  const { data: secretRows } = await admin.from("arena_provider_secrets").select("*");
  const { data: settingRows } = await admin.from("arena_provider_settings").select("*");

  const secrets = new Map(
    (secretRows ?? []).map((r) => [r.provider_key as string, r]),
  );
  const settings = new Map(
    (settingRows ?? []).map((r) => [r.provider_key as string, r]),
  );

  return ARENA_PROVIDERS.map((p) => {
    const sec = secrets.get(p.key);
    const set = settings.get(p.key);
    const vaultSet = !!sec?.vault_secret_id;
    const envSet = readEnvFallback(p.envFallback);
    return {
      providerKey: p.key,
      displayName: p.displayName,
      apiKeySet: vaultSet || envSet,
      baseUrl: (set?.base_url as string | null) ?? null,
      envFallback: p.envFallback,
      updatedAt: (sec?.updated_at as string | null) ?? (set?.updated_at as string | null) ?? null,
    };
  });
}

/** Server-only — vault first, then env fallback. */
export async function getArenaProviderApiKey(providerKey: string): Promise<string | null> {
  const def = getProviderDef(providerKey);
  if (!def) return null;

  try {
    const admin = adminClient();
    const { data: row } = await admin
      .from("arena_provider_secrets")
      .select("vault_secret_id")
      .eq("provider_key", providerKey)
      .eq("key_label", "api_key")
      .maybeSingle();

    if (row?.vault_secret_id) {
      const v = await vaultRead(admin, row.vault_secret_id);
      if (v) return v;
    }
  } catch {
    // fall through to env
  }

  if (def.envFallback) {
    const v = process.env[def.envFallback];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export async function saveArenaProviderApiKey(
  providerKey: ArenaProviderKey,
  apiKey: string,
  userId: string,
): Promise<void> {
  if (!apiKey.trim()) throw new Error("empty_api_key");
  const admin = adminClient();

  const { data: existing } = await admin
    .from("arena_provider_secrets")
    .select("vault_secret_id")
    .eq("provider_key", providerKey)
    .eq("key_label", "api_key")
    .maybeSingle();

  const now = new Date().toISOString();
  const vaultName = `arena_provider_${providerKey}_api_key`;

  if (existing?.vault_secret_id) {
    await vaultUpdate(admin, existing.vault_secret_id, apiKey.trim());
    await admin
      .from("arena_provider_secrets")
      .update({ updated_at: now, updated_by: userId })
      .eq("provider_key", providerKey)
      .eq("key_label", "api_key");
  } else {
    const vaultId = await vaultCreate(admin, apiKey.trim(), vaultName);
    await admin.from("arena_provider_secrets").upsert(
      {
        provider_key: providerKey,
        key_label: "api_key",
        vault_secret_id: vaultId,
        updated_at: now,
        updated_by: userId,
      },
      { onConflict: "provider_key,key_label" },
    );
  }
}

export async function clearArenaProviderApiKey(
  providerKey: ArenaProviderKey,
  userId: string,
): Promise<void> {
  const admin = adminClient();
  const { data: existing } = await admin
    .from("arena_provider_secrets")
    .select("vault_secret_id")
    .eq("provider_key", providerKey)
    .eq("key_label", "api_key")
    .maybeSingle();

  if (existing?.vault_secret_id) {
    await vaultDelete(admin, existing.vault_secret_id);
    await admin
      .from("arena_provider_secrets")
      .delete()
      .eq("provider_key", providerKey)
      .eq("key_label", "api_key");
  }

  await admin.from("arena_provider_settings").upsert(
    {
      provider_key: providerKey,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "provider_key" },
  );
}

export async function saveArenaProviderBaseUrl(
  providerKey: ArenaProviderKey,
  baseUrl: string | null,
  userId: string,
): Promise<void> {
  const admin = adminClient();
  await admin.from("arena_provider_settings").upsert(
    {
      provider_key: providerKey,
      base_url: baseUrl?.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "provider_key" },
  );
}

export async function getArenaProviderBaseUrl(providerKey: string): Promise<string | null> {
  try {
    const admin = adminClient();
    const { data } = await admin
      .from("arena_provider_settings")
      .select("base_url")
      .eq("provider_key", providerKey)
      .maybeSingle();
    return (data?.base_url as string | null) ?? null;
  } catch {
    return null;
  }
}
