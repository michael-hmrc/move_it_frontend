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
      conversion_records.user_id,
      coalesce(app_users.display_name, conversion_records.display_name) as display_name,
      sum(conversion_records.estimated_steps)::bigint as total_steps,
      count(*)::bigint as activity_count
    from public.conversion_records
    left join public.app_users on app_users.id = conversion_records.user_id
    where conversion_records.created_at >= requested_month::timestamptz
      and conversion_records.created_at < (requested_month + interval '1 month')::timestamptz
    group by conversion_records.user_id, app_users.display_name, conversion_records.display_name
  )
  select
    rank() over (order by totals.total_steps desc),
    totals.display_name,
    totals.total_steps,
    totals.activity_count
  from totals
  order by totals.total_steps desc, totals.display_name asc;
$$;
