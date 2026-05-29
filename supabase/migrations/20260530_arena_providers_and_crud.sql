-- Arena: platform LLM provider keys + agent CRUD fields.

alter table arena_agents
  add column if not exists provider_key text not null default 'anthropic',
  add column if not exists sort_order int not null default 0,
  add column if not exists archived_at timestamptz;

create index if not exists arena_agents_active_idx
  on arena_agents (archived_at, sort_order);

-- Platform-scoped provider API keys (one key per vendor, shared by agents on that vendor).
create table if not exists arena_provider_secrets (
  provider_key text not null,
  key_label text not null default 'api_key',
  vault_secret_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (provider_key, key_label)
);

alter table arena_provider_secrets enable row level security;

-- Optional non-secret routing (e.g. custom base URL for OpenAI-compatible APIs).
create table if not exists arena_provider_settings (
  provider_key text primary key,
  base_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table arena_provider_settings enable row level security;

update arena_agents set provider_key = 'anthropic' where slug = 'claude';
update arena_agents set provider_key = 'openai' where slug = 'gpt';
update arena_agents set provider_key = 'google' where slug = 'gemini';
update arena_agents set provider_key = 'xai' where slug = 'grok';
update arena_agents set provider_key = 'deepseek' where slug = 'deepseek';

update arena_agents set sort_order = 1 where slug = 'grok';
update arena_agents set sort_order = 2 where slug = 'gemini';
update arena_agents set sort_order = 3 where slug = 'gpt';
update arena_agents set sort_order = 4 where slug = 'claude';
update arena_agents set sort_order = 5 where slug = 'deepseek';
