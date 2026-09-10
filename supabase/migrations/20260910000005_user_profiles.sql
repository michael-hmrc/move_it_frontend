create or replace function public.move_it_user_profile(requested_display_name text)
returns table (
  display_name text,
  total_duration_minutes bigint,
  total_steps bigint,
  most_frequent_activity text,
  team_id uuid,
  team_name text
)
language sql
stable
set search_path = ''
as $$
  select
    app_users.display_name,
    activity_totals.total_duration_minutes,
    activity_totals.total_steps,
    frequent_activity.name as most_frequent_activity,
    teams.id as team_id,
    teams.name as team_name
  from public.app_users
  left join lateral (
    select
      coalesce(sum(conversion_records.duration_minutes), 0)::bigint as total_duration_minutes,
      coalesce(sum(conversion_records.estimated_steps), 0)::bigint as total_steps
    from public.conversion_records
    where conversion_records.user_id = app_users.id
  ) as activity_totals on true
  left join lateral (
      select coalesce(conversion_records.other_activity, conversion_records.activity) as name
      from public.conversion_records
      where conversion_records.user_id = app_users.id
      group by coalesce(conversion_records.other_activity, conversion_records.activity)
      order by count(*) desc, coalesce(conversion_records.other_activity, conversion_records.activity) asc
      limit 1
  ) as frequent_activity on true
  left join public.team_members on team_members.user_id = app_users.id
  left join public.teams on teams.id = team_members.team_id
  where lower(btrim(app_users.display_name)) = lower(btrim(requested_display_name))
    and app_users.status = 'approved'
  limit 1;
$$;

revoke all on function public.move_it_user_profile(text) from public, anon, authenticated;
grant execute on function public.move_it_user_profile(text) to service_role;
