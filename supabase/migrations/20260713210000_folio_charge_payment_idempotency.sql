-- Idempotent hotel folio charge/payment for safe re-try after ambiguous timeout.
-- Aligns with financial_operation_idempotency + _claim/_record helpers.

begin;

create or replace function public.add_folio_charge(
  p_lodge_id uuid,
  p_folio_id uuid,
  p_amount numeric,
  p_description text default '',
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_folio public.hotel_folios%rowtype;
  v_line public.folio_line_items%rowtype;
  v_user_id uuid := public.app_current_user_id();
  v_before jsonb;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_claim jsonb;
  v_result jsonb;
  v_hash text;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'cashier', 'supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  if v_key is not null then
    v_hash := md5(
      coalesce(p_folio_id::text, '') || '|' ||
      coalesce(p_amount::text, '') || '|' ||
      coalesce(p_description, '') || '|' ||
      coalesce(p_reference_type, '') || '|' ||
      coalesce(p_reference_id::text, '')
    );
    v_claim := public._claim_financial_operation(
      p_lodge_id, v_key, 'add_folio_charge', p_folio_id, v_hash
    );
    if v_claim->>'success' = 'false' then
      return v_claim;
    end if;
    if v_claim->>'found' = 'true' then
      return coalesce(v_claim->'operation_result', v_claim);
    end if;
  end if;

  select * into v_folio from public.hotel_folios
  where id = p_folio_id and lodge_id = p_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found'); end if;
  if v_folio.status in ('locked', 'closed', 'void') then
    return jsonb_build_object('success', false, 'error', 'Folio is ' || v_folio.status);
  end if;
  if coalesce(p_amount, 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'Amount is required');
  end if;

  v_before := to_jsonb(v_folio);
  insert into public.folio_line_items (
    folio_id, lodge_id, amount, line_type, description, reference_type, reference_id, created_by, audit_before
  ) values (
    p_folio_id, p_lodge_id, p_amount, 'charge', coalesce(p_description, ''),
    p_reference_type, p_reference_id, v_user_id, v_before
  ) returning * into v_line;

  update public.hotel_folios
     set balance = balance + p_amount, updated_at = now()
   where id = p_folio_id
   returning * into v_folio;

  update public.folio_line_items
     set audit_after = to_jsonb(v_folio)
   where id = v_line.id;

  v_result := jsonb_build_object('success', true, 'line_item', to_jsonb(v_line), 'folio', to_jsonb(v_folio));

  if v_key is not null then
    perform public._record_financial_operation(
      p_lodge_id, v_key, 'add_folio_charge', p_folio_id, v_hash, v_result
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.add_folio_payment(
  p_lodge_id uuid,
  p_folio_id uuid,
  p_amount numeric,
  p_description text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_folio public.hotel_folios%rowtype;
  v_line public.folio_line_items%rowtype;
  v_user_id uuid := public.app_current_user_id();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_claim jsonb;
  v_result jsonb;
  v_hash text;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'cashier', 'supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  if v_key is not null then
    v_hash := md5(
      coalesce(p_folio_id::text, '') || '|' ||
      coalesce(p_amount::text, '') || '|' ||
      coalesce(p_description, '')
    );
    v_claim := public._claim_financial_operation(
      p_lodge_id, v_key, 'add_folio_payment', p_folio_id, v_hash
    );
    if v_claim->>'success' = 'false' then
      return v_claim;
    end if;
    if v_claim->>'found' = 'true' then
      return coalesce(v_claim->'operation_result', v_claim);
    end if;
  end if;

  select * into v_folio from public.hotel_folios
  where id = p_folio_id and lodge_id = p_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found'); end if;
  if v_folio.status in ('locked', 'closed', 'void') then
    return jsonb_build_object('success', false, 'error', 'Folio is ' || v_folio.status);
  end if;
  if coalesce(p_amount, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Payment amount must be positive');
  end if;

  insert into public.folio_line_items (
    folio_id, lodge_id, amount, line_type, description, created_by
  ) values (
    p_folio_id, p_lodge_id, p_amount, 'payment', coalesce(p_description, 'Payment'), v_user_id
  ) returning * into v_line;

  update public.hotel_folios
     set balance = balance - p_amount, updated_at = now()
   where id = p_folio_id
   returning * into v_folio;

  v_result := jsonb_build_object('success', true, 'line_item', to_jsonb(v_line), 'folio', to_jsonb(v_folio));

  if v_key is not null then
    perform public._record_financial_operation(
      p_lodge_id, v_key, 'add_folio_payment', p_folio_id, v_hash, v_result
    );
  end if;

  return v_result;
end;
$$;

grant execute on function public.add_folio_charge(uuid, uuid, numeric, text, text, uuid, text) to authenticated, service_role;
grant execute on function public.add_folio_payment(uuid, uuid, numeric, text, text) to authenticated, service_role;

-- Keep classic overloads callable for older clients (5-arg charge / 3-arg payment style via defaults)
grant execute on function public.add_folio_charge(uuid, uuid, numeric, text, text, uuid, text) to authenticated, service_role;

commit;
