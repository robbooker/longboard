-- Universal chart watchlists edited through app-owned API routes.
--
-- Rob's List is globally visible in the charts rail, but writes are guarded
-- by /api/charts/rob-list so only the configured Rob account can update it.

create table if not exists chart_shared_watchlists (
  id text primary key,
  label text not null,
  symbols text[] not null default '{}',
  updated_by uuid references auth.users on delete set null,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chart_shared_watchlists_id_chk
    check (id = lower(id) and id ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  constraint chart_shared_watchlists_symbols_count_chk
    check (cardinality(symbols) > 0 and cardinality(symbols) <= 120)
);

alter table chart_shared_watchlists enable row level security;

revoke all on chart_shared_watchlists from anon;
revoke all on chart_shared_watchlists from authenticated;
grant select, insert, update, delete on chart_shared_watchlists to service_role;

insert into chart_shared_watchlists (id, label, symbols)
values (
  'rob-top-stocks',
  'Rob''s Top Stocks',
  array['NVDA', 'TSLA', 'AMD', 'PLTR', 'SMCI', 'HOOD', 'COIN', 'MSTR', 'RGTI', 'IONQ']
)
on conflict (id) do nothing;
