-- Rollback for 20261009150000_chat_shortscout_nightly_copy.sql: restores the definitions
-- read from production just before applying (2026-10-09). Copy lifetimes already
-- extended to 36 hours stay; the restored 60-second checked_at rule still governs access.
begin;
CREATE OR REPLACE FUNCTION public.chat_shortscout_apply_authorization(p_subject uuid, p_generation bigint, p_context jsonb, p_state text, p_level text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare proof public.chat_shortscout_authorization;
begin
 if p_state is null or p_state not in ('allow','deny','unavailable')
  or (p_state='allow' and (p_level is null or p_level not in ('monthly','annual','lifetime','mastermind')))
  or (p_state<>'allow' and p_level is not null) then raise exception 'invalid_authorization'; end if;
 select * into proof from public.chat_shortscout_authorization where subject=p_subject for update;
 if not found or not proof.pending or proof.generation<>p_generation or proof.request_context is distinct from p_context
  or proof.requested_at<=clock_timestamp()-interval '6 seconds' then return false; end if;
 update public.chat_shortscout_authorization set pending=false,
  decision=case when p_state='unavailable' then decision else p_state end,
  membership_level=case when p_state='unavailable' then membership_level else p_level end,
  checked_at=case when p_state='unavailable' then checked_at else proof.requested_at end,
  valid_until=case when p_state='unavailable' then clock_timestamp() else proof.requested_at+interval '60 seconds' end,
  retry_after=case when p_state='unavailable' then clock_timestamp()+interval '5 seconds' else null end
 where subject=p_subject;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.chat_shortscout_authorized_identity(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with binding as (select public.chat_shortscout_binding(p_account) b)
 select b||jsonb_build_object('membership_level',a.membership_level,'authorized_until',a.valid_until)
 from binding join public.chat_shortscout_authorization a on a.subject=(b->>'subject')::uuid
 where a.decision='allow' and a.valid_until>now() and a.checked_at>now()-interval '60 seconds';
$function$;

CREATE OR REPLACE FUNCTION public.chat_shortscout_recipient_identity(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with binding as (select public.chat_shortscout_binding(p_account) b)
 select b||jsonb_build_object('membership_level',coalesce(a.membership_level,b->>'membership_level'))
 from binding left join public.chat_shortscout_authorization a on a.subject=(b->>'subject')::uuid
 where b is not null and a.decision is distinct from 'deny'
  and case when a.decision='allow' then a.checked_at else (b->>'verified_at')::timestamptz end>now()-interval '12 hours';
$function$;

CREATE OR REPLACE FUNCTION public.begin_chat_shortscout_renewal(p_account uuid, p_session_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare binding jsonb; context jsonb; result jsonb;
begin
 if not public.chat_shortscout_principal_valid(p_account,p_session_hash) then return jsonb_build_object('mode','invalid'); end if;
 binding:=public.chat_shortscout_binding(p_account);
 if binding is null then return jsonb_build_object('mode','absent'); end if;
 context:=jsonb_build_object('account',p_account,'session',p_session_hash,'binding',binding->>'binding_version');
 result:=public.chat_shortscout_reserve_authorization((binding->>'subject')::uuid,context);
 -- Reserve may wait on another transaction: validate the current context again
 -- after holding the proof lock, never return a pre-wait principal/binding.
 if not public.chat_shortscout_principal_valid(p_account,p_session_hash) then return jsonb_build_object('mode','invalid'); end if;
 if public.chat_shortscout_binding(p_account) is distinct from binding then
  return jsonb_build_object('mode',case when public.chat_shortscout_binding(p_account) is null then 'absent' else 'unavailable' end);
 end if;
 return result||jsonb_build_object('binding',binding);
end $function$;

drop function public.chat_shortscout_sync_subjects();
drop function public.begin_chat_shortscout_sync(uuid,uuid);
drop function public.finish_chat_shortscout_sync(uuid,uuid,bigint,text,text);
drop function public.chat_shortscout_paid_subjects(uuid[]);
delete from public.longboard_chat_admin_events where action='shortscout_sync';
alter table public.longboard_chat_admin_events drop constraint longboard_chat_admin_events_action_check;
alter table public.longboard_chat_admin_events add constraint longboard_chat_admin_events_action_check
 check (action in ('pause','reopen','summary_generate'));
commit;
