-- Phase 3L — newsletter subscribers for the Daily homepage form.
-- Plain email capture today; Resend Audiences integration lives in a
-- later phase per docs/phase-3l-audit.md decision 5. RLS on, no public
-- policies — the POST route at /api/newsletter/subscribe uses the
-- service role to insert; admin reads via the service role too.

create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  -- Free-form origin tag. "daily_homepage" for the /learn form;
  -- future campaigns (essay footers, marketing pages) set their own.
  source text not null default 'daily_homepage',
  subscribed_at timestamptz not null default now(),
  -- Set when a user unsubscribes. Keeps the row for audit + dedup;
  -- re-subscribes update the same row rather than inserting.
  unsubscribed_at timestamptz,
  -- Salted sha256 of the submitting IP. Lets us look for abuse
  -- patterns (many signups from one IP) without storing raw PII.
  -- Salt lives in NEWSLETTER_IP_SALT env var.
  ip_hash text,
  user_agent text
);

alter table newsletter_subscribers enable row level security;

-- No public read, no public insert. All access flows through the
-- service role via the API route or an eventual admin export.
