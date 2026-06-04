begin;

create or replace function public.app_require_pos_outlet_access(
  p_lodge_id uuid,
  p_outlet_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session public.app_sessions%rowtype;
  v_role text;
  v_allowed_outlet_ids uuid[];
begin
  if public.app_is_service_role() then
    return;
  end if;

  v_session := public.app_current_session_row();

  if v_session.id is null then
    raise exception 'A valid app session is required.'
      using errcode = '42501';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied for this lodge.'
      using errcode = '42501';
  end if;

  v_role := lower(coalesce(v_session.role, ''));

  if v_role in ('manager', 'admin', 'super_admin') then
    return;
  end if;

  if v_role not in ('cashier', 'supervisor') then
    raise exception 'This session is not allowed to access POS outlets.'
      using errcode = '42501';
  end if;

  if p_outlet_id is null then
    raise exception 'This action requires an outlet context.'
      using errcode = '42501';
  end if;

  select coalesce(u.allowed_outlet_ids, '{}'::uuid[])
    into v_allowed_outlet_ids
    from public.users u
   where u.id = v_session.user_id
     and u.lodge_id = p_lodge_id;

  if not coalesce(p_outlet_id = any(v_allowed_outlet_ids), false) then
    raise exception 'This session is not allowed to access that outlet.'
      using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.app_require_pos_outlet_access(uuid, uuid) from public;

create or replace function public.create_user(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id         uuid;
  v_email      text;
  v_outlet_ids uuid[];
  v_lodge_id   uuid := (payload->>'lodge_id')::uuid;
begin
  if exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
  ) then
    perform public.app_require_lodge_role(v_lodge_id, array['admin', 'manager', 'super_admin']);
  end if;

  v_email := lower(btrim(coalesce(payload->>'email', '')));

  if exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
       and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object(
      'success', false,
      'error',   format('A user with the email "%s" already exists in this lodge.', v_email)
    );
  end if;

  select coalesce(array_agg(elem::uuid), '{}'::uuid[])
    into v_outlet_ids
    from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  if lower(coalesce(payload->>'role', 'receptionist')) in ('cashier', 'supervisor')
     and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object(
      'success', false,
      'error',   'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

  insert into public.users (
    id,
    lodge_id,
    name,
    email,
    password_hash,
    role,
    allowed_outlet_ids,
    pin_hash
  ) values (
    (payload->>'id')::uuid,
    v_lodge_id,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    coalesce(payload->>'role', 'receptionist'),
    v_outlet_ids,
    nullif(payload->>'pin_hash', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_user(jsonb) from public;
grant execute on function public.create_user(jsonb) to anon, authenticated;

create or replace function public.update_user_profile(
  p_id       uuid,
  p_lodge_id uuid,
  payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated         uuid;
  v_email           text;
  v_outlet_ids      uuid[];
  v_current_role    text;
  v_current_outlets uuid[];
  v_pin_hash        text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager', 'super_admin']);

  if payload ? 'email' then
    v_email := lower(btrim(coalesce(payload->>'email', '')));
    if exists (
      select 1 from public.users
       where lodge_id = p_lodge_id
         and lower(btrim(email)) = v_email
         and id <> p_id
    ) then
      return jsonb_build_object(
        'success', false,
        'error',   format('A user with the email "%s" already exists.', v_email)
      );
    end if;
  end if;

  if payload ? 'allowed_outlet_ids' then
    select coalesce(array_agg(elem::uuid), '{}'::uuid[])
      into v_outlet_ids
      from jsonb_array_elements_text(payload->'allowed_outlet_ids') as elem;
  end if;

  select role, allowed_outlet_ids
    into v_current_role, v_current_outlets
    from public.users
   where id = p_id and lodge_id = p_lodge_id;

  if lower(coalesce(nullif(payload->>'role', ''), v_current_role, '')) in ('cashier', 'supervisor')
     and cardinality(coalesce(
           case when payload ? 'allowed_outlet_ids' then v_outlet_ids
                else v_current_outlets
           end,
           '{}'::uuid[]
         )) = 0 then
    return jsonb_build_object(
      'success', false,
      'error',   'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

  if payload ? 'pin_hash' then
    v_pin_hash := nullif(payload->>'pin_hash', '');
  end if;

  update public.users
     set name = coalesce(nullif(payload->>'name', ''), name),
         email = coalesce(v_email, email),
         role = coalesce(nullif(payload->>'role', ''), role),
         pin_hash = case when payload ? 'pin_hash' then v_pin_hash else pin_hash end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if payload ? 'allowed_outlet_ids' then
    update public.users
       set allowed_outlet_ids = v_outlet_ids
     where id = p_id
       and lodge_id = p_lodge_id;
  end if;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found.');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

revoke all on function public.update_user_profile(uuid, uuid, jsonb) from public;
grant execute on function public.update_user_profile(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.create_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  insert into public.expenses (
    lodge_id,
    date,
    category,
    description,
    amount,
    outlet_id
  ) values (
    v_lodge_id,
    (payload->>'date')::date,
    payload->>'category',
    payload->>'description',
    coalesce((payload->>'amount')::numeric, 0),
    nullif(payload->>'outlet_id', '')::uuid
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_expense(jsonb) from public;
grant execute on function public.create_expense(jsonb) to anon, authenticated;

create or replace function public.update_expense(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  update public.expenses
  set
    date        = case when payload ? 'date'        then (payload->>'date')::date                    else date        end,
    category    = case when payload ? 'category'    then payload->>'category'                        else category    end,
    description = case when payload ? 'description' then payload->>'description'                     else description end,
    amount      = case when payload ? 'amount'      then coalesce((payload->>'amount')::numeric, 0) else amount      end,
    outlet_id   = case when payload ? 'outlet_id'   then nullif(payload->>'outlet_id', '')::uuid    else outlet_id   end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Expense not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

revoke all on function public.update_expense(uuid, uuid, jsonb) from public;
grant execute on function public.update_expense(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_expense(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  delete from public.expenses
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Expense not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

revoke all on function public.delete_expense(uuid, uuid) from public;
grant execute on function public.delete_expense(uuid, uuid) to anon, authenticated;

create or replace function public.create_pos_menu_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  insert into public.pos_menu_items (
    lodge_id,
    name,
    category,
    price,
    is_available,
    barcode,
    inventory_item_id,
    depletion_qty,
    outlet_id
  ) values (
    v_lodge_id,
    payload->>'name',
    coalesce(payload->>'category', 'Other'),
    coalesce((payload->>'price')::numeric, 0),
    coalesce((payload->>'is_available')::boolean, true),
    nullif(payload->>'barcode', ''),
    nullif(payload->>'inventory_item_id', '')::uuid,
    case
      when nullif(payload->>'inventory_item_id', '') is null then null
      else coalesce((payload->>'depletion_qty')::numeric, 1)
    end,
    nullif(payload->>'outlet_id', '')::uuid
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_pos_menu_item(jsonb) from public;
grant execute on function public.create_pos_menu_item(jsonb) to anon, authenticated;

create or replace function public.update_pos_menu_item(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  update public.pos_menu_items
  set
    name              = case when payload ? 'name' then payload->>'name' else name end,
    category          = case when payload ? 'category' then coalesce(payload->>'category', 'Other') else category end,
    price             = case when payload ? 'price' then coalesce((payload->>'price')::numeric, 0) else price end,
    is_available      = case when payload ? 'is_available' then coalesce((payload->>'is_available')::boolean, true) else is_available end,
    barcode           = case when payload ? 'barcode' then nullif(payload->>'barcode', '') else barcode end,
    inventory_item_id = case when payload ? 'inventory_item_id' then nullif(payload->>'inventory_item_id', '')::uuid else inventory_item_id end,
    depletion_qty     = case
                          when payload ? 'inventory_item_id' then
                            case
                              when nullif(payload->>'inventory_item_id', '') is null then null
                              else coalesce((payload->>'depletion_qty')::numeric, 1)
                            end
                          when payload ? 'depletion_qty' then coalesce((payload->>'depletion_qty')::numeric, 1)
                          else depletion_qty
                        end,
    outlet_id         = case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else outlet_id end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

revoke all on function public.update_pos_menu_item(uuid, uuid, jsonb) from public;
grant execute on function public.update_pos_menu_item(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_pos_menu_item(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  delete from public.pos_menu_items
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

revoke all on function public.delete_pos_menu_item(uuid, uuid) from public;
grant execute on function public.delete_pos_menu_item(uuid, uuid) to anon, authenticated;

create or replace function public.create_pos_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id        uuid    := gen_random_uuid();
  v_lodge_id        uuid    := (payload->>'lodge_id')::uuid;
  v_outlet_id       uuid    := nullif(payload->>'outlet_id', '')::uuid;
  v_item            jsonb;
  v_menu_item_id    uuid;
  v_inv_item_id     uuid;
  v_depletion_qty   numeric;
  v_quantity        numeric;
  v_db_price        numeric;
  v_unit_price      numeric;
  v_computed_total  numeric := 0;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name,
    total, notes, payment_method, outlet_id, status
  ) values (
    v_order_id,
    v_lodge_id,
    nullif(payload->>'room_id', '')::uuid,
    nullif(payload->>'booking_id', '')::uuid,
    nullif(payload->>'walk_in_name', ''),
    0,
    nullif(payload->>'notes', ''),
    coalesce(nullif(payload->>'payment_method', ''), 'cash'),
    v_outlet_id,
    'completed'
  );

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity     := coalesce((v_item->>'quantity')::numeric, 1);

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             coalesce(depletion_qty, 1)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if not found then
        raise exception
          'POS menu item % not found for lodge % — order rejected',
          v_menu_item_id, v_lodge_id;
      end if;

      v_unit_price := v_db_price;
    else
      v_unit_price    := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id   := null;
      v_depletion_qty := 1;
    end if;

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id,
      item_name, quantity, unit_price, subtotal
    ) values (
      gen_random_uuid(),
      v_order_id,
      v_lodge_id,
      v_menu_item_id,
      v_item->>'item_name',
      v_quantity,
      v_unit_price,
      v_quantity * v_unit_price
    );

    v_computed_total := v_computed_total + (v_quantity * v_unit_price);

    if v_inv_item_id is not null then
      update public.inventory_items
         set current_stock = greatest(0, coalesce(current_stock, 0)
                                        - (v_depletion_qty * v_quantity))
       where id = v_inv_item_id
         and lodge_id = v_lodge_id;
    end if;
  end loop;

  update public.pos_orders
     set total = v_computed_total
   where id = v_order_id;

  return jsonb_build_object(
    'success', true,
    'id',      v_order_id,
    'total',   v_computed_total
  );
end;
$function$;

revoke all on function public.create_pos_order(jsonb) from public;
grant execute on function public.create_pos_order(jsonb) to anon, authenticated;

create or replace function public.void_pos_order(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_outlet_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin']);

  select status, outlet_id
    into v_status, v_outlet_id
    from public.pos_orders
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  perform public.app_require_pos_outlet_access(p_lodge_id, v_outlet_id);

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  update public.pos_orders
     set status = 'voided'
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id);
end;
$function$;

revoke all on function public.void_pos_order(uuid, uuid) from public;
grant execute on function public.void_pos_order(uuid, uuid) to anon, authenticated;

create or replace function public.approve_pos_void_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id        uuid := (payload->>'order_id')::uuid;
  v_lodge_id        uuid := (payload->>'lodge_id')::uuid;
  v_requested_by    uuid := public.app_current_user_id();
  v_approved_by     uuid := nullif(payload->>'approved_by', '')::uuid;
  v_reason          text := nullif(payload->>'reason', '');
  v_payload_outlet  uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_order_outlet_id uuid;
  v_status          text;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select status, outlet_id
    into v_status, v_order_outlet_id
    from public.pos_orders
   where id = v_order_id
     and lodge_id = v_lodge_id
   for update;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  perform public.app_require_pos_outlet_access(v_lodge_id, coalesce(v_order_outlet_id, v_payload_outlet));

  if not exists (
    select 1
      from public.users u
     where u.id = v_approved_by
       and u.lodge_id = v_lodge_id
       and lower(coalesce(u.role, '')) in ('supervisor', 'manager', 'admin', 'super_admin')
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid approver');
  end if;

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  update public.pos_orders
     set status = 'voided'
   where id = v_order_id
     and lodge_id = v_lodge_id;

  insert into public.pos_override_log (
    lodge_id,
    order_id,
    action,
    requested_by,
    approved_by,
    reason,
    outlet_id
  ) values (
    v_lodge_id,
    v_order_id,
    'void',
    v_requested_by,
    v_approved_by,
    v_reason,
    coalesce(v_order_outlet_id, v_payload_outlet)
  );

  return jsonb_build_object('success', true, 'id', v_order_id);
end;
$function$;

revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated;

create or replace function public.create_inventory_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  insert into public.inventory_items (
    lodge_id,
    name,
    category,
    unit,
    current_stock,
    reorder_level,
    latest_unit_cost,
    outlet_id
  ) values (
    v_lodge_id,
    payload->>'name',
    coalesce(payload->>'category', 'Bar'),
    coalesce(payload->>'unit', 'unit'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
    coalesce((payload->>'latest_unit_cost')::numeric, 0),
    nullif(payload->>'outlet_id', '')::uuid
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_inventory_item(jsonb) from public;
grant execute on function public.create_inventory_item(jsonb) to anon, authenticated;

create or replace function public.update_inventory_item(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  update public.inventory_items
  set
    name          = case when payload ? 'name' then payload->>'name' else name end,
    category      = case when payload ? 'category' then payload->>'category' else category end,
    unit          = case when payload ? 'unit' then payload->>'unit' else unit end,
    reorder_level = case when payload ? 'reorder_level' then coalesce((payload->>'reorder_level')::numeric, 0) else reorder_level end,
    outlet_id     = case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else outlet_id end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

revoke all on function public.update_inventory_item(uuid, uuid, jsonb) from public;
grant execute on function public.update_inventory_item(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_inventory_item(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  delete from public.inventory_purchases
   where item_id = p_id
     and lodge_id = p_lodge_id;

  delete from public.inventory_items
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

revoke all on function public.delete_inventory_item(uuid, uuid) from public;
grant execute on function public.delete_inventory_item(uuid, uuid) to anon, authenticated;

create or replace function public.add_inventory_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_purchase_id uuid;
  v_item_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric;
  v_total numeric;
  v_unit_cost numeric;
  v_new_stock numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  v_item_id := (payload->>'item_id')::uuid;
  v_qty := coalesce((payload->>'quantity_purchased')::numeric, 0);
  v_total := coalesce((payload->>'total_cost')::numeric, 0);
  v_unit_cost := coalesce((payload->>'unit_cost')::numeric, case when v_qty > 0 then v_total / v_qty else 0 end);

  insert into public.inventory_purchases (
    lodge_id,
    item_id,
    date,
    quantity_purchased,
    total_cost,
    unit_cost,
    notes
  ) values (
    v_lodge_id,
    v_item_id,
    (payload->>'date')::date,
    v_qty,
    v_total,
    v_unit_cost,
    nullif(payload->>'notes', '')
  )
  returning id into v_purchase_id;

  update public.inventory_items
     set current_stock = coalesce(current_stock, 0) + v_qty,
         latest_unit_cost = v_unit_cost
   where id = v_item_id
     and lodge_id = v_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'Inventory item not found';
  end if;

  return jsonb_build_object('success', true, 'id', v_purchase_id, 'new_stock', v_new_stock);
end;
$function$;

revoke all on function public.add_inventory_purchase(jsonb) from public;
grant execute on function public.add_inventory_purchase(jsonb) to anon, authenticated;

create or replace function public.adjust_inventory_stock(
  p_item_id uuid,
  p_lodge_id uuid,
  p_delta numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_stock numeric;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  update public.inventory_items
     set current_stock = greatest(0, coalesce(current_stock, 0) + coalesce(p_delta, 0))
   where id = p_item_id
     and lodge_id = p_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  return jsonb_build_object('success', true, 'new_stock', v_new_stock);
end;
$function$;

revoke all on function public.adjust_inventory_stock(uuid, uuid, numeric, text) from public;
grant execute on function public.adjust_inventory_stock(uuid, uuid, numeric, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
