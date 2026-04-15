-- Phase 3F Commit 1 — observability for kill-switch flips + order submissions.
-- Two append-only audit tables. No RLS policies — service-role writes from
-- API routes only. Reads go through /api/admin/audit (admin-gated).
-- No retention policy yet; old rows accumulate indefinitely. Revisit when
-- either table crosses ~100k rows.

-- ── kill-switch flip history ─────────────────────────────────────────
-- One row per flip of app_settings. The `field` column is forward-looking:
-- only order_submission_enabled flips today, but leaving field-agnostic
-- means future app_settings toggles use the same table without migration.
create table if not exists app_settings_history (
  id bigserial primary key,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users,
  changed_by_email text,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  -- 'ui' for Danger Zone toggle, 'env_override' for DISABLE_ORDER_SUBMISSION
  -- flips, 'cron' / 'api' reserved for future automation.
  source text not null
);

create index if not exists app_settings_history_changed_at_idx
  on app_settings_history (changed_at desc);

alter table app_settings_history enable row level security;

-- ── order submission audit ───────────────────────────────────────────
-- One row per POST to a broker order route. Captures the request + response
-- shape + timing so post-hoc analysis of "what did we actually send to the
-- broker and what did they say back" is possible without reading Vercel
-- function logs line by line.
create table if not exists order_audit (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users,
  user_email text,
  broker text not null,
  action text not null,
  symbol text,
  side text,
  qty numeric,
  order_type text,
  request_body jsonb,
  response_status integer,
  response_body jsonb,
  error_message text,
  duration_ms integer
);

create index if not exists order_audit_created_at_idx
  on order_audit (created_at desc);

create index if not exists order_audit_user_idx
  on order_audit (user_id, created_at desc);

alter table order_audit enable row level security;
