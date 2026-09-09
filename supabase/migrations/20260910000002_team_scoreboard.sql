create index if not exists conversion_records_user_id_created_at_idx
  on public.conversion_records (user_id, created_at);

create or replace function public.monthly_team_scoreboard(requested_month date)
returns table (
  rank bigint,
  team_id uuid,
  team_name text,
  member_count bigint,
  total_steps bigint,
  activity_count bigint
)
language sql
stable
set search_path = ''
as $$
  with totals as (
    select
      teams.id as team_id,
      teams.name as team_name,
      count(distinct team_members.user_id)::bigint as member_count,
      sum(conversion_records.estimated_steps)::bigint as total_steps,
      count(conversion_records.id)::bigint as activity_count
    from public.teams
    join public.team_members on team_members.team_id = teams.id
    left join public.conversion_records
      on conversion_records.user_id = team_members.user_id
      and conversion_records.created_at >= requested_month::timestamptz
      and conversion_records.created_at < (requested_month + interval '1 month')::timestamptz
    group by teams.id, teams.name
    having count(conversion_records.id) > 0
  )
  select
    rank() over (order by totals.total_steps desc),
    totals.team_id,
    totals.team_name,
    totals.member_count,
    totals.total_steps,
    totals.activity_count
  from totals
  order by totals.total_steps desc, totals.team_name asc;
$$;

revoke all on function public.monthly_team_scoreboard(date) from public, anon, authenticated;
grant execute on function public.monthly_team_scoreboard(date) to service_role;
