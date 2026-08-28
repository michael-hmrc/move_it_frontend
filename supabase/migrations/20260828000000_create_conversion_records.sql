create table public.conversion_records (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 2 and 40),
  activity text not null,
  intensity text not null check (intensity in ('light', 'moderate', 'vigorous')),
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  estimated_steps integer not null check (estimated_steps >= 0),
  created_at timestamptz not null default now()
);

alter table public.conversion_records enable row level security;

comment on table public.conversion_records is
  'Anonymous activity-to-step conversions written by the server.';

-- No public policies are intentional. The Vercel server writes with the
-- server-only Supabase secret key; browser clients cannot access this table.

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
      conversion_records.display_name,
      sum(conversion_records.estimated_steps)::bigint as total_steps,
      count(*)::bigint as activity_count
    from public.conversion_records
    where conversion_records.created_at >= requested_month::timestamptz
      and conversion_records.created_at < (requested_month + interval '1 month')::timestamptz
    group by conversion_records.display_name
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
