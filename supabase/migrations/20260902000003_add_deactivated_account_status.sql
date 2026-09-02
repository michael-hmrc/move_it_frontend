alter table public.app_users
  drop constraint app_users_status_check,
  add constraint app_users_status_check
    check (status in ('pending', 'approved', 'rejected', 'deactivated'));

comment on column public.app_users.status is
  'Approved accounts can use Move It. Deactivated accounts are retained but cannot sign in.';
