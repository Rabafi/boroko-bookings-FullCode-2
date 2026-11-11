-- Extend active-payment filtering to the remaining current financial readers
-- and expose preserved void metadata in ordinary booking payment history.
begin;

do $$
declare
  v_signature text;
  v_expected_alias integer;
  v_expected_plain integer;
  v_definition text;
  v_alias_pattern text := 'from public.payments p';
  v_plain_pattern text := 'from public.payments';
  v_alias_count integer;
  v_plain_count integer;
begin
  for v_signature, v_expected_alias, v_expected_plain in
    select * from (values
      ('public._calculate_event_settlement_totals(uuid)', 0, 1),
      ('public.app_get_admin_today()', 1, 1),
      ('public.get_financial_reconciliation_v1(uuid)', 2, 1),
      ('public.get_guest_lifetime_summary(uuid,text,integer,integer)', 1, 0),
      ('public.get_guest_payment_history(text)', 1, 0),
      ('public.get_manager_dashboard_snapshot(uuid,date)', 0, 2),
      ('public.get_starter_basic_report(uuid,integer)', 3, 0)
    ) expected(signature, alias_count, plain_count)
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Expected payment reader is missing: %', v_signature;
    end if;
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
    v_alias_count := (length(lower(v_definition)) - length(replace(lower(v_definition), v_alias_pattern, ''))) / length(v_alias_pattern);
    v_plain_count := (length(lower(v_definition)) - length(replace(lower(v_definition), v_plain_pattern, ''))) / length(v_plain_pattern) - v_alias_count;
    if v_alias_count <> v_expected_alias or v_plain_count <> v_expected_plain then
      raise exception 'Unexpected payment-reader shape in %, alias %, plain %', v_signature, v_alias_count, v_plain_count;
    end if;
    v_definition := regexp_replace(v_definition, '(?i)from\s+public\.payments\s+p\b', 'from public.payment_reporting_active p', 'g');
    v_definition := regexp_replace(v_definition, '(?i)from\s+public\.payments\b', 'from public.payment_reporting_active', 'g');
    execute v_definition;
  end loop;
end;
$$;

drop function if exists public.get_booking_payments(uuid, uuid);
create function public.get_booking_payments(p_booking_id uuid, p_lodge_id uuid)
returns table (
  id uuid, booking_id uuid, lodge_id uuid, amount numeric, method text, type text,
  paid_at timestamptz, recorded_by uuid, notes text, created_at timestamptz,
  refund_base_amount numeric, refund_retained_percent numeric, refund_retained_amount numeric,
  voided_at timestamptz, void_reason text, voided_as_duplicate_of uuid, voided_by uuid
)
language plpgsql security definer set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id,array['receptionist','finance','manager','admin','super_admin']);
  if not exists(select 1 from public.bookings b where b.id=p_booking_id and b.lodge_id=p_lodge_id) then return; end if;
  return query
  select p.id,p.booking_id,p.lodge_id,p.amount,p.method,p.type,p.paid_at,p.recorded_by,
         coalesce(p.notes,''),p.created_at,null::numeric,null::numeric,null::numeric,
         p.voided_at,p.void_reason,p.voided_as_duplicate_of,p.voided_by
    from public.payments p
   where p.booking_id=p_booking_id and p.lodge_id=p_lodge_id
   order by p.paid_at desc,p.created_at desc;
end;
$$;
revoke all on function public.get_booking_payments(uuid,uuid) from public;
grant execute on function public.get_booking_payments(uuid,uuid) to anon,authenticated,service_role;

commit;
