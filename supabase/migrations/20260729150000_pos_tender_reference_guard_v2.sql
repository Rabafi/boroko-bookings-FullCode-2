-- Complete provider-tender reference enforcement.
-- The original guard handled array rows but allowed a card/mobile order with
-- a null or empty payment_breakdown. This forward repair closes that gap for
-- direct writers, RPC replay, and legacy compatibility callers.
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
  v_provider_seen boolean := false;
  v_breakdown jsonb := case
    when jsonb_typeof(new.payment_breakdown) = 'array' then new.payment_breakdown
    else '[]'::jsonb
  end;
begin
  if v_default_method in ('card', 'mobile_money')
     and jsonb_array_length(v_breakdown) = 0 then
    raise exception using
      errcode = '22023',
      message = format('%s tender requires a transaction or approval reference', replace(v_default_method, '_', ' '));
  end if;

  for v_tender in select value from jsonb_array_elements(v_breakdown)
  loop
    if jsonb_typeof(v_tender) <> 'object' then
      raise exception using errcode = '22023', message = 'Payment breakdown entries must be objects';
    end if;

    v_method := lower(trim(coalesce(v_tender->>'method', new.payment_method, 'cash')));
    if v_method in ('card', 'mobile_money') then
      v_provider_seen := true;
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

  if v_default_method in ('card', 'mobile_money') and not v_provider_seen then
    raise exception using
      errcode = '22023',
      message = format('%s tender requires a matching provider payment row', replace(v_default_method, '_', ' '));
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
