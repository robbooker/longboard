-- #390 (LB-CLUB-WELCOME) Club buyers get a welcome email with a one-tap sign-in link.
--
-- What it adds:
--  * member_people.welcome_*: whether the welcome email went out for this person.
--    welcome_status: null (never asked for), 'pending' (being sent), 'sent', 'failed',
--    'not_needed' (already had a chat account). welcome_kind: 'club' (one-tap link) or
--    'longboard' (the email belongs to a Longboard account: sign in there). welcome_attempts counts
--    sends; the app retries a failed send once automatically, admins can resend any time.
--    Existing people already linked to a chat account are marked 'not_needed'; the others stay null
--    (an admin can send them a welcome from the Members page).
--  * member_welcome_tokens: one-tap sign-in links. Only a sha256 of the token is stored. Each is tied
--    to one person (and their email), used once, and ends at expires_at (7 days for an email link,
--    15 minutes for one made on the thank-you page from a Stripe checkout session). A checkout
--    session gives at most one sign-in (a unique index over its used tokens).
--  * member_welcome_claim(person, mode): marks a person's welcome 'pending' when it may be sent now
--    ('first': never sent; 'admin': always). One caller wins, so a welcome goes out once.
--  * member_welcome_claim_retries(limit): the same for welcomes due their one automatic retry
--    (failed two minutes ago or more, or stuck 'pending' for ten minutes, unlinked, one try so far).
--  * member_redeem_welcome_token(token, session, expires): checks and uses a token and opens a chat
--    session (member_open_chat_session) in one transaction; nothing is used up if it can't sign in.
-- Every new table/function: RLS on, service_role only. No existing function changes.
-- Rollback: supabase/rollbacks/20261109130000_member_welcome.down.sql

alter table public.member_people
 add column welcome_status text check (welcome_status is null or welcome_status in ('pending','sent','failed','not_needed')),
 add column welcome_kind text check (welcome_kind is null or welcome_kind in ('club','longboard')),
 add column welcome_attempts integer not null default 0,
 add column welcome_sent_at timestamptz,
 add column welcome_error text check (welcome_error is null or char_length(welcome_error)<=300),
 add column welcome_updated_at timestamptz;

update public.member_people set welcome_status='not_needed',welcome_updated_at=now() where chat_account_id is not null;

create table public.member_welcome_tokens(
 id uuid primary key default gen_random_uuid(),
 person_id uuid not null references public.member_people(id) on delete cascade,
 email text not null check (email=lower(btrim(email))),
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 purpose text not null check (purpose in ('email','checkout')),
 checkout_session_id text check (checkout_session_id is null or checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{10,200}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 check ((purpose='checkout')=(checkout_session_id is not null))
);
create index member_welcome_tokens_person_idx on public.member_welcome_tokens(person_id,created_at desc);
create index member_welcome_tokens_session_idx on public.member_welcome_tokens(checkout_session_id,created_at desc) where checkout_session_id is not null;
-- One sign-in per checkout session.
create unique index member_welcome_tokens_session_once on public.member_welcome_tokens(checkout_session_id) where checkout_session_id is not null and consumed_at is not null;

alter table public.member_welcome_tokens enable row level security;
revoke all on public.member_welcome_tokens from public,anon,authenticated;
grant select,insert,update,delete on public.member_welcome_tokens to service_role;

create function public.member_welcome_claim(p_person uuid,p_mode text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.member_people;
begin
 if p_mode not in ('first','admin') then raise exception 'invalid_mode'; end if;
 update public.member_people set welcome_status='pending',welcome_attempts=welcome_attempts+1,welcome_error=null,
  welcome_updated_at=now(),updated_at=now()
 where id=p_person and (p_mode='admin' or welcome_status is null)
 returning * into r;
 if r.id is null then return null; end if;
 return to_jsonb(r);
end $$;

create function public.member_welcome_claim_retries(p_limit integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 with due as (
  select id from public.member_people
  where welcome_attempts<2 and chat_account_id is null
   and ((welcome_status='failed' and welcome_updated_at<now()-interval '2 minutes')
    or (welcome_status='pending' and welcome_updated_at<now()-interval '10 minutes'))
  order by welcome_updated_at limit least(greatest(coalesce(p_limit,5),1),20)
  for update skip locked
 ), claimed as (
  update public.member_people p set welcome_status='pending',welcome_attempts=p.welcome_attempts+1,welcome_error=null,
   welcome_updated_at=now(),updated_at=now()
  from due where p.id=due.id returning p.*
 )
 select coalesce(jsonb_agg(to_jsonb(claimed.*)),'[]'::jsonb) into result from claimed;
 return result;
end $$;

create function public.member_redeem_welcome_token(p_token_hash text,p_session_hash text,p_expires_at timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.member_welcome_tokens; person public.member_people; opened jsonb;
begin
 if p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status','invalid'); end if;
 select * into t from public.member_welcome_tokens where token_hash=p_token_hash for update;
 if not found then return jsonb_build_object('status','invalid'); end if;
 if t.consumed_at is not null then return jsonb_build_object('status','used'); end if;
 if t.expires_at<=now() then return jsonb_build_object('status','expired'); end if;
 if t.checkout_session_id is not null and exists(select 1 from public.member_welcome_tokens
   where checkout_session_id=t.checkout_session_id and consumed_at is not null) then
  return jsonb_build_object('status','session_used');
 end if;
 select * into person from public.member_people where id=t.person_id;
 if not found or person.email<>t.email then return jsonb_build_object('status','invalid'); end if;
 begin
  opened:=public.member_open_chat_session(person.email,p_session_hash,p_expires_at);
  if opened->>'status'<>'ok' then return opened; end if;
  update public.member_welcome_tokens set consumed_at=now() where id=t.id;
 exception when unique_violation then
  -- Another token for the same checkout session was used a moment ago (the session insert is undone).
  return jsonb_build_object('status','session_used');
 end;
 return opened || jsonb_build_object('name',person.name);
end $$;

revoke all on function public.member_welcome_claim(uuid,text),public.member_welcome_claim_retries(integer),
 public.member_redeem_welcome_token(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.member_welcome_claim(uuid,text),public.member_welcome_claim_retries(integer),
 public.member_redeem_welcome_token(text,text,timestamptz) to service_role;
