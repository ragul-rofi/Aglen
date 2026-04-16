-- Enable extension required for gen_random_uuid()
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text not null,
  role text not null default 'farmer' check (role in ('farmer','agronomist','admin')),
  location_state text,
  location_district text,
  crop_types text[] default '{}',
  farm_size_acres numeric,
  phone text,
  plan text not null default 'free' check (plan in ('free','pro')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  image_url text not null,
  heatmap_url text,
  predicted_class text not null,
  confidence numeric not null,
  top5 jsonb not null default '[]',
  activation_summary text,
  crop_type text,
  growth_stage text,
  weather_at_scan jsonb,
  location_lat numeric,
  location_lng numeric,
  feedback text check (feedback in ('confirmed','wrong','unsure')),
  corrected_class text,
  created_at timestamptz not null default now()
);

create table disease_alerts (
  id uuid primary key default gen_random_uuid(),
  disease_class text not null,
  severity text not null default 'low' check (severity in ('low','medium','high','critical')),
  affected_district text,
  affected_state text not null,
  case_count integer not null default 0,
  first_detected_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  advisory_text text
);

create table feedback_flags (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  user_id uuid not null references users(id),
  flag_type text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table admin_notes (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references users(id),
  note text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

-- Helper function for role checks in RLS policies.
create or replace function is_admin(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from users
    where id = user_id
      and role = 'admin'
      and is_active = true
  );
$$;

-- Row Level Security enablement.
alter table users enable row level security;
alter table scans enable row level security;
alter table disease_alerts enable row level security;
alter table feedback_flags enable row level security;
alter table admin_notes enable row level security;

-- users: SELECT/UPDATE only own row (except admin).
create policy users_select_own_or_admin
  on users
  for select
  using (auth.uid() = id or is_admin(auth.uid()));

create policy users_update_own_or_admin
  on users
  for update
  using (auth.uid() = id or is_admin(auth.uid()))
  with check (auth.uid() = id or is_admin(auth.uid()));

-- scans: SELECT/INSERT/UPDATE only own rows (except admin sees all).
create policy scans_select_own_or_admin
  on scans
  for select
  using (user_id = auth.uid() or is_admin(auth.uid()));

create policy scans_insert_own_or_admin
  on scans
  for insert
  with check (user_id = auth.uid() or is_admin(auth.uid()));

create policy scans_update_own_or_admin
  on scans
  for update
  using (user_id = auth.uid() or is_admin(auth.uid()))
  with check (user_id = auth.uid() or is_admin(auth.uid()));

-- disease_alerts: SELECT for all authenticated, INSERT/UPDATE for admin only.
create policy disease_alerts_select_authenticated
  on disease_alerts
  for select
  using (auth.role() = 'authenticated');

create policy disease_alerts_insert_admin_only
  on disease_alerts
  for insert
  with check (is_admin(auth.uid()));

create policy disease_alerts_update_admin_only
  on disease_alerts
  for update
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- feedback_flags: INSERT/SELECT own rows.
create policy feedback_flags_select_own
  on feedback_flags
  for select
  using (user_id = auth.uid());

create policy feedback_flags_insert_own
  on feedback_flags
  for insert
  with check (user_id = auth.uid());

-- admin_notes: admin only.
create policy admin_notes_admin_only
  on admin_notes
  for all
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- Indexes.
create index idx_scans_user_id on scans(user_id);
create index idx_scans_created_at_desc on scans(created_at desc);
create index idx_scans_predicted_class on scans(predicted_class);

create index idx_disease_alerts_state_active on disease_alerts(affected_state, is_active);

create index idx_users_role on users(role);
create index idx_users_created_at_desc on users(created_at desc);

-- Trigger to update users.last_active_at after inserts into scans.
create or replace function update_user_last_active_at()
returns trigger
language plpgsql
as $$
begin
  update users
  set last_active_at = now()
  where id = new.user_id;

  return new;
end;
$$;

create trigger trg_scans_update_user_last_active_at
after insert on scans
for each row
execute function update_user_last_active_at();
