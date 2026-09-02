alter table public.app_users
  add column status text not null default 'approved'
  check (status in ('pending', 'approved', 'rejected'));

comment on column public.app_users.status is
  'Pending accounts may sign in only to see the approval message.';
