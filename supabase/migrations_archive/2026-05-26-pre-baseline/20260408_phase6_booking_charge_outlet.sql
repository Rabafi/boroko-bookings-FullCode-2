-- Phase 6: Outlet tagging for booking charges
-- ─────────────────────────────────────────────────────────────────────────────
-- Context:
--   Phase 1 added outlet_id FK to booking_charges but add_booking_charge RPC
--   was explicitly deferred. This migration wires outlet_id into the RPC so
--   new charges can be attributed to Front Desk / Kitchen / Bar.
--
-- Safety rules:
--   - p_outlet_id is nullable with default null → existing callers are unbroken
--   - Historical charges with outlet_id IS NULL remain unchanged
--   - No backfill of ambiguous historical rows
--   - booking totals / charges_total trigger is not changed
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop old signature (adding a parameter changes the function signature in PG)
drop function if exists public.add_booking_charge(uuid, uuid, text, text, numeric, numeric);

create or replace function public.add_booking_charge(
  p_booking_id  uuid,
  p_lodge_id    uuid,
  p_description text,
  p_category    text    default 'other',
  p_quantity    numeric default 1,
  p_unit_price  numeric default 0,
  p_outlet_id   uuid    default null   -- NEW: nullable, defaults to null (= Unassigned)
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_charge_id uuid;
  v_amount    numeric;
begin
  if coalesce(p_unit_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Charge unit price must be greater than zero');
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = p_booking_id
      and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_amount := coalesce(p_quantity, 1) * coalesce(p_unit_price, 0);

  insert into public.booking_charges (
    booking_id,
    lodge_id,
    description,
    category,
    quantity,
    unit_price,
    amount,
    outlet_id
  ) values (
    p_booking_id,
    p_lodge_id,
    p_description,
    coalesce(nullif(p_category, ''), 'other'),
    coalesce(p_quantity, 1),
    coalesce(p_unit_price, 0),
    v_amount,
    p_outlet_id   -- null is valid — historical rows stay null, new explicit calls set this
  )
  returning id into v_charge_id;

  return jsonb_build_object('success', true, 'id', v_charge_id);
end;
$function$;

-- Grant on new signature
grant execute on function public.add_booking_charge(uuid, uuid, text, text, numeric, numeric, uuid)
  to anon, authenticated;
