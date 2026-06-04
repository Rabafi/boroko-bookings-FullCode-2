begin;

revoke all on function public.record_invoice_delivery(uuid, uuid, text, text, text, text, text, text, uuid, jsonb) from public;
grant execute on function public.record_invoice_delivery(uuid, uuid, text, text, text, text, text, text, uuid, jsonb) to anon, authenticated, service_role;

revoke all on function public.get_invoice_delivery_history(uuid, uuid, int) from public;
grant execute on function public.get_invoice_delivery_history(uuid, uuid, int) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
