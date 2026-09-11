-- Make provider references optional for card and mobile-money tenders.
--
-- Supersedes 20260905000000_pos_card_reference_optional.sql: both card and
-- mobile-money references are now optional on the restaurant bar POS. A
-- supplied reference must be 120 characters or fewer. Tender allocation
-- integrity is preserved: a card payment_method still requires a matching
-- card row and a mobile-money payment_method still requires a matching
-- mobile-money row; only the reference itself is optional.
begin;

create or replace function public.validate_pos_tender_references()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tender jsonb;
  v_method text;
  v_default_method text := lower(trim(coalesce(new.payment_method, 'cash')));
  v_reference text;
  v_mobile_seen boolean := false;
  v_card_seen boolean := false;
  v_breakdown jsonb := case
    when jsonb_typeof(new.payment_breakdown) = 'array' then new.payment_breakdown
    else '[]'::jsonb
  end;
begin
  for v_tender in select value from jsonb_array_elements(v_breakdown)
  loop
    if jsonb_typeof(v_tender) <> 'object' then
      raise exception using errcode = '22023', message = 'Payment breakdown entries must be objects';
    end if;

    v_method := lower(trim(coalesce(v_tender->>'method', new.payment_method, 'cash')));
    if v_method = 'mobile_money' then
      v_mobile_seen := true;
      v_reference := nullif(trim(coalesce(v_tender->>'reference', '')), '');
      if v_reference is not null and length(v_reference) > 120 then
        raise exception using
          errcode = '22023',
          message = 'mobile money tender reference must be 120 characters or fewer';
      end if;
    elsif v_method = 'card' then
      v_card_seen := true;
      v_reference := nullif(trim(coalesce(v_tender->>'reference', '')), '');
      if v_reference is not null and length(v_reference) > 120 then
        raise exception using
          errcode = '22023',
          message = 'card tender reference must be 120 characters or fewer';
      end if;
    end if;
  end loop;

  if v_default_method = 'mobile_money' and not v_mobile_seen then
    raise exception using
      errcode = '22023',
      message = 'mobile money tender requires a matching provider payment row';
  end if;

  if v_default_method = 'card' and not v_card_seen then
    raise exception using
      errcode = '22023',
      message = 'card tender requires a matching provider payment row';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_pos_tender_references on public.pos_orders;
create trigger trg_validate_pos_tender_references
before insert or update of payment_breakdown, payment_method
on public.pos_orders
for each row execute function public.validate_pos_tender_references();

revoke all on function public.validate_pos_tender_references() from public;
grant execute on function public.validate_pos_tender_references() to authenticated, service_role;

commit;
