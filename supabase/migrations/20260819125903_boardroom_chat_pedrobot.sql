-- Trusted Pedro replies in Boardroom Chat.
--
-- Human messages continue through the authenticated insert policy and the
-- locked author trigger. Bot metadata is accepted only from the service-role
-- server route, and each member message can receive at most one bot reply.

alter table public.boardroom_chat_messages
  add column bot_slug text,
  add column reply_to_id uuid references public.boardroom_chat_messages(id) on delete cascade;

alter table public.boardroom_chat_messages
  drop constraint boardroom_chat_messages_body_check,
  add constraint boardroom_chat_messages_bot_slug_check
    check (bot_slug is null or bot_slug = 'pedrobot'),
  add constraint boardroom_chat_messages_reply_shape_check
    check (
      (bot_slug is null and reply_to_id is null)
      or (bot_slug = 'pedrobot' and reply_to_id is not null)
    ),
  add constraint boardroom_chat_messages_body_check
    check (
      (bot_slug is null and char_length(btrim(body)) between 1 and 600)
      or (bot_slug = 'pedrobot' and char_length(btrim(body)) between 1 and 4000)
    );

create unique index boardroom_chat_messages_reply_to_idx
  on public.boardroom_chat_messages(reply_to_id)
  where reply_to_id is not null;

create or replace function private.set_boardroom_chat_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_email text;
  source_message public.boardroom_chat_messages%rowtype;
begin
  if (select auth.uid()) is null then
    if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
       or new.bot_slug <> 'pedrobot'
       or new.reply_to_id is null then
      raise exception 'authentication required';
    end if;

    select *
      into source_message
      from public.boardroom_chat_messages
     where id = new.reply_to_id
       and bot_slug is null;

    if source_message.id is null then
      raise exception 'source message required';
    end if;

    new.cohort := source_message.cohort;
    new.user_id := source_message.user_id;
    new.author_label := '@pedrobot';
    new.bot_slug := 'pedrobot';
    new.body := btrim(new.body);
    return new;
  end if;

  select p.email
    into trusted_email
    from public.profiles as p
   where p.id = (select auth.uid());

  if trusted_email is null then
    raise exception 'profile required';
  end if;

  new.user_id := (select auth.uid());
  new.author_label := split_part(trusted_email, '@', 1);
  new.bot_slug := null;
  new.reply_to_id := null;
  new.body := btrim(new.body);
  return new;
end;
$$;
