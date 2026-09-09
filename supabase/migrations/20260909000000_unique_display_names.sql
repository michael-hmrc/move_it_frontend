create unique index app_users_display_name_unique
  on public.app_users (lower(btrim(display_name)));

comment on index public.app_users_display_name_unique is
  'Display names are unique without regard to case or surrounding whitespace.';
