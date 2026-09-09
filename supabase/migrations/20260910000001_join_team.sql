create or replace function public.join_move_it_team(
  requesting_user_id uuid,
  requested_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.app_users
  where id = requesting_user_id
  for update;

  if exists (select 1 from public.team_members where user_id = requesting_user_id) then
    raise exception 'You are already in a team';
  end if;

  perform 1 from public.teams
  where id = requested_team_id
  for update;

  if not found then
    raise exception 'This team is no longer available';
  end if;

  insert into public.team_members (team_id, user_id)
  values (requested_team_id, requesting_user_id);

  delete from public.team_invitations
  where invited_user_id = requesting_user_id;
exception
  when unique_violation then
    raise exception 'You are already in a team';
end;
$$;

revoke all on function public.join_move_it_team(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_move_it_team(uuid, uuid) to service_role;
