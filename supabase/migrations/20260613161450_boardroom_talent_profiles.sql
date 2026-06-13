-- Boardroom talent inventory.
--
-- Each Boardroom member can save one strengths/contribution profile.
-- Members can read and update only their own row. Admins can read every
-- row for follow-up, matching the broader Boardroom admin pattern.

create table if not exists boardroom_talent_profiles (
  user_id uuid primary key references auth.users on delete cascade,
  email text not null,
  cohort text,
  categories text[] not null default '{}',
  other_strengths text,
  contribution_interests text,
  availability text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists boardroom_talent_profiles_cohort_idx
  on boardroom_talent_profiles(cohort);

alter table boardroom_talent_profiles enable row level security;

drop policy if exists "users read own talent profile" on boardroom_talent_profiles;
create policy "users read own talent profile"
  on boardroom_talent_profiles for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "admins read talent profiles" on boardroom_talent_profiles;
create policy "admins read talent profiles"
  on boardroom_talent_profiles for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "boardroom members insert own talent profile" on boardroom_talent_profiles;
create policy "boardroom members insert own talent profile"
  on boardroom_talent_profiles for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_talent_profiles.cohort
    )
  );

drop policy if exists "users update own talent profile" on boardroom_talent_profiles;
create policy "users update own talent profile"
  on boardroom_talent_profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from user_tags
      where user_tags.user_id = auth.uid()
        and user_tags.tag = 'boardroom-' || boardroom_talent_profiles.cohort
    )
  );
