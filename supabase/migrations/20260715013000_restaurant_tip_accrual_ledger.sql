begin;

create or replace function public.get_restaurant_tip_balances(p_lodge_id uuid, p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['admin','manager']);
  return coalesce((
    with earned as (
      select o.cashier_id as staff_id, coalesce(sum(o.tip_total), 0) as earned
      from public.pos_orders o
      where o.lodge_id = p_lodge_id and o.cashier_id is not null
        and o.created_at >= current_date - greatest(1, least(coalesce(p_days, 30), 365))
        and coalesce(o.status, '') not in ('voided','cancelled') and coalesce(o.tip_total, 0) > 0
      group by o.cashier_id
    ), paid as (
      select p.staff_id, coalesce(sum(p.amount), 0) as paid
      from public.restaurant_tip_payouts p
      where p.lodge_id = p_lodge_id and p.business_date >= current_date - greatest(1, least(coalesce(p_days, 30), 365))
      group by p.staff_id
    )
    select jsonb_agg(jsonb_build_object('staff_id', u.id, 'staff_name', u.name, 'earned', coalesce(e.earned,0), 'paid', coalesce(p.paid,0), 'available', greatest(coalesce(e.earned,0)-coalesce(p.paid,0),0)) order by u.name)
    from public.users u
    left join earned e on e.staff_id = u.id left join paid p on p.staff_id = u.id
    where u.lodge_id = p_lodge_id and u.status = 'active' and (coalesce(e.earned,0) > 0 or coalesce(p.paid,0) > 0)
  ), '[]'::jsonb);
end; $$;

create or replace function public.record_restaurant_tip_payout(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(p_payload->>'lodge_id', '')::uuid; v_staff_id uuid := nullif(p_payload->>'staff_id', '')::uuid;
  v_actor_id uuid := public.app_current_user_id(); v_amount numeric := coalesce(nullif(p_payload->>'amount','')::numeric,0);
  v_method text := lower(nullif(btrim(coalesce(p_payload->>'method','')),'')); v_key text := nullif(btrim(coalesce(p_payload->>'idempotency_key','')), '');
  v_staff public.users%rowtype; v_id uuid; v_earned numeric := 0; v_paid numeric := 0;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin','manager']);
  if v_actor_id is null or not exists (select 1 from public.users where id=v_actor_id and lodge_id=v_lodge_id) then return jsonb_build_object('success',false,'error','Your signed-in staff identity could not be confirmed. Sign in again before recording a payout.'); end if;
  if v_staff_id is null then return jsonb_build_object('success',false,'error','Choose an active staff member for this payout.'); end if;
  if v_amount <= 0 then return jsonb_build_object('success',false,'error','Tip payout amount must be greater than zero.'); end if;
  if v_method not in ('cash','bank','mobile_money') then return jsonb_build_object('success',false,'error','Choose cash, bank, or mobile money as the payout method.'); end if;
  if v_key is null or length(v_key)<8 or length(v_key)>128 then return jsonb_build_object('success',false,'error','This payout needs a valid retry key. Close and reopen the form, then try again.'); end if;
  select id into v_id from public.restaurant_tip_payouts where lodge_id=v_lodge_id and idempotency_key=v_key; if found then return jsonb_build_object('success',true,'id',v_id,'duplicate',true); end if;
  select * into v_staff from public.users where id=v_staff_id and lodge_id=v_lodge_id for key share; if not found or coalesce(v_staff.status,'active') <> 'active' then return jsonb_build_object('success',false,'error','That staff member is no longer active for this business. Refresh the team list and choose an active staff member.'); end if;
  select coalesce(sum(tip_total),0) into v_earned from public.pos_orders where lodge_id=v_lodge_id and cashier_id=v_staff_id and coalesce(status,'') not in ('voided','cancelled') and coalesce(tip_total,0)>0;
  select coalesce(sum(amount),0) into v_paid from public.restaurant_tip_payouts where lodge_id=v_lodge_id and staff_id=v_staff_id;
  if v_amount > greatest(v_earned-v_paid,0) then return jsonb_build_object('success',false,'error',format('Payout exceeds this staff member''s available earned tips (%s).', greatest(v_earned-v_paid,0))); end if;
  insert into public.restaurant_tip_payouts(lodge_id,business_date,staff_id,staff_name,amount,method,reference,notes,paid_by,idempotency_key) values(v_lodge_id,coalesce(nullif(p_payload->>'business_date','')::date,current_date),v_staff.id,coalesce(nullif(btrim(v_staff.name),''),v_staff.email),v_amount,v_method,nullif(btrim(coalesce(p_payload->>'reference','')),''),nullif(btrim(coalesce(p_payload->>'notes','')),''),v_actor_id,v_key) returning id into v_id;
  return jsonb_build_object('success',true,'id',v_id,'available_after',v_earned-v_paid-v_amount);
end; $$;

revoke all on function public.get_restaurant_tip_balances(uuid,integer) from public;
grant execute on function public.get_restaurant_tip_balances(uuid,integer) to authenticated, service_role;
commit;
