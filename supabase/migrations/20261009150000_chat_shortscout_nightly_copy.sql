-- A6: ShortScout membership is a local copy, refreshed by a nightly sync (and an owner's
-- Sync now) through the same reserve/apply proof path that sign-in uses. Chat requests
-- read the copy only; they no longer renew a 60-second proof with a live source call.
-- Backward compatible: the running app never receives 'refresh' from the request path.

-- A source answer (sign-in or sync) is good for 36 hours, so one missed nightly sync locks
-- nobody out. An outage keeps the existing copy rather than expiring it.
create or replace function public.chat_shortscout_apply_authorization(p_subject uuid,p_generation bigint,p_context jsonb,p_state text,p_level text) returns boolean
language plpgsql security invoker set search_path='' as $$
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
  valid_until=case when p_state='unavailable' then valid_until else proof.requested_at+interval '36 hours' end,
  retry_after=case when p_state='unavailable' then clock_timestamp()+interval '5 seconds' else null end
 where subject=p_subject;
 return true;
end $$;

-- Actor access: a current allow from the copy. (The 60-second freshness rule is gone.)
create or replace function public.chat_shortscout_authorized_identity(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with binding as (select public.chat_shortscout_binding(p_account) b)
 select b||jsonb_build_object('membership_level',a.membership_level,'authorized_until',a.valid_until)
 from binding join public.chat_shortscout_authorization a on a.subject=(b->>'subject')::uuid
 where a.decision='allow' and a.valid_until>now();
$$;

-- Offline candidates follow the copy too; without a source answer the 12-hour sign-in
-- window still applies. A known denial remains an override.
create or replace function public.chat_shortscout_recipient_identity(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with binding as (select public.chat_shortscout_binding(p_account) b)
 select b||jsonb_build_object('membership_level',coalesce(a.membership_level,b->>'membership_level'))
 from binding left join public.chat_shortscout_authorization a on a.subject=(b->>'subject')::uuid
 where b is not null and a.decision is distinct from 'deny'
  and case when a.decision='allow' then a.valid_until>now() else (b->>'verified_at')::timestamptz>now()-interval '12 hours' end;
$$;

-- Request path: read the copy, never reserve a refresh. A known denial stands until the
-- source says otherwise; anything else without a current answer is 'unavailable'.
create or replace function public.begin_chat_shortscout_renewal(p_account uuid,p_session_hash text default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare binding jsonb; proof public.chat_shortscout_authorization;
begin
 if not public.chat_shortscout_principal_valid(p_account,p_session_hash) then return jsonb_build_object('mode','invalid'); end if;
 binding:=public.chat_shortscout_binding(p_account);
 if binding is null then return jsonb_build_object('mode','absent'); end if;
 select * into proof from public.chat_shortscout_authorization where subject=(binding->>'subject')::uuid;
 if proof.decision='deny' or proof.valid_until>clock_timestamp() then
  return jsonb_build_object('mode','ready','decision',proof.decision,'level',proof.membership_level,'binding',binding);
 end if;
 return jsonb_build_object('mode','unavailable','binding',binding);
end $$;

-- Every ShortScout subject chat knows about: direct and bridged identities, and any copy.
create function public.chat_shortscout_sync_subjects() returns setof uuid
language sql stable security invoker set search_path='' as $$
 select subject from public.chat_provider_identities where provider='shortscout'
 union select subject from public.chat_shortscout_authorization;
$$;

-- One sync run's check of one subject. Forced like sign-in, so a stale or pending proof
-- never blocks the sync; the shared generation still rejects out-of-order answers.
create function public.begin_chat_shortscout_sync(p_subject uuid,p_run uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select public.chat_shortscout_reserve_authorization(p_subject,jsonb_build_object('sync',p_run),true);
$$;

create function public.finish_chat_shortscout_sync(p_subject uuid,p_run uuid,p_generation bigint,p_state text,p_level text) returns boolean
language sql security invoker set search_path='' as $$
 select public.chat_shortscout_apply_authorization(p_subject,p_generation,jsonb_build_object('sync',p_run),p_state,p_level);
$$;

-- Badges read the copy instead of a second live source call.
create function public.chat_shortscout_paid_subjects(p_subjects uuid[]) returns setof uuid
language sql stable security invoker set search_path='' as $$
 select subject from public.chat_shortscout_authorization
 where subject=any(p_subjects) and decision='allow' and valid_until>now();
$$;

revoke all on function public.chat_shortscout_sync_subjects(),public.begin_chat_shortscout_sync(uuid,uuid),public.finish_chat_shortscout_sync(uuid,uuid,bigint,text,text),public.chat_shortscout_paid_subjects(uuid[]) from public,anon,authenticated;
grant execute on function public.chat_shortscout_sync_subjects(),public.begin_chat_shortscout_sync(uuid,uuid),public.finish_chat_shortscout_sync(uuid,uuid,bigint,text,text),public.chat_shortscout_paid_subjects(uuid[]) to service_role;

-- Carry today's answers over to the new lifetime. Older answers wait for the first sync.
update public.chat_shortscout_authorization set valid_until=checked_at+interval '36 hours'
 where decision is not null and checked_at>now()-interval '24 hours' and not pending;

-- Owners' Sync now is audited like other owner actions.
alter table public.longboard_chat_admin_events drop constraint longboard_chat_admin_events_action_check;
alter table public.longboard_chat_admin_events add constraint longboard_chat_admin_events_action_check
 check (action in ('pause','reopen','summary_generate','shortscout_sync'));
