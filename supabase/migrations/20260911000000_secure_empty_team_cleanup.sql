-- Auth deletes cascade to team_members. Run the empty-team cleanup with the
-- function owner's privileges so Supabase's auth role can complete the delete.
alter function public.remove_empty_team() security definer;
