create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 40),
  created_at timestamptz not null default now()
);

create unique index teams_name_unique on public.teams (lower(btrim(name)));

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  invited_user_id uuid not null unique references auth.users (id) on delete cascade,
  invited_by_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, invited_user_id),
  check (invited_user_id <> invited_by_user_id)
);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invitations enable row level security;

create or replace function public.enforce_team_member_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.teams where id = new.team_id for update;
  if (select count(*) from public.team_members where team_id = new.team_id) >= 5 then
    raise exception 'This team already has 5 members';
  end if;
  return new;
end;
$$;

create trigger team_member_limit
before insert on public.team_members
for each row execute function public.enforce_team_member_limit();

create or replace function public.remove_empty_team()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.teams where id = old.team_id)
    and not exists (select 1 from public.team_members where team_id = old.team_id) then
    delete from public.teams where id = old.team_id;
  end if;
  return old;
end;
$$;

create trigger remove_team_without_members
after delete on public.team_members
for each row execute function public.remove_empty_team();

create or replace function public.create_move_it_team(requesting_user_id uuid, requested_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_team_id uuid;
begin
  perform 1 from public.app_users where id = requesting_user_id for update;

  if exists (select 1 from public.team_members where user_id = requesting_user_id) then
    raise exception 'You are already in a team';
  end if;

  insert into public.teams (name)
  values (btrim(requested_name))
  returning id into new_team_id;

  insert into public.team_members (team_id, user_id)
  values (new_team_id, requesting_user_id);

  delete from public.team_invitations where invited_user_id = requesting_user_id;

  return new_team_id;
exception
  when unique_violation then
    if exists (select 1 from public.team_members where user_id = requesting_user_id) then
      raise exception 'You are already in a team';
    end if;
    raise exception 'Choose a different team name';
end;
$$;

create or replace function public.invite_move_it_team_member(
  requesting_user_id uuid,
  requested_display_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_team_id uuid;
  target_user_id uuid;
begin
  select team_id into current_team_id
  from public.team_members
  where user_id = requesting_user_id;

  if current_team_id is null then
    raise exception 'You must be in a team to invite someone';
  end if;

  select id into target_user_id
  from public.app_users
  where lower(btrim(display_name)) = lower(btrim(requested_display_name))
    and status = 'approved'
  for update;

  if target_user_id is null then
    raise exception 'Enter the display name of an approved user';
  end if;

  perform 1 from public.teams where id = current_team_id for update;

  if (
    (select count(*) from public.team_members where team_id = current_team_id)
    + (select count(*) from public.team_invitations where team_id = current_team_id)
  ) >= 5 then
    raise exception 'This team already has 5 members or pending invitations';
  end if;

  if target_user_id = requesting_user_id then
    raise exception 'You are already in this team';
  end if;

  if exists (select 1 from public.team_members where user_id = target_user_id) then
    raise exception 'This user is already in a team';
  end if;

  insert into public.team_invitations (team_id, invited_user_id, invited_by_user_id)
  values (current_team_id, target_user_id, requesting_user_id);
exception
  when unique_violation then
    raise exception 'This user already has a pending team invitation';
end;
$$;

create or replace function public.respond_to_move_it_team_invitation(
  requesting_user_id uuid,
  requested_invitation_id uuid,
  accept_invitation boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_team_id uuid;
begin
  perform 1 from public.app_users where id = requesting_user_id for update;

  select team_id into invited_team_id
  from public.team_invitations
  where id = requested_invitation_id
    and invited_user_id = requesting_user_id
  for update;

  if invited_team_id is null then
    raise exception 'This team invitation is no longer available';
  end if;

  if accept_invitation then
    if exists (select 1 from public.team_members where user_id = requesting_user_id) then
      raise exception 'You are already in a team';
    end if;

    perform 1 from public.teams where id = invited_team_id for update;

    insert into public.team_members (team_id, user_id)
    values (invited_team_id, requesting_user_id);
  end if;

  delete from public.team_invitations where id = requested_invitation_id;
end;
$$;

create or replace function public.disband_move_it_team(requesting_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_team_id uuid;
begin
  select team_id into current_team_id
  from public.team_members
  where user_id = requesting_user_id;

  if current_team_id is null then
    raise exception 'You are not in a team';
  end if;

  delete from public.teams where id = current_team_id;
end;
$$;

revoke all on function public.create_move_it_team(uuid, text) from public, anon, authenticated;
revoke all on function public.invite_move_it_team_member(uuid, text) from public, anon, authenticated;
revoke all on function public.respond_to_move_it_team_invitation(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.disband_move_it_team(uuid) from public, anon, authenticated;

grant execute on function public.create_move_it_team(uuid, text) to service_role;
grant execute on function public.invite_move_it_team_member(uuid, text) to service_role;
grant execute on function public.respond_to_move_it_team_invitation(uuid, uuid, boolean) to service_role;
grant execute on function public.disband_move_it_team(uuid) to service_role;
