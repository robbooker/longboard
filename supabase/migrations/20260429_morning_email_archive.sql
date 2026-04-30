-- Phase admin morning email — archive table.
--
-- Snapshot of every successfully generated morning email. Written from the
-- admin-gated /api/admin/morning-email/generate route via service role.
-- No in-progress draft persistence — workflow state stays client-side until
-- generation succeeds. Multiple generations on the same day produce multiple
-- rows (each is a snapshot).
--
-- RLS is enabled with no policies, so authenticated/anon users get nothing.
-- The /api/admin/morning-email/* routes use service role + requireAdmin to
-- read/write.

create table if not exists morning_email_archive (
  id uuid primary key default gen_random_uuid(),
  sent_date date not null,
  subject text not null,
  stocks_json jsonb not null,
  qa_json jsonb,
  html text not null,
  generated_by uuid references auth.users on delete set null,
  generated_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists morning_email_archive_date_idx
  on morning_email_archive(sent_date desc);

alter table morning_email_archive enable row level security;
