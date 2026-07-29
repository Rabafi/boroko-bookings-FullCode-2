-- Bar/POS payment references
--
-- Card and mobile-money tenders are not complete audit evidence without the
-- terminal approval or provider transaction reference.  Keep the rule in the
-- database so offline replay and every client surface use the same contract.
-- Cash, account, folio, voucher and other non-provider tenders remain valid
-- without a provider reference.  Returns inherit the original tender evidence
-- and are checked by the same trigger.

create or replace function public.validate_pos_tender_references()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tender jsonb;
  v_method text;
  v_reference text;
begin
  if new.payment_breakdown is null
     or jsonb_typeof(new.payment_breakdown) <> 'array' then
    return new;
  end if;

  for v_tender in select value from jsonb_array_elements(new.payment_breakdown)
  loop
    v_method := lower(trim(coalesce(v_tender->>'method', new.payment_method, 'cash')));
    if v_method in ('card', 'mobile_money') then
      v_reference := nullif(trim(coalesce(v_tender->>'reference', '')), '');
      if v_reference is null then
        raise exception using
          errcode = '22023',
          message = format('%s tender requires a transaction or approval reference', replace(v_method, '_', ' '));
      end if;
      if length(v_reference) > 120 then
        raise exception using
          errcode = '22023',
          message = format('%s tender reference must be 120 characters or fewer', replace(v_method, '_', ' '));
      end if;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_validate_pos_tender_references on public.pos_orders;
create trigger trg_validate_pos_tender_references
before insert or update of payment_breakdown, payment_method on public.pos_orders
for each row execute function public.validate_pos_tender_references();

revoke all on function public.validate_pos_tender_references() from public;
grant execute on function public.validate_pos_tender_references() to authenticated, service_role;
