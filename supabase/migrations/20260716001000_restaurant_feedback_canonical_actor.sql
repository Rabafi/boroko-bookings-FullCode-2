-- Desktop POS uses the application's canonical public.users identity, not
-- auth.uid(). Feedback must retain the accountable staff member.
create or replace function public.record_restaurant_feedback(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := (p_payload->>'lodge_id')::uuid;
  v_actor uuid := public.app_current_user_id();
  v_id uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin','manager','supervisor','cashier']);
  if v_actor is null or not exists (select 1 from public.users where id=v_actor and lodge_id=v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Your staff session could not be verified. Sign in again before recording feedback.');
  end if;
  if nullif(btrim(coalesce(p_payload->>'message','')), '') is null and (p_payload->>'rating') is null then
    return jsonb_build_object('success', false, 'error', 'Feedback needs a rating or a message');
  end if;
  insert into public.restaurant_customer_feedback (lodge_id, customer_id, order_id, rating, channel, message, created_by)
  values (v_lodge_id, nullif(p_payload->>'customer_id','')::uuid, nullif(p_payload->>'order_id','')::uuid,
    nullif(p_payload->>'rating','')::integer, coalesce(nullif(p_payload->>'channel',''), 'in_store'),
    nullif(p_payload->>'message',''), v_actor)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

revoke all on function public.record_restaurant_feedback(jsonb) from public;
grant execute on function public.record_restaurant_feedback(jsonb) to authenticated, service_role;
