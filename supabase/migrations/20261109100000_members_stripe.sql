-- #384 (LB-MEMBERS-STRIPE) The master members tables, filled by Stripe, and the one access check.
--
-- What it adds:
--  * member_products: what we sell (seeded: Booker Stock Club). access_days is for one-time
--    purchases (null = no end); subscriptions follow their billing period.
--  * member_product_entitlements: product -> what it unlocks. Admins can add rows later.
--    Seeded: booker-stock-club -> gainers, reader, club-room.
--  * member_product_stripe_ids: Stripe price / product / payment link ids -> our product. Filled
--    after merge with the club's real ids (STRIPE_PRODUCT_MAP in the env works too).
--  * member_people: one row per buyer, by normalized email; chat_account_id once they sign up.
--  * member_purchases: one row per Stripe subscription, or per one-time checkout.
--  * member_entitlements: what each person has, from a purchase (granted_by 'stripe') or by hand
--    (granted_by 'admin'), with starts_at / ends_at / revoked_at.
--  * member_stripe_events: every Stripe event id we processed, so a resend does nothing.
--  * member_login_codes: the one-time email codes the club sign-up page sends (hashes only).
-- Every table: RLS on, no policies, no grants except service_role (like the other chat tables).
--
-- The access check: member_account_entitlements(account) / member_account_has_entitlement(account,
-- key) read active entitlements of the person linked to that chat account, or whose email is the
-- account's Longboard profile email. A bot account never has any.
--
-- Existing functions changed (exact previous bodies are in the rollback):
--  * chat_account_has_room, chat_account_room_recipient_eligible: the Gainers room is also open to
--    an account with an active 'gainers' entitlement. Checked last, only when every existing rule
--    said no, so nobody who has the room today loses it and nobody else's answer changes.
--  * longboard_chat_link_member: an account with any active entitlement may create its member row
--    (name) even without Social, so a club member can be shown by name.
--  * chat_longboard_request_context, chat_session_request_context, chat_api_request_context: the
--    answer also carries 'member' (the account's active entitlement keys), so the request still
--    makes one database call. Everything else in them is unchanged.
-- Rollback: supabase/rollbacks/20261109100000_members_stripe.down.sql

create table public.member_products(
 key text primary key check (key ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
 name text not null check (char_length(btrim(name)) between 1 and 120),
 access_days integer check (access_days is null or access_days between 1 and 3650),
 active boolean not null default true,
 created_at timestamptz not null default now()
);

create table public.member_product_entitlements(
 product_key text not null references public.member_products(key) on update cascade on delete cascade,
 entitlement_key text not null check (entitlement_key ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
 created_at timestamptz not null default now(),
 primary key(product_key,entitlement_key)
);

create table public.member_product_stripe_ids(
 stripe_id text primary key check (stripe_id ~ '^(price|prod|plink)_[A-Za-z0-9]{1,200}$'),
 product_key text not null references public.member_products(key) on update cascade on delete cascade,
 note text,
 created_at timestamptz not null default now()
);

create table public.member_people(
 id uuid primary key default gen_random_uuid(),
 email text not null unique check (email=lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(email)<=320),
 name text,
 stripe_customer_id text,
 chat_account_id uuid unique references public.chat_accounts(id) on delete set null,
 linked_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index member_people_customer_idx on public.member_people(stripe_customer_id) where stripe_customer_id is not null;

create table public.member_purchases(
 id uuid primary key default gen_random_uuid(),
 person_id uuid not null references public.member_people(id) on delete cascade,
 product_key text references public.member_products(key) on update cascade on delete set null,
 kind text not null check (kind in ('subscription','one_time')),
 status text not null check (char_length(status) between 1 and 40),
 stripe_customer_id text,
 stripe_checkout_session_id text unique,
 stripe_subscription_id text unique,
 stripe_payment_intent_id text,
 stripe_invoice_id text,
 stripe_price_id text,
 stripe_product_id text,
 amount bigint,
 currency text,
 livemode boolean not null default false,
 current_period_start timestamptz,
 current_period_end timestamptz,
 cancel_at_period_end boolean not null default false,
 canceled boolean not null default false,
 canceled_at timestamptz,
 refunded boolean not null default false,
 refunded_amount bigint not null default 0,
 -- Stripe's created time of the last event that set the status, so an older event arriving late
 -- never undoes a newer one.
 last_event_at timestamptz,
 event_ids text[] not null default '{}',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index member_purchases_person_idx on public.member_purchases(person_id);
create index member_purchases_payment_intent_idx on public.member_purchases(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index member_purchases_invoice_idx on public.member_purchases(stripe_invoice_id) where stripe_invoice_id is not null;

create table public.member_entitlements(
 id uuid primary key default gen_random_uuid(),
 person_id uuid not null references public.member_people(id) on delete cascade,
 entitlement_key text not null check (entitlement_key ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
 product_key text references public.member_products(key) on update cascade on delete set null,
 purchase_id uuid references public.member_purchases(id) on delete cascade,
 starts_at timestamptz not null default now(),
 ends_at timestamptz,
 granted_by text not null check (granted_by in ('stripe','admin')),
 granted_by_user uuid,
 note text check (note is null or char_length(note)<=500),
 revoked_at timestamptz,
 revoked_by text check (revoked_by is null or revoked_by in ('stripe','admin')),
 revoked_by_user uuid,
 revoked_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (granted_by='admin' or purchase_id is not null),
 check ((revoked_at is null)=(revoked_by is null))
);
create unique index member_entitlements_purchase_key on public.member_entitlements(purchase_id,entitlement_key) where purchase_id is not null;
create index member_entitlements_person_idx on public.member_entitlements(person_id);

create table public.member_stripe_events(
 event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9_]{1,200}$'),
 type text not null,
 livemode boolean not null default false,
 stripe_created_at timestamptz,
 object_id text,
 received_at timestamptz not null default now(),
 processed_at timestamptz,
 attempts integer not null default 1,
 outcome text,
 error text
);

create table public.member_login_codes(
 id uuid primary key default gen_random_uuid(),
 email text not null check (email=lower(btrim(email))),
 code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 attempts integer not null default 0,
 consumed_at timestamptz
);
create index member_login_codes_email_idx on public.member_login_codes(email,created_at desc);

alter table public.member_products enable row level security;
alter table public.member_product_entitlements enable row level security;
alter table public.member_product_stripe_ids enable row level security;
alter table public.member_people enable row level security;
alter table public.member_purchases enable row level security;
alter table public.member_entitlements enable row level security;
alter table public.member_stripe_events enable row level security;
alter table public.member_login_codes enable row level security;
revoke all on public.member_products,public.member_product_entitlements,public.member_product_stripe_ids,
 public.member_people,public.member_purchases,public.member_entitlements,public.member_stripe_events,
 public.member_login_codes from public,anon,authenticated;
grant select,insert,update,delete on public.member_products,public.member_product_entitlements,public.member_product_stripe_ids,
 public.member_people,public.member_purchases,public.member_entitlements,public.member_stripe_events,
 public.member_login_codes to service_role;

insert into public.member_products(key,name) values('booker-stock-club','Booker Stock Club');
insert into public.member_product_entitlements(product_key,entitlement_key) values
 ('booker-stock-club','gainers'),('booker-stock-club','reader'),('booker-stock-club','club-room');

-- The access check. Active = not revoked, started, not ended.
create function public.member_account_entitlements(p_account uuid) returns text[]
language sql stable security invoker set search_path='' as $$
 select coalesce(array_agg(distinct e.entitlement_key order by e.entitlement_key),'{}'::text[])
 from public.member_entitlements e join public.member_people p on p.id=e.person_id
 where p_account is not null
  and not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account)
  and e.revoked_at is null and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now())
  and (p.chat_account_id=p_account
   or p.email=(select lower(btrim(pr.email)) from public.chat_accounts a join public.profiles pr on pr.id=a.longboard_user_id where a.id=p_account));
$$;

create function public.member_account_has_entitlement(p_account uuid,p_key text) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(p_key=any(public.member_account_entitlements(p_account)),false);
$$;

create function public.member_email_entitlements(p_email text) returns text[]
language sql stable security invoker set search_path='' as $$
 select coalesce(array_agg(distinct e.entitlement_key order by e.entitlement_key),'{}'::text[])
 from public.member_entitlements e join public.member_people p on p.id=e.person_id
 where p.email=lower(btrim(p_email))
  and e.revoked_at is null and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now());
$$;

-- The club sign-up: link the person to a chat account (made on first sign-up) and open a chat
-- sign-in session, in one transaction. Refuses an email that belongs to a Longboard profile:
-- those members sign in with Longboard, and their purchase reaches them by email match.
create function public.member_open_chat_session(p_email text,p_session_hash text,p_expires_at timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare person public.member_people; account uuid;
begin
 if p_session_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_session'; end if;
 select * into person from public.member_people where email=lower(btrim(p_email)) for update;
 if not found then return jsonb_build_object('status','no_purchase'); end if;
 if exists(select 1 from public.profiles where lower(btrim(email))=person.email) then
  return jsonb_build_object('status','longboard_account');
 end if;
 if cardinality(public.member_email_entitlements(person.email))=0 then return jsonb_build_object('status','no_access'); end if;
 account:=person.chat_account_id;
 if account is null then
  insert into public.chat_accounts default values returning id into account;
  update public.member_people set chat_account_id=account,linked_at=now(),updated_at=now() where id=person.id;
 end if;
 insert into public.chat_sessions(token_hash,account_id,expires_at) values(p_session_hash,account,p_expires_at);
 return jsonb_build_object('status','ok','account',account,
  'member',exists(select 1 from public.longboard_chat_members m where m.user_id=account));
end $$;

revoke all on function public.member_account_entitlements(uuid),public.member_account_has_entitlement(uuid,text),
 public.member_email_entitlements(text),public.member_open_chat_session(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.member_account_entitlements(uuid),public.member_account_has_entitlement(uuid,text),
 public.member_email_entitlements(text),public.member_open_chat_session(text,text,timestamptz) to service_role;

-- Current definition; the Gainers room line also accepts an active 'gainers' entitlement.
CREATE OR REPLACE FUNCTION public.chat_account_has_room(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
begin
 return (
with tier as (select public.chat_shortscout_identity(p_account)->>'membership_level' value) select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review') then exists(select 1 from public.profiles where id=p_account)
  or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
  -- #384: Booker Stock Club members. Read only when the rules above said no.
  or (p_room='gainers' and public.member_account_has_entitlement(p_account,'gainers'))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
 else false end
 );
end
$function$;

-- Current definition; the same Gainers rule as chat_account_has_room.
CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
  -- #384: Booker Stock Club members.
  or (p_room='gainers' and public.member_account_has_entitlement(p_account,'gainers'))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$;

-- Current definition; an account with an active entitlement may also take a member name.
CREATE OR REPLACE FUNCTION public.longboard_chat_link_member(p_user_id uuid, p_name text, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.longboard_chat_members; g public.longboard_chat_guests;
begin
  if not (public.chat_account_has_room(p_user_id,'social') or cardinality(public.member_account_entitlements(p_user_id))>0) then raise exception 'profile_required'; end if;
  insert into public.chat_accounts(id,longboard_user_id) select id,id from public.profiles where id=p_user_id on conflict do nothing;
  perform pg_advisory_xact_lock(hashtextextended('chat-member:' || p_user_id::text,0));
  select * into m from public.longboard_chat_members where user_id = p_user_id;
  if found then return to_jsonb(m); end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 28 then raise exception 'invalid_display_name'; end if;
  if p_token_hash is not null then
    select * into g from public.longboard_chat_guests where token_hash = p_token_hash for update;
  end if;
  if g.id is not null and exists(select 1 from public.longboard_chat_members where id=g.id) then
    raise exception 'identity_already_linked';
  end if;
  if g.id is null then
    insert into public.longboard_chat_guests(token_hash,display_name)
    values(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),btrim(p_name)) returning * into g;
  else
    -- Retire the guest credential. It can no longer operate an account identity.
    update public.longboard_chat_guests set token_hash=replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), display_name=btrim(p_name), updated_at=now() where id=g.id;
  end if;
  insert into public.longboard_chat_members(id,user_id,display_name) values(g.id,p_user_id,btrim(p_name)) returning * into m;
  return to_jsonb(m);
end;
$function$;

-- Current definition plus 'member'.
CREATE OR REPLACE FUNCTION public.chat_api_request_context(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.chat_api_tokens; profile public.profiles; bot_rooms text[];
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
 -- #330: a bot account gets its room list and nothing else: never admin, Boardroom or ShortScout.
 select b.allowed_rooms into bot_rooms from public.chat_bot_accounts b where b.account_id=t.account_id;
 if found then
  return jsonb_build_object('mode','ok',
   'user',jsonb_build_object('id',profile.id,'email',profile.email,'role','user'),
   'boardroom',false,'shortscout',jsonb_build_object('mode','absent'),'botRooms',to_jsonb(bot_rooms));
 end if;
 return jsonb_build_object('mode','ok',
  'user',jsonb_build_object('id',profile.id,'email',profile.email,'role',profile.role),
  'boardroom',exists(select 1 from public.user_tags where user_id=profile.id and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(profile.id,null),
  'member',to_jsonb(public.member_account_entitlements(profile.id)));
end $function$;

-- Current definition plus 'member'.
CREATE OR REPLACE FUNCTION public.chat_longboard_request_context(p_user uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare profile public.profiles;
begin
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
   where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
 then return jsonb_build_object('mode','unauthenticated'); end if;
 -- #330: a bot account only ever works through its API token.
 if exists(select 1 from public.chat_bot_accounts b where b.account_id=p_user) then return jsonb_build_object('mode','unauthenticated'); end if;
 select * into profile from public.profiles where id=p_user;
 if not found then return jsonb_build_object('mode','no_profile'); end if;
 -- Concurrent first visits are safe; never overwrite an existing link.
 insert into public.chat_accounts(id,longboard_user_id) values(p_user,p_user) on conflict (id) do nothing;
 return jsonb_build_object('mode','ok',
  'user',jsonb_build_object('id',profile.id,'email',profile.email,'role',profile.role),
  'boardroom',exists(select 1 from public.user_tags where user_id=p_user and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(p_user,null),
  'member',to_jsonb(public.member_account_entitlements(p_user)));
end $function$;

-- Current definition plus 'member'.
CREATE OR REPLACE FUNCTION public.chat_session_request_context(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare account public.chat_accounts; profile public.profiles;
begin
 select a.* into account from public.chat_sessions s join public.chat_accounts a on a.id=s.account_id
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>clock_timestamp();
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
 -- #330: a bot account only ever works through its API token.
 if exists(select 1 from public.chat_bot_accounts b where b.account_id=account.id) then return jsonb_build_object('mode','unauthenticated'); end if;
 if account.longboard_user_id is not null then
  select * into profile from public.profiles where id=account.longboard_user_id;
 end if;
 return jsonb_build_object('mode','ok','account',account.id,
  'longboard',profile.id is not null,
  'role',profile.role,
  'boardroom',profile.id is not null and exists(select 1 from public.user_tags
    where user_id=account.longboard_user_id and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(account.id,p_token_hash),
  'member',to_jsonb(public.member_account_entitlements(account.id)));
end $function$;
