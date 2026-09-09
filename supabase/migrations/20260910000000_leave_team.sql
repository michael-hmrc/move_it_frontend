create or replace function public.leave_move_it_team(requesting_user_id uuid)
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
  where user_id = requesting_user_id
  for update;

  if current_team_id is null then
    raise exception 'You are not in a team';
  end if;

  delete from public.team_members
  where team_id = current_team_id
    and user_id = requesting_user_id;
end;
$$;

revoke all on function public.leave_move_it_team(uuid) from public, anon, authenticated;
grant execute on function public.leave_move_it_team(uuid) to service_role;
