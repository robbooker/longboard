-- Rollback of 20261109130000_member_welcome.sql (#390). Removes the welcome links and the welcome
-- columns. Unused links stop working; chat accounts and sessions already opened with them stay.
drop function if exists public.member_redeem_welcome_token(text,text,timestamptz);
drop function if exists public.member_welcome_claim_retries(integer);
drop function if exists public.member_welcome_claim(uuid,text);
drop table if exists public.member_welcome_tokens;
alter table public.member_people
 drop column if exists welcome_status,
 drop column if exists welcome_kind,
 drop column if exists welcome_attempts,
 drop column if exists welcome_sent_at,
 drop column if exists welcome_error,
 drop column if exists welcome_updated_at;
