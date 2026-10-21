-- CHAT-API: personal API tokens, so a member who programs can use chat from their own code.
-- A token acts exactly as its owner (same rooms, same limits); only its hash is stored. Access is
-- invite-only: an account needs a row in chat_api_access, and removing that row stops its tokens.
-- v1 covers accounts signed in with Longboard (ShortScout-only accounts need a session to renew).
-- Rollback: supabase/rollbacks/20261021120000_chat_api_tokens.down.sql
create table public.chat_api_access(
 account_id uuid primary key references public.chat_accounts(id) on delete cascade,
 granted_at timestamptz not null default now(),
 note text check (char_length(note)<=200)
);
create table public.chat_api_tokens(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 label text not null check (char_length(label) between 1 and 60),
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 hint text not null check (hint ~ '^[A-Za-z0-9_-]{4}$'),
 created_at timestamptz not null default now(),
 last_used_at timestamptz,
 revoked_at timestamptz
);
create index chat_api_tokens_account on public.chat_api_tokens(account_id) where revoked_at is null;
alter table public.chat_api_access enable row level security;
alter table public.chat_api_tokens enable row level security;
revoke all on public.chat_api_access,public.chat_api_tokens from public,anon,authenticated;

-- Tokens can be made only by an invited account linked to Longboard; at most 5 active at once.
create function public.create_chat_api_token(actor uuid,p_label text,p_hash text,p_hint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare made public.chat_api_tokens;
begin
 if p_label is null or char_length(btrim(p_label)) not between 1 and 60 then raise exception 'invalid_label';end if;
 if not exists(select 1 from public.chat_api_access g join public.chat_accounts a on a.id=g.account_id
   where g.account_id=actor and a.longboard_user_id=a.id) then
  return jsonb_build_object('status','no_access');
 end if;
 perform 1 from public.chat_accounts where id=actor for update;
 if (select count(*) from public.chat_api_tokens where account_id=actor and revoked_at is null)>=5 then
  return jsonb_build_object('status','limit');
 end if;
 insert into public.chat_api_tokens(account_id,label,token_hash,hint) values(actor,btrim(p_label),p_hash,p_hint) returning * into made;
 return jsonb_build_object('status','created','token',jsonb_build_object('id',made.id,'label',made.label,'hint',made.hint,'createdAt',made.created_at,'lastUsedAt',null));
end $$;

create function public.list_chat_api_tokens(actor uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'access',exists(select 1 from public.chat_api_access g join public.chat_accounts a on a.id=g.account_id where g.account_id=actor and a.longboard_user_id=a.id),
  'tokens',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'label',t.label,'hint',t.hint,'createdAt',t.created_at,'lastUsedAt',t.last_used_at) order by t.created_at desc)
   from public.chat_api_tokens t where t.account_id=actor and t.revoked_at is null),'[]'::jsonb));
$$;

create function public.revoke_chat_api_token(actor uuid,p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 update public.chat_api_tokens set revoked_at=now() where id=p_id and account_id=actor and revoked_at is null;
 get diagnostics changed=row_count;return changed=1;
end $$;

-- Who a token speaks for, in the same shape as chat_longboard_request_context. Checks the token,
-- the invite and the Longboard login (deleted or banned users lose access), and notes last use
-- at most once a minute.
create function public.chat_api_request_context(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.chat_api_tokens; profile public.profiles;
begin
 select k.* into t from public.chat_api_tokens k
  join public.chat_api_access g on g.account_id=k.account_id
  join public.chat_accounts a on a.id=k.account_id and a.longboard_user_id=a.id
  where k.token_hash=p_token_hash and k.revoked_at is null;
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
 if not exists(select 1 from auth.users u where u.id=t.account_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
 then return jsonb_build_object('mode','unauthenticated'); end if;
 select * into profile from public.profiles where id=t.account_id;
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
 update public.chat_api_tokens set last_used_at=now() where id=t.id and (last_used_at is null or last_used_at<now()-interval '1 minute');
 return jsonb_build_object('mode','ok',
  'user',jsonb_build_object('id',profile.id,'email',profile.email,'role',profile.role),
  'boardroom',exists(select 1 from public.user_tags where user_id=profile.id and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(profile.id,null));
end $$;

revoke all on function public.create_chat_api_token(uuid,text,text,text),public.list_chat_api_tokens(uuid),
 public.revoke_chat_api_token(uuid,uuid),public.chat_api_request_context(text) from public,anon,authenticated;
grant execute on function public.create_chat_api_token(uuid,text,text,text),public.list_chat_api_tokens(uuid),
 public.revoke_chat_api_token(uuid,uuid),public.chat_api_request_context(text) to service_role;
grant select,insert,update,delete on public.chat_api_access,public.chat_api_tokens to service_role;
