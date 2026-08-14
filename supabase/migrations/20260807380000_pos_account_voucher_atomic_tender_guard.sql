-- POS account and voucher tenders must carry the identity required by the
-- deferred source/subledger/GL posting trigger.  The existing v3 RPC remains
-- the compatibility contract for desktop, Manager/POS replay, and Legacy POS.
-- This guard only rejects incomplete or pre-cutover tender envelopes; the
-- deferred pos_order_items trigger performs the locked ledger and GL writes in
-- the same transaction as create_pos_order_v3.

begin;

create or replace function public.guard_pos_account_voucher_tender_envelope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method text := lower(btrim(coalesce(new.payment_method, '')));
  v_tender jsonb;
  v_tender_method text;
begin
  if v_method not in ('account', 'voucher') and not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(new.payment_breakdown, '[]'::jsonb)) = 'array'
        then coalesce(new.payment_breakdown, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as tender(value)
    where lower(btrim(coalesce(tender.value->>'method', ''))) in ('account', 'voucher')
  ) then
    return new;
  end if;

  if not public.restaurant_accounting_is_active(new.lodge_id) then
    raise exception 'Customer-account and voucher tenders require activated Accounting'
      using errcode = '55000';
  end if;

  if v_method = 'account' and not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(new.payment_breakdown, '[]'::jsonb)) = 'array'
        then coalesce(new.payment_breakdown, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as tender(value)
    where lower(btrim(coalesce(tender.value->>'method', ''))) = 'account'
      and nullif(btrim(coalesce(tender.value->>'customer_id', '')), '') is not null
  ) then
    raise exception 'Account tender requires customer_id in payment_breakdown'
      using errcode = '22023';
  end if;

  for v_tender in
    select value
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(new.payment_breakdown, '[]'::jsonb)) = 'array'
        then coalesce(new.payment_breakdown, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as tender(value)
  loop
    v_tender_method := lower(btrim(coalesce(v_tender->>'method', '')));
    if v_tender_method = 'account'
      and nullif(btrim(coalesce(v_tender->>'customer_id', '')), '') is null then
      raise exception 'Account tender requires customer_id in payment_breakdown'
        using errcode = '22023';
    elsif v_tender_method = 'voucher'
      and nullif(btrim(coalesce(v_tender->>'voucher_id', v_tender->>'code', '')), '') is null then
      raise exception 'Voucher tender requires voucher_id or code in payment_breakdown'
        using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_guard_pos_account_voucher_tender_envelope on public.pos_orders;
create trigger trg_guard_pos_account_voucher_tender_envelope
before insert or update of payment_method, payment_breakdown on public.pos_orders
for each row
execute function public.guard_pos_account_voucher_tender_envelope();

revoke all on function public.guard_pos_account_voucher_tender_envelope() from public, anon, authenticated;
grant execute on function public.guard_pos_account_voucher_tender_envelope() to service_role;

commit;
