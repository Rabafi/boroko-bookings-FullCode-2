-- Forward repair for the deployed client commercial billing reader.
-- Bind the Supabase Auth fallback to the requested lodge and keep internal
-- draft invoices out of the customer-facing history.

create or replace function public.get_client_commercial_invoices(
  p_lodge_id uuid,
  p_product_id text,
  p_limit integer default 100,
  p_offset integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_session public.app_sessions%rowtype;
  v_current_lodge_id uuid;
  v_user_id uuid;
  v_auth_user_id uuid;
  v_role text;
  v_status text;
  v_capability_overrides jsonb := '{}'::jsonb;
  v_product_id text := lower(btrim(coalesce(p_product_id, '')));
  v_expected_product_id text;
  v_rows jsonb := '[]'::jsonb;
  v_total integer := 0;
begin
  if p_lodge_id is null or v_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then
    return jsonb_build_object(
      'success', false,
      'available', false,
      'code', 'VALIDATION_FAILED',
      'error', 'A valid company and product are required.'
    );
  end if;

  select * into v_session from public.app_current_session_row();
  if v_session.id is not null then
    v_current_lodge_id := v_session.lodge_id;
    v_user_id := v_session.user_id;
  else
    v_auth_user_id := public.app_authenticated_user_id();
    select u.id, u.lodge_id
      into v_user_id, v_current_lodge_id
      from public.users u
     where u.auth_user_id = v_auth_user_id
       and u.lodge_id = p_lodge_id
       and coalesce(u.status, 'active') = 'active'
     order by u.created_at, u.id
     limit 1;
  end if;

  if v_user_id is null or v_current_lodge_id is null then
    return jsonb_build_object(
      'success', false,
      'available', false,
      'code', 'UNAUTHENTICATED',
      'error', 'Your signed-in company session is unavailable. Sign in again and retry.'
    );
  end if;

  if v_current_lodge_id <> p_lodge_id then
    return jsonb_build_object(
      'success', false,
      'available', false,
      'code', 'LODGE_SCOPE_DENIED',
      'error', 'This billing history belongs to a different company.'
    );
  end if;

  select lower(btrim(coalesce(u.role, ''))),
         lower(btrim(coalesce(u.status, 'active'))),
         coalesce(u.capability_overrides, '{}'::jsonb)
    into v_role, v_status, v_capability_overrides
    from public.users u
   where u.id = v_user_id
     and u.lodge_id = v_current_lodge_id
   limit 1;

  if v_status <> 'active' then
    return jsonb_build_object(
      'success', false,
      'available', false,
      'code', 'STAFF_ACCESS_DENIED',
      'error', 'Your staff account is not active for this company.'
    );
  end if;

  if v_role not in ('finance', 'manager', 'admin', 'owner', 'super_admin', 'administrator', 'accounts', 'accounting')
     or lower(coalesce(v_capability_overrides->>'settings.manage_subscription', 'true')) in ('false', '0', 'no') then
    return jsonb_build_object(
      'success', false,
      'available', false,
      'code', 'CAPABILITY_DENIED',
      'error', 'Your role is not allowed to view subscription billing history.'
    );
  end if;

  select public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge'))
    into v_expected_product_id
    from public.settings s
   where s.lodge_id = v_current_lodge_id
     and coalesce(s.deleted, false) = false
   limit 1;

  if v_expected_product_id is null or v_expected_product_id <> v_product_id then
    return jsonb_build_object(
      'success', false,
      'available', false,
      'code', 'PRODUCT_SCOPE_DENIED',
      'error', 'This company is not available in the current Tsa Bonno product.'
    );
  end if;

  select count(*)::integer
    into v_total
    from public.commercial_invoices i
    join public.commercial_accounts a on a.id = i.commercial_account_id
   where a.lodge_id = v_current_lodge_id
     and a.product_id = v_product_id
     and i.status <> 'draft';

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.issued_at desc nulls last, rows.invoice_number desc), '[]'::jsonb)
    into v_rows
    from (
      select
        i.id,
        i.invoice_number,
        i.commercial_account_id as account_id,
        a.lodge_id,
        a.product_id,
        i.status,
        i.currency,
        i.billing_period,
        i.issued_at,
        i.issued_at::date as issued_date,
        i.due_date,
        i.total,
        i.total as amount,
        i.balance_due,
        case when i.balance_due <= 0 then payments.last_payment_at else null end as paid_at,
        case when i.balance_due <= 0 then payments.last_payment_at::date else null end as paid_date,
        coalesce(payments.paid_amount, 0) as paid_amount,
        coalesce(payments.payment_count, 0) as payment_count,
        nullif(i.pricing_snapshot->>'commercial_package_key', '') as package_display_key,
        coalesce(
          nullif(i.pricing_snapshot->>'package_label', ''),
          nullif(i.pricing_snapshot->>'commercial_package_key', ''),
          nullif(i.pricing_snapshot->>'package_key', ''),
          'Commercial subscription'
        ) as package_name,
        coalesce(i.pricing_snapshot->>'commercial_package_key', i.pricing_snapshot->>'package_key') as package_key,
        i.created_at,
        i.posted_at,
        i.voided_at
      from public.commercial_invoices i
      join public.commercial_accounts a on a.id = i.commercial_account_id
      left join lateral (
        select
          max(p.received_at) as last_payment_at,
          coalesce(sum(pa.amount), 0) as paid_amount,
          count(distinct p.id)::integer as payment_count
        from public.commercial_payment_allocations pa
        join public.commercial_payments p on p.id = pa.commercial_payment_id
        where pa.commercial_invoice_id = i.id
      ) payments on true
      where a.lodge_id = v_current_lodge_id
        and a.product_id = v_product_id
        and i.status <> 'draft'
      order by i.issued_at desc nulls last, i.invoice_number desc
      limit greatest(least(coalesce(p_limit, 100), 500), 1)
      offset greatest(coalesce(p_offset, 0), 0)
    ) rows;

  return jsonb_build_object(
    'success', true,
    'available', true,
    'source', 'commercial_ledger',
    'lodge_id', v_current_lodge_id,
    'product_id', v_product_id,
    'rows', v_rows,
    'total', v_total
  );
end;
$$;

revoke all on function public.get_client_commercial_invoices(uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_client_commercial_invoices(uuid, text, integer, integer)
  to anon, authenticated;

notify pgrst, 'reload schema';
