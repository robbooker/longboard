-- Rob explicitly authorized Jammie's full existing site administration on
-- October 2, 2026. This is an exact-account grant, never an email-wide grant.
-- Chat control ownership is separate from feature/release ownership; those
-- records and the sole-publisher safeguards are deliberately unchanged.
do $$
declare
  target constant uuid := '6ad10d99-fe91-4955-86fa-a893b9763573';
begin
  -- Lock the trusted association while checking it. Missing or changed links
  -- abort the migration instead of silently skipping or promoting another user.
  perform 1
    from public.chat_accounts a
    join public.profiles p on p.id = a.longboard_user_id
    join auth.users u on u.id = p.id
   where a.id = target
     and a.longboard_user_id = target
     and p.id = target
     and lower(p.email) = 'ojammie@gmail.com'
   for update of a, p;
  if not found then
    raise exception 'jammie_admin_trusted_association_mismatch';
  end if;

  update public.profiles
     set role = 'admin', updated_at = now()
   where id = target and role is distinct from 'admin';

  insert into public.longboard_chat_owners (user_id)
  values (target)
  on conflict (user_id) do nothing;
end
$$;
