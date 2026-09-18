-- Additive RPC: existing discussion edits and worker claims remain unchanged.
create function public.edit_approved_chat_feature(actor uuid, feature uuid, new_title text, new_proposal text, expected_revision integer)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.chat_feature_requests;
begin
 if not exists(select 1 from public.chat_feature_members where account_id=actor and role='owner') then raise exception 'owner_only'; end if;
 if new_title is null or char_length(btrim(new_title)) not between 1 and 200
 or new_proposal is null or char_length(btrim(new_proposal)) not between 1 and 12000 then raise exception 'invalid_proposal'; end if;
 -- Same row lock as claim_chat_feature: a claim sees the complete revised scope,
 -- or an edit arriving after pickup is rejected without changing anything.
 select * into r from public.chat_feature_requests where id=feature for update;
 if not found or r.status<>'approved' or r.claimed_at is not null or r.worker_token is not null
 or r.revision is distinct from expected_revision
 or exists(select 1 from public.chat_feature_releases where request_id=feature) then raise exception 'proposal_changed_or_locked'; end if;
 update public.chat_feature_requests set title=btrim(new_title),proposal=btrim(new_proposal),approved_proposal=btrim(new_proposal),
 revision=revision+1,approved_by=actor,approved_at=now() where id=feature;
 -- Separate bounded records retain the full old/new text within the message limit.
 insert into public.chat_feature_messages(request_id,author_id,author_label,kind,body) values
 (feature,actor,'Rob','system',format('Approved request before owner edit (revision %s):%sTitle: %s%sScope: %s',r.revision,chr(10),r.title,chr(10),coalesce(r.approved_proposal,r.proposal))),
 (feature,actor,'Rob','system',format('Rob revised and approved this request for development (revision %s). Publishing still requires separate approval.%sTitle: %s%sScope: %s',r.revision+1,chr(10),btrim(new_title),chr(10),btrim(new_proposal)));
 return feature;
end $$;
revoke all on function public.edit_approved_chat_feature(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.edit_approved_chat_feature(uuid,uuid,text,text,integer) to service_role;
