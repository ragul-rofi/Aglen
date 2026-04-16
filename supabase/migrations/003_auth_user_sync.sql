-- Keep public.users aligned with Supabase Auth users.

create or replace function public.sync_auth_user_to_public_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id,
    email,
    full_name,
    role,
    plan,
    is_active,
    created_at,
    last_active_at
  )
  values (
    new.id,
    coalesce(new.email, new.id::text || '@no-email.local'),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'User'
    ),
    'farmer',
    'free',
    true,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    last_active_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_auth_user_to_public_users on auth.users;

create trigger trg_sync_auth_user_to_public_users
after insert or update of email, raw_user_meta_data on auth.users
for each row
execute function public.sync_auth_user_to_public_users();

-- Backfill existing auth users that are missing in public.users.
insert into public.users (
  id,
  email,
  full_name,
  role,
  plan,
  is_active,
  created_at,
  last_active_at
)
select
  au.id,
  coalesce(au.email, au.id::text || '@no-email.local'),
  coalesce(
    nullif(au.raw_user_meta_data ->> 'full_name', ''),
    nullif(au.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(au.email, ''), '@', 1),
    'User'
  ) as full_name,
  'farmer' as role,
  'free' as plan,
  true as is_active,
  coalesce(au.created_at, now()) as created_at,
  now() as last_active_at
from auth.users au
where not exists (
  select 1
  from public.users pu
  where pu.id = au.id
)
on conflict (id) do nothing;
