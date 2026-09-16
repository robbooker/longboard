begin;
select set_config('workbook.test_owner', (select id::text from auth.users order by id limit 1), true);
select set_config('workbook.test_other', (select id::text from auth.users where id::text <> current_setting('workbook.test_owner') order by id limit 1), true);
select set_config('request.jwt.claim.sub', current_setting('workbook.test_owner'), true);
set local role authenticated;
insert into public.workbook_responses(user_id, workbook_slug, response)
values (current_setting('workbook.test_owner')::uuid, 'workbook-rls-verification', '{"answers":{},"evidence":[]}');
do $$
declare affected int;
begin
  if (select count(*) from public.workbook_responses where workbook_slug = 'workbook-rls-verification') <> 1 then raise exception 'Owner read failed'; end if;
  update public.workbook_responses set revision = 2 where workbook_slug = 'workbook-rls-verification' and revision = 1;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner update failed'; end if;
  update public.workbook_responses set revision = 3 where workbook_slug = 'workbook-rls-verification' and revision = 1;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Stale revision overwrote answers'; end if;
  begin
    update public.workbook_responses set user_id = current_setting('workbook.test_other')::uuid where workbook_slug = 'workbook-rls-verification';
    raise exception 'Ownership reassignment allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', current_setting('workbook.test_other'), true);
do $$
declare affected int;
begin
  if exists (select 1 from public.workbook_responses where workbook_slug = 'workbook-rls-verification') then raise exception 'Other user read allowed'; end if;
  update public.workbook_responses set revision = 4 where workbook_slug = 'workbook-rls-verification';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Other user update allowed'; end if;
  begin
    insert into public.workbook_responses(user_id, workbook_slug, response) values (current_setting('workbook.test_owner')::uuid, 'workbook-forged-owner', '{}');
    raise exception 'Forged owner insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.workbook_responses where workbook_slug = 'workbook-rls-verification';
    raise exception 'Delete allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role anon;
do $$
begin
  begin perform 1 from public.workbook_responses; raise exception 'Anonymous read allowed';
  exception when insufficient_privilege then null; end;
  begin insert into public.workbook_responses(user_id, workbook_slug, response) values (current_setting('workbook.test_owner')::uuid, 'workbook-anonymous', '{}'); raise exception 'Anonymous insert allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: owner read/write, stale revision protection, cross-user isolation, ownership reassignment denied, anonymous access denied; all test writes rolled back' as result;
