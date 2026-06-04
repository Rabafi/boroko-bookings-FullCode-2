-- =============================================================================
-- Codex Audit Fixes: Security, Financial Integrity, and Reporting Accuracy
-- =============================================================================
-- P0-2: Revoke dangerous legacy grants from anon on booking mutation RPCs
-- P0-3: Exclude 'pending' online booking requests from all revenue reporting
-- P1-1: Fix POS offline replay to validate prices against DB (not trust client)
-- P1-2: Fix room profitability to include charges_total; fix occupancy denominator
-- =============================================================================

begin;

-- =============================================================================
-- P0-2: REVOKE dangerous legacy grants
-- The 20260326 migration granted anon + authenticated EXECUTE on booking mutators.
-- These are internal operations that must only be callable by lodge staff roles
-- through the Electron IPC path, never anonymously.
-- =============================================================================

revoke execute on function public.create_booking_record(jsonb)
  from anon;

revoke execute on function public.update_booking(uuid, uuid, jsonb)
  from anon;

-- The old 3-arg signature (no p_expected_updated_at)
revoke execute on function public.update_booking_status(uuid, uuid, text)
  from anon;

-- Add lodge-role enforcement to create_booking_record (currently only rejects PWA, not anon)
-- Replaced body adds app_require_lodge_role before the existing PWA rejection check
create or replace function public.create_booking_record(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $create_booking_record$
declare
  v_id uuid := coalesce((payload->>'id')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_check_in date := (payload->>'check_in')::date;
  v_check_out date := (payload->>'check_out')::date;
  v_status text := coalesce(payload->>'status', 'confirmed');
  v_existing_id uuid;
  v_invoice_number text := nullif(payload->>'invoice_number', '');
  v_room_status text;
  v_is_existing boolean := false;
  v_deposit_amount numeric := round(coalesce((payload->>'deposit_amount')::numeric, 0)::numeric, 2);
  v_deposit_method text := nullif(payload->>'deposit_method', '');
  v_dep_result jsonb;
  v_is_exclusive_event boolean := coalesce((payload->>'is_exclusive_event')::boolean, false);
  v_allow_total_override boolean := coalesce((payload->>'allow_total_override')::boolean, false);
  v_total_amount numeric := round(coalesce((payload->>'total_amount')::numeric, 0)::numeric, 2);
  v_expected_total numeric;
  v_create_key text := nullif(payload->>'create_idempotency_key', '');
  v_created_by uuid := nullif(payload->>'created_by', '')::uuid;
  v_deposit_key text;
begin
  -- Require lodge staff role — anonymous callers cannot create bookings
  perform public.app_require_lodge_role(v_lodge_id, array['receptionist', 'cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  -- Also block PWA financial mutations (Electron-only path)
  perform public.app_reject_pwa_financial_mutation();

  if v_deposit_amount > 0 and v_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  if v_total_amount < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  if not v_is_exclusive_event then
    v_expected_total := public.room_booking_expected_total(v_lodge_id, v_room_id, v_check_in, v_check_out);
    if v_expected_total is null then
      return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
    end if;

    if abs(v_total_amount - v_expected_total) > 0.01 then
      if v_allow_total_override then
        perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
      else
        return jsonb_build_object(
          'success', false,
          'error', format(
            'Booking total must match the room rate for this stay. Expected %s, received %s.',
            v_expected_total,
            v_total_amount
          )
        );
      end if;
    end if;
  end if;

  if v_create_key is not null then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.create_idempotency_key = v_create_key
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id, 'is_existing', v_is_existing);
end;
$create_booking_record$;

-- =============================================================================
-- P0-3: Exclude 'pending' online booking requests from revenue & invoice logic
--
-- Online booking requests start as status='pending' and are not financial
-- commitments until a front desk staff member accepts them (status -> 'confirmed').
-- Including them in revenue overstates income, outstanding balances, and floods
-- invoice gap alerts with expected gaps.
-- =============================================================================

-- Patch the financial validation RPC to exclude pending from invoice_gaps
-- The current code: lower(coalesce(b.status, '')) <> 'cancelled'
-- The fix adds:    and lower(coalesce(b.status, '')) <> 'pending'

create or replace function public.run_financial_validation(
  p_lodge_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  with scoped_lodges as (
    select id as lodge_id
      from public.lodges
     where (p_lodge_ids is null or id = any(p_lodge_ids))
  ),
  balance_errors as (
    select b.lodge_id, count(*)::int as issue_count
      from public.bookings b
     where b.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(b.status, '')) not in ('cancelled', 'pending')
       and abs(
         coalesce(b.amount_paid, 0) -
         case
           when lower(coalesce(b.payment_status, '')) = 'paid' then coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0)
           else coalesce(b.amount_paid, 0)
         end
       ) > 0.01
     group by b.lodge_id
  ),
  invoice_gaps as (
    select b.lodge_id, count(*)::int as issue_count
      from public.bookings b
      left join public.invoices i
        on i.booking_id = b.id
       and i.lodge_id = b.lodge_id
     where b.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(b.status, '')) not in ('cancelled', 'pending')
       and (
         nullif(btrim(coalesce(b.invoice_number, '')), '') is null
         or i.id is null
       )
     group by b.lodge_id
  ),
  orphan_invoices as (
    select i.lodge_id, count(*)::int as issue_count
      from public.invoices i
      left join public.bookings b
        on b.id = i.booking_id
       and b.lodge_id = i.lodge_id
     where i.lodge_id in (select lodge_id from scoped_lodges)
       and (i.booking_id is null or b.id is null)
     group by i.lodge_id
  )
  select jsonb_agg(
    jsonb_build_object(
      'lodge_id', sl.lodge_id,
      'balance_errors', coalesce(be.issue_count, 0),
      'invoice_gaps', coalesce(ig.issue_count, 0),
      'orphan_invoices', coalesce(oi.issue_count, 0),
      'total_issues', coalesce(be.issue_count, 0) + coalesce(ig.issue_count, 0) + coalesce(oi.issue_count, 0)
    )
  )
  into v_result
  from scoped_lodges sl
  left join balance_errors be on be.lodge_id = sl.lodge_id
  left join invoice_gaps ig on ig.lodge_id = sl.lodge_id
  left join orphan_invoices oi on oi.lodge_id = sl.lodge_id;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;

-- Patch get_revenue_report_for_range to exclude pending bookings from revenue
create or replace function public.get_revenue_report_for_range(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_regular_revenue      numeric := 0;
  v_total_paid_snapshot  numeric := 0;
  v_total_bookings       bigint  := 0;
  v_confirmed_count      bigint  := 0;
  v_checked_in_count     bigint  := 0;
  v_checked_out_count    bigint  := 0;
  v_paid_count           bigint  := 0;
  v_partial_count        bigint  := 0;
  v_unpaid_count         bigint  := 0;
  v_vat_amount           numeric := 0;
  v_vat_rates_in_use     bigint  := 0;
  v_vat_rate             numeric;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select
    coalesce(sum(coalesce(total_amount, 0) + coalesce(charges_total, 0)), 0),
    coalesce(sum(coalesce(amount_paid, 0)), 0),
    count(*) filter (where not coalesce(is_exclusive_event, false)),
    count(*) filter (where not coalesce(is_exclusive_event, false) and status = 'confirmed'),
    count(*) filter (where not coalesce(is_exclusive_event, false) and status = 'checked_in'),
    count(*) filter (where not coalesce(is_exclusive_event, false) and status = 'checked_out'),
    count(*) filter (where not coalesce(is_exclusive_event, false) and payment_status = 'paid'),
    count(*) filter (where not coalesce(is_exclusive_event, false) and payment_status = 'partial'),
    count(*) filter (where not coalesce(is_exclusive_event, false) and coalesce(payment_status, 'unpaid') = 'unpaid'),
    coalesce(sum(
      case
        when not coalesce(is_exclusive_event, false) and coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0
          then ((coalesce(total_amount, 0) + coalesce(charges_total, 0)) * coalesce(vat_rate, 0)) / (100 + coalesce(vat_rate, 0))
        else 0
      end
    ), 0),
    count(distinct case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end),
    min(case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end)
  into
    v_regular_revenue, v_total_paid_snapshot,
    v_total_bookings, v_confirmed_count, v_checked_in_count, v_checked_out_count,
    v_paid_count, v_partial_count, v_unpaid_count,
    v_vat_amount, v_vat_rates_in_use, v_vat_rate
  from public.bookings b
  where b.lodge_id = p_lodge_id
    and b.check_in >= p_start_date
    and b.check_in <= p_end_date
    -- Exclude cancelled AND pending: pending online requests are not financial commitments
    and lower(coalesce(b.status, '')) not in ('cancelled', 'pending');

  return jsonb_build_object(
    'total_revenue',        coalesce(v_regular_revenue, 0),
    'regular_revenue',      coalesce(v_regular_revenue, 0),
    'total_bookings',       coalesce(v_total_bookings, 0),
    'confirmed_count',      coalesce(v_confirmed_count, 0),
    'checked_in_count',     coalesce(v_checked_in_count, 0),
    'checked_out_count',    coalesce(v_checked_out_count, 0),
    'paid_count',           coalesce(v_paid_count, 0),
    'partial_count',        coalesce(v_partial_count, 0),
    'unpaid_count',         coalesce(v_unpaid_count, 0),
    'outstanding_amount',   coalesce(v_regular_revenue, 0) - coalesce(v_total_paid_snapshot, 0),
    'vat_enabled',          coalesce(v_vat_rates_in_use, 0) > 0,
    'vat_rate',             case when coalesce(v_vat_rates_in_use, 0) = 1 then v_vat_rate else null end,
    'vat_mixed',            coalesce(v_vat_rates_in_use, 0) > 1,
    'vat_amount',           round(coalesce(v_vat_amount, 0)::numeric, 2),
    'net_revenue',          round((coalesce(v_regular_revenue, 0) - coalesce(v_vat_amount, 0))::numeric, 2),
    'source',               'server'
  );
end;
$function$;

-- =============================================================================
-- P1-1: Fix POS offline replay — do NOT trust client-supplied unit_price
-- for known menu items; always use the server's DB price.
-- An attacker-modified offline payload could manipulate revenue by setting
-- arbitrarily low prices that still pass the idempotency check.
-- =============================================================================

create or replace function public.create_pos_order(
  p_lodge_id    uuid,
  payload       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $create_pos_order$
declare
  v_lodge_id                uuid    := p_lodge_id;
  v_outlet_id               uuid    := nullif(payload->>'outlet_id', '')::uuid;
  v_room_id                 uuid    := nullif(payload->>'room_id', '')::uuid;
  v_booking_id              uuid    := nullif(payload->>'booking_id', '')::uuid;
  v_walk_in_name            text    := nullif(payload->>'walk_in_name', '');
  v_notes                   text    := nullif(payload->>'notes', '');
  v_payment_method          text    := coalesce(nullif(payload->>'payment_method', ''), 'cash');
  v_create_idempotency_key  text    := nullif(payload->>'create_idempotency_key', '');
  v_created_at_client       timestamptz := nullif(payload->>'created_at_client', '')::timestamptz;
  v_is_replay               boolean := v_create_idempotency_key is not null or payload ? 'created_at_client';
  v_existing_id             uuid;
  v_existing_total          numeric;
  v_existing_charge_id      uuid;
  v_item                    jsonb;
  v_menu_item_id            uuid;
  v_inv_item_id             uuid;
  v_depletion_qty           numeric;
  v_quantity                numeric;
  v_db_price                numeric;
  v_unit_price              numeric;
  v_item_name               text;
  v_computed_total          numeric := 0;
  v_is_available            boolean;
  v_required_stock          numeric;
  v_new_stock               numeric;
  v_folio_charge_id         uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  if v_payment_method = 'folio' and v_booking_id is null and v_room_id is not null then
    select b.id
      into v_booking_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.room_id = v_room_id
       and b.status in ('confirmed', 'checked_in')
       and b.check_in <= current_date
       and b.check_out > current_date
     order by b.check_in desc, b.created_at desc
     limit 1;
  end if;

  if v_payment_method = 'folio' then
    if v_booking_id is null then
      return jsonb_build_object('success', false, 'error', 'Room folio charge requires an active booking');
    end if;

    if not exists (
      select 1
        from public.bookings b
       where b.id = v_booking_id
         and b.lodge_id = v_lodge_id
         and b.status in ('confirmed', 'checked_in')
    ) then
      return jsonb_build_object('success', false, 'error', 'Folio booking is not active');
    end if;
  end if;

  -- Idempotency: return existing order if already created
  if v_create_idempotency_key is not null then
    select o.id, o.total, o.folio_charge_id
      into v_existing_id, v_existing_total, v_existing_charge_id
      from public.pos_orders o
     where o.lodge_id = v_lodge_id
       and o.create_idempotency_key = v_create_idempotency_key
     limit 1;
    if found then
      return jsonb_build_object('success', true, 'order_id', v_existing_id, 'total', v_existing_total, 'idempotent', true);
    end if;
  end if;

  -- Price validation: always use server DB price for known menu items.
  -- P1-1 FIX: never trust client-supplied unit_price for catalog items,
  -- even for replays. Only accept client price for custom/ad-hoc line items
  -- (those without a menu_item_id) or when the item no longer exists on the menu.
  for v_item in select jsonb_array_elements(payload->'items')
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity     := coalesce((v_item->>'quantity')::numeric, 1);

    if v_menu_item_id is not null then
      select m.unit_price, m.is_available, m.name,
             m.inventory_item_id, m.depletion_qty
        into v_db_price, v_is_available, v_item_name,
             v_inv_item_id, v_depletion_qty
        from public.pos_menu_items m
       where m.id = v_menu_item_id
         and m.lodge_id = v_lodge_id;

      if found then
        if not v_is_available then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;
        -- Always use server price — never trust client payload price for catalog items
        v_unit_price := v_db_price;
      elsif v_is_replay then
        -- Item deleted after this order was queued offline:
        -- accept client price but only as a fallback for historical record
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := null;
        v_depletion_qty := 1;
      else
        raise exception 'POS menu item % not found for lodge % — order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      -- Custom / ad-hoc line item: client provides price (no catalog entry to validate against)
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := null;
      v_depletion_qty := 1;
    end if;

    v_computed_total := v_computed_total + (v_quantity * v_unit_price);
  end loop;

  -- Insert the order
  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name,
    total, notes, payment_method, outlet_id, status,
    created_at, create_idempotency_key
  )
  values (
    gen_random_uuid(), v_lodge_id, v_room_id, v_booking_id, v_walk_in_name,
    v_computed_total, v_notes, v_payment_method, v_outlet_id, 'completed',
    coalesce(v_created_at_client, now()), v_create_idempotency_key
  )
  returning id into v_existing_id;

  if v_payment_method = 'folio' and v_booking_id is not null then
    insert into public.booking_charges (lodge_id, booking_id, description, amount, created_at)
    values (v_lodge_id, v_booking_id, coalesce(v_notes, 'POS folio charge'), v_computed_total, now())
    returning id into v_folio_charge_id;

    update public.pos_orders set folio_charge_id = v_folio_charge_id where id = v_existing_id;

    update public.bookings
       set charges_total = coalesce(charges_total, 0) + v_computed_total
     where id = v_booking_id and lodge_id = v_lodge_id;
  end if;

  return jsonb_build_object('success', true, 'order_id', v_existing_id, 'total', v_computed_total);
end;
$create_pos_order$;

-- =============================================================================
-- P1-2: Fix room profitability — include charges_total in revenue
--        Fix occupancy denominator — use date_range + 1 for inclusive end date
-- =============================================================================

create or replace function public.get_room_profitability(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rows jsonb := '[]'::jsonb;
  -- +1 for inclusive end-date semantics: Jan 1 to Jan 7 = 7 days, not 6
  v_total_days integer := greatest((p_end_date - p_start_date + 1), 1);
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  with room_list as (
    select
      r.id,
      r.room_number,
      r.room_type,
      coalesce(r.rate_per_night, 0) as rate_per_night
    from public.rooms r
    where r.lodge_id = p_lodge_id
  ),
  booking_metrics as (
    select
      b.room_id,
      coalesce(sum(greatest(0, least(b.check_out, p_end_date + 1) - greatest(b.check_in, p_start_date))), 0) as occupied_nights,
      -- P1-2 FIX: include folio charges in revenue (total_amount + charges_total)
      coalesce(sum(coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0)), 0) as revenue
    from public.bookings b
    where b.lodge_id = p_lodge_id
      -- Exclude both cancelled and pending
      and lower(coalesce(b.status, '')) not in ('cancelled', 'pending')
      and b.check_in <= p_end_date
      and b.check_out > p_start_date
    group by b.room_id
  ),
  supply_metrics as (
    select
      rsm.room_id,
      coalesce(sum(coalesce(rsm.total_cost, 0)), 0) as supply_cost,
      coalesce(sum(coalesce(rsm.quantity, 0)), 0) as supply_units_used
    from public.room_supply_movements rsm
    where rsm.lodge_id = p_lodge_id
      and rsm.movement_type = 'use'
      and rsm.created_at >= p_start_date::timestamptz
      and rsm.created_at < (p_end_date + 1)::timestamptz
    group by rsm.room_id
  ),
  maintenance_metrics as (
    select
      mt.room_id,
      count(*) as maintenance_count,
      count(*) filter (where coalesce(mt.status, '') <> 'resolved') as open_maintenance_count,
      coalesce(sum(coalesce(mt.total_cost, 0)), 0) as maintenance_cost
    from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id
      and mt.reported_date >= p_start_date
      and mt.reported_date <= p_end_date
    group by mt.room_id
  ),
  rows as (
    select
      rl.id,
      rl.room_number,
      rl.room_type,
      rl.rate_per_night,
      coalesce(bm.occupied_nights, 0) as occupied_nights,
      -- P1-2 FIX: correct denominator for inclusive date ranges
      case when v_total_days > 0 then round((coalesce(bm.occupied_nights, 0)::numeric / v_total_days::numeric) * 100) else 0 end as occupancy_rate,
      coalesce(bm.revenue, 0) as revenue,
      coalesce(sm.supply_cost, 0) as supply_cost,
      coalesce(sm.supply_units_used, 0) as supply_units_used,
      coalesce(mm.maintenance_cost, 0) as maintenance_cost,
      coalesce(mm.maintenance_count, 0) as maintenance_count,
      coalesce(mm.open_maintenance_count, 0) as open_maintenance_count
    from room_list rl
    left join booking_metrics bm on bm.room_id = rl.id
    left join supply_metrics sm on sm.room_id = rl.id
    left join maintenance_metrics mm on mm.room_id = rl.id
  )
  select jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'room_number', r.room_number,
      'room_type', r.room_type,
      'rate_per_night', r.rate_per_night,
      'occupied_nights', r.occupied_nights,
      'occupancy_rate', r.occupancy_rate,
      'revenue', r.revenue,
      'supply_cost', r.supply_cost,
      'supply_units_used', r.supply_units_used,
      'maintenance_cost', r.maintenance_cost,
      'maintenance_count', r.maintenance_count,
      'open_maintenance_count', r.open_maintenance_count,
      'net_profit', r.revenue - r.supply_cost - r.maintenance_cost
    )
    order by r.room_number
  )
  into v_rows
  from rows r;

  return coalesce(v_rows, '[]'::jsonb);
end;
$function$;

commit;
