-- Additive rollout: apply before the announcement UI is deployed.
alter table public.longboard_chat_room_state drop constraint longboard_chat_room_slug_check;
alter table public.longboard_chat_room_state add constraint longboard_chat_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements'));
insert into public.longboard_chat_room_state(id,room_slug) values(4,'lb-announcements'),(5,'ss-announcements');
alter table public.chat_room_mentions drop constraint chat_room_mentions_room_slug_check;
alter table public.chat_room_mentions add constraint chat_room_mentions_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements'));
alter table public.chat_attachments drop constraint chat_attachments_room_slug_check;
alter table public.chat_attachments add constraint chat_attachments_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements'));

create or replace function public.chat_account_has_room(p_account uuid,p_room text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case
 when p_room in ('main','lb-announcements') then exists(select 1 from public.profiles where id=p_account)
 when p_room='social' then exists(select 1 from public.profiles where id=p_account)
   or exists(select 1 from public.chat_provider_identities where account_id=p_account and verified_at>now()-interval '12 hours')
 when p_room in ('shortscout','ss-announcements') then exists(select 1 from public.profiles where id=p_account and role='admin')
   or exists(select 1 from public.chat_provider_identities where account_id=p_account and verified_at>now()-interval '12 hours')
 else false end;
$$;

-- Defense in depth for service-side message/reaction/attachment writes.
create function public.enforce_chat_announcement_writer() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target_room text; target_member uuid;
begin
 if tg_table_name='longboard_chat_reactions' then
  select room_slug into target_room from public.longboard_chat_messages where id=new.message_id;
  target_member:=new.guest_id;
 else target_room:=new.room_slug; target_member:=new.member_id;
 end if;
 if target_room in ('lb-announcements','ss-announcements') and not exists (
  select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
  where m.id=target_member and p.role='admin'
 ) then raise exception 'announcement_admin_only'; end if;
 return new;
end $$;
revoke all on function public.enforce_chat_announcement_writer() from public,anon,authenticated;
grant execute on function public.enforce_chat_announcement_writer() to service_role;
create trigger announcement_message_writer before insert or update on public.longboard_chat_messages for each row execute function public.enforce_chat_announcement_writer();
create trigger announcement_reaction_writer before insert or update on public.longboard_chat_reactions for each row execute function public.enforce_chat_announcement_writer();
create trigger announcement_attachment_writer before insert on public.chat_attachments for each row execute function public.enforce_chat_announcement_writer();

create or replace function public.record_chat_room_mentions() returns trigger
language plpgsql security invoker set search_path=public as $$
declare at_pos integer; scan_from integer:=1; relative_pos integer; person record; recipients uuid[]:='{}'; recipient uuid;
begin
 if new.room_slug in ('lb-announcements','ss-announcements') then return new; end if;
 if new.member_id is not null then
  loop
   relative_pos:=strpos(substr(new.body,scan_from),'@');exit when relative_pos=0;
   at_pos:=scan_from+relative_pos-1;scan_from:=at_pos+1;
   if at_pos>1 and substr(new.body,at_pos-1,1) ~ '[[:alnum:]_@]' then continue; end if;
   select m.id,m.user_id into person from longboard_chat_members m
   where lower(substr(new.body,at_pos+1,length(m.display_name)))=lower(m.display_name)
   and substr(new.body,at_pos+1+length(m.display_name),1) !~ '[[:alnum:]_]'
   order by length(m.display_name) desc,m.id limit 1;
   if person.id is not null and person.id<>new.member_id then recipients:=array_append(recipients,person.user_id); end if;
  end loop;
 end if;
 delete from chat_room_mentions where message_id=new.id and not(account_id=any(recipients));
 foreach recipient in array recipients loop
  insert into chat_room_mentions(account_id,message_id,room_slug) values(recipient,new.id,new.room_slug) on conflict(account_id,message_id) do nothing;
 end loop;
 return new;
end $$;

-- One durable bell alert per existing chat account in the matching membership.
-- SS identities remain eligible while offline; inbox reads still require freshly
-- verified current room access. Edits do not reset read state or broadcast again.
create function public.notify_chat_announcement() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.room_slug not in ('lb-announcements','ss-announcements') then return new; end if;
 insert into public.chat_room_mentions(account_id,message_id,room_slug)
 select a.id,new.id,new.room_slug from public.chat_accounts a
 where (new.room_slug='lb-announcements' and exists(select 1 from public.profiles p where p.id=a.longboard_user_id))
 or (new.room_slug='ss-announcements' and (
  exists(select 1 from public.chat_provider_identities i where i.account_id=a.id and i.provider='shortscout')
  or exists(select 1 from public.profiles p where p.id=a.longboard_user_id and p.role='admin')
 )) on conflict(account_id,message_id) do nothing;
 return new;
end $$;
revoke all on function public.notify_chat_announcement() from public,anon,authenticated;
grant execute on function public.notify_chat_announcement() to service_role;
create trigger chat_announcement_events after insert on public.longboard_chat_messages for each row execute function public.notify_chat_announcement();

create or replace function public.change_chat_message(p_actor uuid,p_message uuid,p_room text,p_action text,p_body text default null,p_expected_body text default null,p_admin boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.longboard_chat_messages; own boolean; moderator boolean;
begin
 if p_action not in ('edit','delete') or p_action is null then raise exception 'invalid_action'; end if;
 if p_room in ('lb-announcements','ss-announcements') and not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'message_forbidden'; end if;
 if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
 select * into m from public.longboard_chat_messages where id=p_message and room_slug=p_room for update;
 if not found then raise exception 'message_not_found'; end if;
 own:=m.member_id is not null and exists(select 1 from public.longboard_chat_members where id=m.member_id and user_id=p_actor);
 moderator:=p_admin and exists(select 1 from public.profiles where id=p_actor and role='admin');
 if not own and not (p_action='delete' and moderator) then raise exception 'message_forbidden'; end if;
 if p_action='edit' then
  if m.bot_slug is not null then raise exception 'message_forbidden'; end if;
  if not exists(select 1 from public.longboard_chat_room_state where room_slug=p_room and is_open) then raise exception 'chat_paused'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 600 then raise exception 'invalid_message'; end if;
  if p_expected_body is null or m.body<>p_expected_body then raise exception 'message_changed'; end if;
  if m.body=btrim(p_body) then return to_jsonb(m); end if;
  update public.longboard_chat_messages set body=btrim(p_body),edited_at=now() where id=m.id returning * into m;
 else
  delete from public.longboard_chat_messages where id=m.id;
 end if;
 insert into public.chat_message_actions(message_id,room_slug,actor_id,action)
 values(m.id,m.room_slug,p_actor,case when p_action='delete' and not own then 'admin_delete' else p_action end);
 if p_action='delete' then return jsonb_build_object('deletedId',m.id); end if;
 return to_jsonb(m);
end; $$;
