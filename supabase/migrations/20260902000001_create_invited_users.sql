create table public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null check (char_length(display_name) between 2 and 40),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.app_users enable row level security;

comment on table public.app_users is
  'Invite-only Move It accounts managed by the server using the Supabase service role.';
