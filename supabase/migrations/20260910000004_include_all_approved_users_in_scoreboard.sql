create or replace function public.monthly_scoreboard(requested_month date)
returns table (
  rank bigint,
  display_name text,
  total_steps bigint,
  activity_count bigint
)
language sql
stable
set search_path = ''
as $$
  with totals as (
    select
      app_users.id as user_id,
      app_users.display_name,
      coalesce(sum(conversion_records.estimated_steps), 0)::bigint as total_steps,
      count(conversion_records.id)::bigint as activity_count
    from public.app_users
    left join public.conversion_records
      on conversion_records.user_id = app_users.id
      and conversion_records.created_at >= requested_month::timestamptz
      and conversion_records.created_at < (requested_month + interval '1 month')::timestamptz
    where app_users.status = 'approved'
    group by app_users.id, app_users.display_name
  )
  select
    rank() over (order by totals.total_steps desc),
    totals.display_name,
    totals.total_steps,
    totals.activity_count
  from totals
  order by totals.total_steps desc, totals.display_name asc;
$$;

revoke all on function public.monthly_scoreboard(date) from public, anon, authenticated;
grant execute on function public.monthly_scoreboard(date) to service_role;
