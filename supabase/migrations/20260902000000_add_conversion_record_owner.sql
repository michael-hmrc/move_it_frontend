alter table public.conversion_records
  add column user_id uuid references auth.users (id) on delete cascade;

-- This constraint is enforced for all future writes, while allowing a safe
-- rollout when historic prototype records have no authenticated owner.
alter table public.conversion_records
  add constraint conversion_records_user_id_required
  check (user_id is not null) not valid;

create index conversion_records_user_id_idx on public.conversion_records (user_id);
