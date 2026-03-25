create extension if not exists pgcrypto;

create table if not exists public.employees (
  employee_id text primary key,
  full_name text not null,
  department text,
  email text not null unique,
  tl_email text,
  role text not null default 'agent' check (role in ('agent', 'tl', 'admin')),
  password text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  employee_email text not null unique,
  device_id text not null,
  assigned_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.active_breaks (
  id uuid primary key default gen_random_uuid(),
  break_id text not null unique,
  employee_id text not null,
  employee_name text not null,
  employee_email text not null unique,
  department text,
  tl_email text,
  break_type text not null,
  break_label text not null,
  allowed_minutes integer not null,
  started_at timestamptz not null,
  expected_end_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.break_history (
  id uuid primary key default gen_random_uuid(),
  break_id text not null unique,
  employee_id text not null,
  employee_name text not null,
  employee_email text not null,
  department text,
  tl_email text,
  break_type text not null,
  break_label text not null,
  allowed_minutes integer not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_minutes integer not null default 0,
  duration_seconds integer not null default 0,
  over_minutes integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_employees_email on public.employees (email);
create index if not exists idx_employees_tl_email on public.employees (tl_email);
create index if not exists idx_active_breaks_tl_email on public.active_breaks (tl_email);
create index if not exists idx_break_history_tl_email_started_at on public.break_history (tl_email, started_at desc);
create index if not exists idx_break_history_email_started_at on public.break_history (employee_email, started_at desc);

alter table public.employees enable row level security;
alter table public.trusted_devices enable row level security;
alter table public.active_breaks enable row level security;
alter table public.break_history enable row level security;

drop policy if exists "exp_employees_read" on public.employees;
create policy "exp_employees_read" on public.employees for select to anon, authenticated using (true);

drop policy if exists "exp_trusted_devices_read" on public.trusted_devices;
create policy "exp_trusted_devices_read" on public.trusted_devices for select to anon, authenticated using (true);

drop policy if exists "exp_trusted_devices_insert" on public.trusted_devices;
create policy "exp_trusted_devices_insert" on public.trusted_devices for insert to anon, authenticated with check (true);

drop policy if exists "exp_trusted_devices_update" on public.trusted_devices;
create policy "exp_trusted_devices_update" on public.trusted_devices for update to anon, authenticated using (true) with check (true);

drop policy if exists "exp_trusted_devices_delete" on public.trusted_devices;
create policy "exp_trusted_devices_delete" on public.trusted_devices for delete to anon, authenticated using (true);

drop policy if exists "exp_active_breaks_read" on public.active_breaks;
create policy "exp_active_breaks_read" on public.active_breaks for select to anon, authenticated using (true);

drop policy if exists "exp_active_breaks_insert" on public.active_breaks;
create policy "exp_active_breaks_insert" on public.active_breaks for insert to anon, authenticated with check (true);

drop policy if exists "exp_active_breaks_update" on public.active_breaks;
create policy "exp_active_breaks_update" on public.active_breaks for update to anon, authenticated using (true) with check (true);

drop policy if exists "exp_active_breaks_delete" on public.active_breaks;
create policy "exp_active_breaks_delete" on public.active_breaks for delete to anon, authenticated using (true);

drop policy if exists "exp_break_history_read" on public.break_history;
create policy "exp_break_history_read" on public.break_history for select to anon, authenticated using (true);

drop policy if exists "exp_break_history_insert" on public.break_history;
create policy "exp_break_history_insert" on public.break_history for insert to anon, authenticated with check (true);

alter publication supabase_realtime add table public.active_breaks;
alter publication supabase_realtime add table public.break_history;

insert into public.employees (employee_id, full_name, department, email, tl_email, role, password)
values ('ADMIN', 'AGS Admin', 'Administration', 'admin@ags.com', null, 'admin', 'agent707')
on conflict (employee_id) do update
set full_name = excluded.full_name,
    department = excluded.department,
    email = excluded.email,
    tl_email = excluded.tl_email,
    role = excluded.role,
    password = excluded.password;
