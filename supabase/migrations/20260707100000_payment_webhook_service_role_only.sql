-- Payment webhooks are provider/server events, not desktop operator actions.
-- Keep signature verification inspectable, but restrict webhook recording to service-role infrastructure.

revoke all on function public.record_webhook_payment(uuid, jsonb, text, text) from authenticated;
revoke all on function public.record_webhook_payment(uuid, jsonb, text, text) from anon;
grant execute on function public.record_webhook_payment(uuid, jsonb, text, text) to service_role;
