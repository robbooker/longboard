-- Phase 2A Step 5 — RPC wrappers around Supabase Vault
-- Supabase Vault lives in the `vault` schema, which PostgREST does not
-- expose by default. That means the supabase-js client can't invoke
-- `vault.create_secret()` / `vault.update_secret()` / etc. via `.rpc()` —
-- the schema cache doesn't see them. These thin `security definer`
-- wrappers in the `public` schema bridge the gap so our service-role
-- API routes can read/write vault secrets without a direct pg connection.
--
-- These are additive helpers, not table schema changes. Access is
-- revoked from anon + authenticated and granted only to service_role —
-- authenticated-session routes must go through lib/brokerKeys.ts which
-- uses the service-role client.

create or replace function public.app_vault_create_secret(
  p_value text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  v_id := vault.create_secret(p_value, p_name);
  return v_id;
end;
$$;

create or replace function public.app_vault_update_secret(
  p_id uuid,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform vault.update_secret(p_id, p_value);
end;
$$;

create or replace function public.app_vault_read_secret(
  p_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = p_id;
  return v_secret;
end;
$$;

create or replace function public.app_vault_delete_secret(
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from vault.secrets where id = p_id;
end;
$$;

-- Gate execution. Only service_role should invoke these; the authenticated
-- and anon roles must never reach the vault from their own context.
revoke all on function public.app_vault_create_secret(text, text) from public, anon, authenticated;
revoke all on function public.app_vault_update_secret(uuid, text)  from public, anon, authenticated;
revoke all on function public.app_vault_read_secret(uuid)          from public, anon, authenticated;
revoke all on function public.app_vault_delete_secret(uuid)        from public, anon, authenticated;

grant execute on function public.app_vault_create_secret(text, text) to service_role;
grant execute on function public.app_vault_update_secret(uuid, text)  to service_role;
grant execute on function public.app_vault_read_secret(uuid)          to service_role;
grant execute on function public.app_vault_delete_secret(uuid)        to service_role;
