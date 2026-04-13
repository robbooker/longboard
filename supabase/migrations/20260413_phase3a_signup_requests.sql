-- Phase 3A Step 3 — public request-access pipeline
-- Captures prospect interest from the marketing page. Rows are written by
-- the unauthenticated POST /api/signup-requests endpoint (using the service
-- role client), and reviewed by admins via /api/admin/signup-requests.
--
-- No RLS policies are defined — access is intentionally gated at the API
-- layer. Service role bypasses RLS; anon/authenticated have no path to
-- these rows. If someone later wires a PostgREST direct query against this
-- table they'll get an empty result, which is the desired fail-closed shape.

create table if not exists signup_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'invited', 'rejected', 'duplicate')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users,
  reviewed_at timestamptz,
  source_ip inet,
  user_agent text
);

create index if not exists signup_requests_status_idx
  on signup_requests (status, created_at desc);

create index if not exists signup_requests_email_idx
  on signup_requests (lower(email));

alter table signup_requests enable row level security;
