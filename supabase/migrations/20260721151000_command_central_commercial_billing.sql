-- Command Central commercial billing.
-- This ledger is deliberately separate from customer booking invoices/payments.
-- All entry points are service-role-only and use one stable operation ID per
-- operator action; retries replay the original result rather than charging twice.

create sequence if not exists public.commercial_invoice_number_seq;

create table if not exists public.command_central_audit_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid references public.command_central_operations(operation_id),
  event_type text not null,
  target_lodge_id uuid,
  product_id text,
  actor_id uuid,
  actor_email text,
  reason text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.command_central_audit_events enable row level security;
revoke all on public.command_central_audit_events from public, anon, authenticated;

create or replace function public.command_central_complete_operation(
  p_operation_id uuid,
  p_result jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  update public.command_central_operations
     set status = 'completed', result = p_result, completed_at = now()
   where operation_id = p_operation_id and status = 'started';
end;
$$;

revoke all on function public.command_central_complete_operation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.command_central_complete_operation(uuid, jsonb) to service_role;

create or replace function public.command_central_fail_operation(
  p_operation_id uuid,
  p_result jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  update public.command_central_operations
     set status = 'failed', result = p_result, completed_at = now()
   where operation_id = p_operation_id and status = 'started';
end;
$$;

revoke all on function public.command_central_fail_operation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.command_central_fail_operation(uuid, jsonb) to service_role;

create or replace function public.admin_generate_commercial_invoice(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_product_id text := lower(btrim(coalesce(p_payload->>'product_id', '')));
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_due_date date := coalesce(nullif(p_payload->>'due_date', '')::date, current_date + 30);
  v_claim jsonb;
  v_license public.licenses%rowtype;
  v_account public.commercial_accounts%rowtype;
  v_invoice public.commercial_invoices%rowtype;
  v_amount numeric;
  v_snapshot jsonb;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'Commercial invoice payload is required');
  end if;
  if v_lodge_id is null or v_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then
    return jsonb_build_object('success', false, 'error', 'A valid company and product are required');
  end if;
  if v_reason is null or length(v_reason) < 8 then
    return jsonb_build_object('success', false, 'error', 'A billing reason of at least 8 characters is required');
  end if;

  v_claim := public.command_central_claim_operation(
    v_operation_id, 'commercial_invoice.generate', v_lodge_id, v_product_id,
    md5(p_payload::text), v_reason, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', '')
  );
  if coalesce((v_claim->>'ok')::boolean, false) = false then
    return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim billing operation'));
  end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then
    return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous operation has no result'));
  end if;

  select * into v_license
    from public.licenses
   where lodge_id = v_lodge_id and product_id = v_product_id and coalesce(is_active, true) = true
   order by issued_at desc nulls last
   limit 1 for update;
  if not found then
    v_result := jsonb_build_object('success', false, 'error', 'No active commercial subscription exists for this company and product');
    perform public.command_central_fail_operation(v_operation_id, v_result);
    return v_result;
  end if;

  v_amount := coalesce(v_license.monthly_fee, 0);
  if v_amount <= 0 then
    v_result := jsonb_build_object('success', false, 'error', 'The active commercial subscription has no billable monthly fee');
    perform public.command_central_fail_operation(v_operation_id, v_result);
    return v_result;
  end if;
  v_snapshot := jsonb_build_object(
    'license_id', v_license.id,
    'product_id', v_license.product_id,
    'commercial_package_key', v_license.commercial_package_key,
    'catalog_version', v_license.commercial_catalog_version,
    'monthly_fee', v_amount,
    'currency', coalesce(v_license.currency, 'BWP'),
    'pricing', coalesce(v_license.commercial_pricing_snapshot, '{}'::jsonb)
  );

  insert into public.commercial_accounts(lodge_id, product_id, currency)
  values (v_lodge_id, v_product_id, coalesce(v_license.currency, 'BWP'))
  on conflict (lodge_id, product_id) do update set updated_at = now()
  returning * into v_account;

  insert into public.commercial_invoices(
    commercial_account_id, invoice_number, status, currency, issued_at, due_date,
    subtotal, tax_total, total, balance_due, pricing_snapshot, operation_id, posted_at
  ) values (
    v_account.id,
    format('CCI-%s-%s', to_char(current_date, 'YYYY'), lpad(nextval('public.commercial_invoice_number_seq')::text, 7, '0')),
    'posted', v_account.currency, now(), v_due_date, v_amount, 0, v_amount, v_amount,
    v_snapshot, v_operation_id, now()
  ) returning * into v_invoice;

  insert into public.commercial_invoice_lines(commercial_invoice_id, line_type, description, quantity, unit_amount, line_total, metadata)
  values (v_invoice.id, 'subscription', 'Commercial subscription: ' || coalesce(v_license.commercial_package_key, v_license.subscription_plan, 'subscription'), 1, v_amount, v_amount, v_snapshot);

  v_result := jsonb_build_object('success', true, 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number, 'account_id', v_account.id, 'amount', v_amount, 'currency', v_account.currency, 'due_date', v_due_date);
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, after_state)
  values (v_operation_id, 'commercial_invoice_posted', v_lodge_id, v_product_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, v_result);
  return v_result;
exception when invalid_text_representation or datetime_field_overflow then
  v_result := jsonb_build_object('success', false, 'error', 'One of the billing identifiers or dates is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', 'Commercial invoice generation failed');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

create or replace function public.admin_record_commercial_payment(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_invoice_id uuid := nullif(btrim(coalesce(p_payload->>'invoice_id', '')), '')::uuid;
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_amount numeric := nullif(p_payload->>'amount', '')::numeric;
  v_method text := lower(btrim(coalesce(p_payload->>'method', '')));
  v_claim jsonb;
  v_invoice public.commercial_invoices%rowtype;
  v_account public.commercial_accounts%rowtype;
  v_payment public.commercial_payments%rowtype;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'Commercial payment payload is required');
  end if;
  if v_invoice_id is null or v_amount is null or v_amount <= 0 or v_method = '' then
    return jsonb_build_object('success', false, 'error', 'Invoice, positive amount, and payment method are required');
  end if;
  if v_reason is null or length(v_reason) < 8 then
    return jsonb_build_object('success', false, 'error', 'A payment reason of at least 8 characters is required');
  end if;

  -- PostgreSQL does not allow a composite record variable to be one member of
  -- a multi-item SELECT INTO list. Lock and load each row explicitly instead.
  select i.* into v_invoice
    from public.commercial_invoices i
   where i.id = v_invoice_id
   for update;
  if found then
    select a.* into v_account
      from public.commercial_accounts a
     where a.id = v_invoice.commercial_account_id
     for update;
  end if;
  if not found then return jsonb_build_object('success', false, 'error', 'Commercial invoice was not found'); end if;
  v_claim := public.command_central_claim_operation(v_operation_id, 'commercial_payment.record', v_account.lodge_id, v_account.product_id, md5(p_payload::text), v_reason, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''));
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim payment operation')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous operation has no result')); end if;
  if v_invoice.status not in ('posted', 'paid') or v_invoice.balance_due <= 0 then
    v_result := jsonb_build_object('success', false, 'error', 'This commercial invoice is not payable'); perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;
  if v_amount > v_invoice.balance_due then
    v_result := jsonb_build_object('success', false, 'error', 'Payment cannot exceed the outstanding commercial invoice balance'); perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;
  if coalesce(nullif(p_payload->>'currency', ''), v_account.currency) <> v_account.currency then
    v_result := jsonb_build_object('success', false, 'error', 'Payment currency must match the commercial account currency'); perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;

  insert into public.commercial_payments(commercial_account_id, amount, currency, method, reference, operation_id)
  values (v_account.id, v_amount, v_account.currency, v_method, nullif(p_payload->>'reference', ''), v_operation_id)
  returning * into v_payment;
  insert into public.commercial_payment_allocations(commercial_payment_id, commercial_invoice_id, amount)
  values (v_payment.id, v_invoice.id, v_amount);
  update public.commercial_invoices
     set balance_due = balance_due - v_amount,
         status = case when balance_due - v_amount = 0 then 'paid' else 'posted' end
   where id = v_invoice.id
   returning * into v_invoice;
  v_result := jsonb_build_object('success', true, 'payment_id', v_payment.id, 'invoice_id', v_invoice.id, 'amount', v_amount, 'currency', v_account.currency, 'remaining_balance', v_invoice.balance_due, 'status', v_invoice.status);
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'commercial_payment_recorded', v_account.lodge_id, v_account.product_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, jsonb_build_object('balance_due', v_invoice.balance_due + v_amount), v_result);
  return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then
  v_result := jsonb_build_object('success', false, 'error', 'One of the payment identifiers or amounts is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', 'Commercial payment recording failed');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_generate_commercial_invoice(jsonb), public.admin_record_commercial_payment(jsonb) from public, anon, authenticated;
grant execute on function public.admin_generate_commercial_invoice(jsonb), public.admin_record_commercial_payment(jsonb) to service_role;

notify pgrst, 'reload schema';
