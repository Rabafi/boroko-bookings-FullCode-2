-- Restore Supabase anon-key RPC execution for the desktop staff-session path.
-- Every public entry point still resolves its actor, lodge, capability, and role
-- in server code; unauthenticated/no-session callers remain denied there.
begin;

grant execute on function public.get_restaurant_budget_matrix_v2(uuid,integer) to anon;
grant execute on function public.create_and_submit_restaurant_manual_journal_v2(uuid,date,text,text,jsonb,text,uuid) to anon;
grant execute on function public.get_restaurant_manual_journal_submission_status_v2(uuid,uuid) to anon;
grant execute on function public.get_restaurant_ap_export_v3(uuid,jsonb), public.get_restaurant_bank_export_v3(uuid,jsonb), public.get_restaurant_tax_export_v3(uuid,jsonb) to anon;

commit;
