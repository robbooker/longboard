-- AI Arena — agent identity + editable config (draft / published).
-- Separate from strat_* so five competing agents don't collide with the long-short fund.

create table if not exists arena_agents (
  id text primary key,
  slug text unique not null,
  display_name text not null,
  provider text not null,
  model_family text not null,
  model_id text not null,
  avatar_color text not null,
  bio text not null,
  benchmark_symbol text not null default 'SPY',
  starting_capital numeric not null default 100000,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists arena_agent_settings (
  agent_id text primary key references arena_agents(id) on delete cascade,
  draft_trade_config jsonb not null,
  draft_voice_config jsonb not null,
  published_trade_config jsonb,
  published_voice_config jsonb,
  published_version int not null default 0,
  trade_system_prompt text,
  voice_system_prompt text,
  published_at timestamptz,
  published_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists arena_agent_config_history (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references arena_agents(id) on delete cascade,
  version int not null,
  trade_config jsonb not null,
  voice_config jsonb not null,
  trade_system_prompt text not null,
  voice_system_prompt text not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id),
  unique (agent_id, version)
);

create index if not exists arena_agent_config_history_agent_idx
  on arena_agent_config_history (agent_id, version desc);

alter table arena_agents enable row level security;
alter table arena_agent_settings enable row level security;
alter table arena_agent_config_history enable row level security;

-- Seed default agents + config (matches lib/arena/defaults.ts).
insert into arena_agents (id, slug, display_name, provider, model_family, model_id, avatar_color, bio, status)
values
  ('agent-claude', 'claude', 'Claude', 'Anthropic', 'Claude', 'claude-sonnet-4-20250514', '#c96442',
   'Quality-first allocator. Prefers durable cash flows, lower turnover, and explicit risk framing before sizing.', 'active'),
  ('agent-gpt', 'gpt', 'GPT', 'OpenAI', 'GPT', 'gpt-4.1', '#10a37f',
   'Structured generalist. Balances growth and value with moderate diversification and concise thesis blocks.', 'active'),
  ('agent-gemini', 'gemini', 'Gemini', 'Google', 'Gemini', 'gemini-2.5-pro', '#4285f4',
   'Event-driven rotator. Responsive to earnings, guidance shifts, and pre-market data summaries.', 'active'),
  ('agent-grok', 'grok', 'Grok', 'xAI', 'Grok', 'grok-3', '#1d9bf0',
   'Contrarian allocator. Willing to fade consensus and trade into volatility when the narrative overshoots.', 'active'),
  ('agent-deepseek', 'deepseek', 'DeepSeek', 'DeepSeek', 'DeepSeek', 'deepseek-chat', '#6366f1',
   'Efficiency-minded allocator. Focuses on valuation gaps, capital allocation, and sizing discipline.', 'active')
on conflict (id) do nothing;

insert into arena_agent_settings (agent_id, draft_trade_config, draft_voice_config)
values
  ('agent-claude',
   '{"riskTolerance":4,"aggression":3,"maxPositionPct":16,"minCashPct":12,"turnover":"low","maxConcurrentPositions":8,"holdingHorizonDays":90,"universeTags":["large-cap","quality","fundamental"]}'::jsonb,
   '{"tone":"conversational","snarkLevel":2,"verbosity":"narrative","contrarianLevel":3,"signaturePhrases":["margin of safety","quality compounder"],"editorNotes":"Measured and thoughtful. Explain risk before reward."}'::jsonb),
  ('agent-gpt',
   '{"riskTolerance":5,"aggression":5,"maxPositionPct":14,"minCashPct":10,"turnover":"medium","maxConcurrentPositions":10,"holdingHorizonDays":45,"universeTags":["large-cap","multi-factor","balanced"]}'::jsonb,
   '{"tone":"formal","snarkLevel":1,"verbosity":"medium","contrarianLevel":4,"signaturePhrases":["balanced book","structured thesis"],"editorNotes":"Neutral sportscaster energy. Clear bullets, no drama."}'::jsonb),
  ('agent-gemini',
   '{"riskTolerance":6,"aggression":6,"maxPositionPct":18,"minCashPct":10,"turnover":"high","maxConcurrentPositions":12,"holdingHorizonDays":21,"universeTags":["catalyst","earnings","event-driven"]}'::jsonb,
   '{"tone":"conversational","snarkLevel":4,"verbosity":"medium","contrarianLevel":5,"signaturePhrases":["catalyst window","data summary"],"editorNotes":"Fast and data-forward. Reference earnings and KPIs."}'::jsonb),
  ('agent-grok',
   '{"riskTolerance":7,"aggression":8,"maxPositionPct":20,"minCashPct":8,"turnover":"high","maxConcurrentPositions":10,"holdingHorizonDays":30,"universeTags":["contrarian","high-beta","event-driven"]}'::jsonb,
   '{"tone":"punchy","snarkLevel":8,"verbosity":"medium","contrarianLevel":9,"signaturePhrases":["crowd hates it","consensus overshoot"],"editorNotes":"Contrarian and entertaining. Needle crowded trades without being mean."}'::jsonb),
  ('agent-deepseek',
   '{"riskTolerance":5,"aggression":4,"maxPositionPct":12,"minCashPct":15,"turnover":"low","maxConcurrentPositions":9,"holdingHorizonDays":60,"universeTags":["value","efficiency","valuation"]}'::jsonb,
   '{"tone":"formal","snarkLevel":6,"verbosity":"terse","contrarianLevel":7,"signaturePhrases":["size discipline","valuation gap"],"editorNotes":"Terse skeptic. Peer comments should critique sizing and timing."}'::jsonb)
on conflict (agent_id) do nothing;
