alter table public.conversion_records
  add column other_activity text
  check (
    other_activity is null
    or char_length(other_activity) between 2 and 50
  );

comment on column public.conversion_records.other_activity is
  'User-entered activity name when the generic Other conversion category is used.';
