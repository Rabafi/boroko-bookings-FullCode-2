-- Allow an assigned waiter to settle a still-open Bar tab during a later
-- open Till shift. The tab's shift_id is historical ownership evidence from
-- when it was opened; the payment payload's shift_id is the authoritative
-- current shift that receives the new order and tender.

begin;

create or replace function public._pos_tab_settlement_owner_error(p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tab_id uuid := nullif(p_payload->>'tab_id', '')::uuid;
  v_lodge uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_outlet uuid := nullif(p_payload->>'outlet_id', '')::uuid;
  v_payment_shift uuid := nullif(p_payload->>'shift_id', '')::uuid;
  v_tab public.pos_tabs%rowtype;
  v_actor uuid := public.app_current_user_id();
  v_operator uuid;
  v_operator_proof text := nullif(p_payload->>'_operator_proof', '');
  v_error text;
begin
  if v_tab_id is null then
    return null;
  end if;

  select * into v_tab
    from public.pos_tabs
   where id = v_tab_id and lodge_id = v_lodge
   for update;
  if not found then
    return 'The selected open tab is missing or belongs to another lodge.';
  end if;
  if not public._pos_tab_is_bar_scope(v_tab.lodge_id) then
    return null;
  end if;
  if v_payment_shift is null then
    return 'Start or select the current open Till shift before settling this tab.';
  end if;

  -- Validate the opaque proof against the shift receiving this payment. A
  -- tab may legitimately remain open after its original shift has closed.
  if v_operator_proof is not null then
    v_operator := public._pos_operator_proof_staff(
      v_operator_proof,
      v_tab.lodge_id,
      v_tab.outlet_id,
      v_payment_shift,
      v_actor
    );
    if v_operator is null then
      return 'The shared Till operator proof is missing or expired. Unlock Till again before settling this tab.';
    end if;
  else
    v_operator := v_actor;
  end if;

  if v_tab.waiter_id is null or v_tab.waiter_id is distinct from v_operator then
    return 'Only the assigned waiter can settle this tab. Ask that waiter to transfer it first.';
  end if;
  if v_tab.outlet_id is distinct from v_outlet then
    return 'The selected tab belongs to another outlet. Refresh open tabs before settling it.';
  end if;

  -- Require the assigned waiter to own the current payment shift. Keep the
  -- tab's original shift untouched for audit/history.
  v_error := public._pos_tab_active_waiter_error(
    v_tab.lodge_id,
    v_tab.outlet_id,
    v_tab.waiter_id,
    v_payment_shift
  );
  return v_error;
end;
$$;

revoke all on function public._pos_tab_settlement_owner_error(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public._pos_tab_settlement_owner_error(jsonb) to service_role;

do $verify$
declare
  v_definition text;
begin
  select pg_get_functiondef('public._pos_tab_settlement_owner_error(jsonb)'::regprocedure)
    into v_definition;
  if position('v_payment_shift uuid' in v_definition) = 0
     or position('v_payment_shift,' in v_definition) = 0 then
    raise exception 'Current payment-shift Till proof validation was not installed';
  end if;
  if position('v_tab.shift_id' in v_definition) > 0 then
    raise exception 'Settlement still validates against the tab opening shift';
  end if;
end
$verify$;

commit;
