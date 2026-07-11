-- Payment Gateway Provider Config + Webhook Verification
-- Enhances existing payment infrastructure with full provider config and transaction tracking.

-- ── 1. Payment Transactions Table ─────────────────────────────────────────────
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  booking_id uuid,
  payment_intent_id uuid references public.payment_intents(id) on delete set null,
  provider text not null,
  provider_transaction_id text,
  amount numeric(12,2) not null default 0,
  currency text not null default 'BWP',
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'refunded', 'partially_refunded')),
  provider_status text,
  payment_method text,
  webhook_received boolean not null default false,
  webhook_verified boolean not null default false,
  webhook_payload jsonb default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_transactions enable row level security;

create policy payment_transactions_lodge_policy on public.payment_transactions
  using (public.app_lodge_access(lodge_id));

grant select on public.payment_transactions to authenticated;
revoke insert, update, delete on public.payment_transactions from authenticated, anon;

create index if not exists payment_transactions_lodge_idx on public.payment_transactions (lodge_id, created_at desc);
create index if not exists payment_transactions_provider_idx on public.payment_transactions (provider, provider_transaction_id);
create index if not exists payment_transactions_booking_idx on public.payment_transactions (booking_id);

-- ── 2a. Webhook Events Table (idempotency + audit) ──────────────────────────
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  provider text not null,
  event_id text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  payload jsonb default '{}'::jsonb,
  verification_result jsonb default '{}'::jsonb,
  transaction_id uuid references public.payment_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

alter table public.webhook_events enable row level security;

create policy webhook_events_lodge_policy on public.webhook_events
  using (public.app_lodge_access(lodge_id));

grant select on public.webhook_events to authenticated;
revoke insert, update, delete on public.webhook_events from authenticated, anon;

create unique index if not exists webhook_events_provider_event_idx
  on public.webhook_events (provider, event_id)
  where event_id is not null;

create index if not exists webhook_events_lodge_idx on public.webhook_events (lodge_id, created_at desc);

-- ── 2. Enhanced Payment Provider Config Columns ──────────────────────────────
-- Add new columns to existing payment_provider_configs if not present
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'payment_provider_configs' and column_name = 'supported_currencies') then
    alter table public.payment_provider_configs add column supported_currencies jsonb default '[]'::jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'payment_provider_configs' and column_name = 'allowed_payment_methods') then
    alter table public.payment_provider_configs add column allowed_payment_methods jsonb default '[]'::jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'payment_provider_configs' and column_name = 'label') then
    alter table public.payment_provider_configs add column label text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'payment_provider_configs' and column_name = 'default_currency') then
    alter table public.payment_provider_configs add column default_currency text default 'BWP';
  end if;
end $$;

-- ── 3. RPCs ───────────────────────────────────────────────────────────────────

-- Get payment provider secrets (admin only)
create or replace function public.get_payment_provider_secrets(
  p_lodge_id uuid,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secrets jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'super_admin']);

  select jsonb_build_object(
    'secret_key', ppc.secret_key,
    'webhook_secret', ppc.webhook_secret
  ) into v_secrets
  from public.payment_provider_configs ppc
  where ppc.lodge_id = p_lodge_id and ppc.provider = p_provider;

  return coalesce(v_secrets, jsonb_build_object('error', 'Config not found'));
end;
$$;

grant execute on function public.get_payment_provider_secrets(uuid, text) to authenticated;

-- Enhanced save_payment_provider_config (upserts with new fields)
create or replace function public.save_payment_provider_config(
  p_lodge_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
  v_mode text;
  v_config_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  v_provider := p_payload->>'provider';
  v_mode := coalesce(p_payload->>'mode', 'test');

  if v_provider is null or v_provider = '' then
    raise exception 'Provider name is required';
  end if;

  insert into public.payment_provider_configs (
    lodge_id, provider, mode, label, country, currency, default_currency,
    public_key, secret_key, webhook_secret,
    merchant_account_id, settlement_bank, is_active,
    supported_currencies, allowed_payment_methods, settings
  ) values (
    p_lodge_id,
    v_provider,
    v_mode,
    nullif(p_payload->>'label', ''),
    coalesce(p_payload->>'country', 'BW'),
    coalesce(p_payload->>'currency', 'BWP'),
    coalesce(p_payload->>'default_currency', 'BWP'),
    p_payload->>'public_key',
    p_payload->>'secret_key',
    p_payload->>'webhook_secret',
    p_payload->>'merchant_account_id',
    p_payload->>'settlement_bank',
    coalesce((p_payload->>'is_active')::boolean, true),
    coalesce(nullif(p_payload->>'supported_currencies', '')::jsonb, '["BWP"]'::jsonb),
    coalesce(nullif(p_payload->>'allowed_payment_methods', '')::jsonb, '["card", "mobile_money"]'::jsonb),
    coalesce(nullif(p_payload->>'settings', '')::jsonb, '{}'::jsonb)
  )
  on conflict (lodge_id, provider, mode) do update set
    label = excluded.label,
    public_key = excluded.public_key,
    secret_key = excluded.secret_key,
    webhook_secret = excluded.webhook_secret,
    merchant_account_id = excluded.merchant_account_id,
    settlement_bank = excluded.settlement_bank,
    is_active = excluded.is_active,
    country = excluded.country,
    currency = excluded.currency,
    default_currency = excluded.default_currency,
    supported_currencies = excluded.supported_currencies,
    allowed_payment_methods = excluded.allowed_payment_methods,
    settings = excluded.settings,
    updated_at = now()
  returning id into v_config_id;

  return jsonb_build_object('success', true, 'config_id', v_config_id);
end;
$$;

grant execute on function public.save_payment_provider_config(uuid, jsonb) to authenticated;

-- Enhanced get_payment_provider_config (returns new fields without secrets)
create or replace function public.get_payment_provider_config(
  p_lodge_id uuid,
  p_provider text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configs jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'id', ppc.id,
    'provider', ppc.provider,
    'label', ppc.label,
    'mode', ppc.mode,
    'country', ppc.country,
    'currency', ppc.currency,
    'default_currency', ppc.default_currency,
    'public_key', ppc.public_key,
    'merchant_account_id', ppc.merchant_account_id,
    'is_active', ppc.is_active,
    'supported_currencies', ppc.supported_currencies,
    'allowed_payment_methods', ppc.allowed_payment_methods,
    'settings', ppc.settings
  )) into v_configs
  from public.payment_provider_configs ppc
  where ppc.lodge_id = p_lodge_id
    and (p_provider is null or ppc.provider = p_provider);

  return coalesce(v_configs, '[]'::jsonb);
end;
$$;

grant execute on function public.get_payment_provider_config(uuid, text) to authenticated, anon;

-- Verify webhook signature with provider-specific verification
create or replace function public.verify_webhook_signature(
  p_provider text,
  p_signature text,
  p_payload_raw text,
  p_timestamp bigint default null,
  p_lodge_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_config record;
  expected_sig text;
  max_age_seconds constant bigint := 300;
  current_ts bigint;
  v_lodge_id uuid;
begin
  if p_provider is null or p_signature is null or p_payload_raw is null then
    return jsonb_build_object('verified', false, 'reason', 'missing_required_parameters');
  end if;

  v_lodge_id := coalesce(p_lodge_id, nullif(current_setting('app.lodge_id', true), '')::uuid);

  -- 1. Fetch provider config server-side only (never from client input)
  select * into provider_config
  from public.payment_provider_configs
  where provider = p_provider
    and is_active = true
    and lodge_id = v_lodge_id;

  if not found then
    return jsonb_build_object('verified', false, 'reason', 'provider_not_found_or_inactive');
  end if;

  -- 2. Reject missing webhook secret
  if provider_config.webhook_secret is null or provider_config.webhook_secret = '' then
    return jsonb_build_object('verified', false, 'reason', 'provider_secret_not_configured');
  end if;

  -- 3. Timestamp replay protection (if provided)
  if p_timestamp is not null then
    current_ts := (extract(epoch from now()) * 1000)::bigint;
    if current_ts - p_timestamp > max_age_seconds * 1000 then
      return jsonb_build_object('verified', false, 'reason', 'stale_timestamp');
    end if;
  end if;

  -- 4. Provider-specific signature verification
  if provider_config.provider = 'stripe' then
    expected_sig := encode(
      hmac(p_payload_raw::bytea, provider_config.webhook_secret::bytea, 'sha256'),
      'hex'
    );
    if expected_sig = p_signature then
      return jsonb_build_object('verified', true, 'provider', 'stripe');
    end if;

  elsif provider_config.provider = 'payfast' or provider_config.provider = 'paygate' then
    expected_sig := encode(
      digest(p_payload_raw || provider_config.webhook_secret, 'md5'),
      'hex'
    );
    if expected_sig = p_signature then
      return jsonb_build_object('verified', true, 'provider', provider_config.provider);
    end if;

  else
    expected_sig := encode(
      hmac(p_payload_raw::bytea, provider_config.webhook_secret::bytea, 'sha256'),
      'hex'
    );
    if expected_sig = p_signature then
      return jsonb_build_object('verified', true, 'provider', provider_config.provider);
    end if;
  end if;

  -- 5. Deterministic comparison failed
  return jsonb_build_object('verified', false, 'reason', 'signature_mismatch');
end;
$$;

grant execute on function public.verify_webhook_signature(text, text, text, bigint, uuid) to authenticated;

-- Record webhook payment with idempotency and verification
create or replace function public.record_webhook_payment(
  p_lodge_id uuid,
  p_payload jsonb,
  p_signature text,
  p_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
  v_provider_transaction_id text;
  v_amount numeric(12,2);
  v_currency text;
  v_status text;
  v_transaction_id uuid;
  v_verification jsonb;
  v_verified boolean;
  v_event_id text;
  v_existing record;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  v_provider := p_payload->>'provider';
  v_provider_transaction_id := p_payload->>'provider_transaction_id';
  v_amount := coalesce(nullif(p_payload->>'amount', '')::numeric, 0);
  v_currency := coalesce(nullif(p_payload->>'currency', ''), 'BWP');
  v_status := coalesce(nullif(p_payload->>'status', ''), 'pending');
  v_event_id := coalesce(p_event_id, p_payload->>'event_id');

  -- Idempotency: if event_id is provided, check for existing webhook_event
  if v_event_id is not null then
    select id, status, transaction_id into v_existing
    from public.webhook_events
    where provider = v_provider and event_id = v_event_id
    limit 1;

    if found then
      return jsonb_build_object(
        'success', (v_existing.status = 'verified'),
        'transaction_id', v_existing.transaction_id,
        'event_id', v_event_id,
        'webhook_verified', (v_existing.status = 'verified'),
        'status', v_existing.status,
        'duplicate', true
      );
    end if;
  end if;

  -- Verify signature before accepting payment
  v_verification := public.verify_webhook_signature(
    v_provider, p_signature, p_payload::text,
    p_lodge_id := p_lodge_id
  );
  v_verified := (v_verification->>'verified')::boolean;

  if not v_verified then
    -- Record failed webhook event (no payment transaction created)
    insert into public.webhook_events (lodge_id, provider, event_id, status, payload, verification_result)
    values (p_lodge_id, v_provider, v_event_id, 'failed', p_payload, v_verification);

    return jsonb_build_object(
      'success', false,
      'verified', false,
      'reason', v_verification->>'reason',
      'event_id', v_event_id
    );
  end if;

  -- Signature verified: create payment transaction
  insert into public.payment_transactions (
    lodge_id, booking_id, provider, provider_transaction_id,
    amount, currency, status, provider_status, payment_method,
    webhook_received, webhook_verified, webhook_payload
  )
  values (
    p_lodge_id,
    nullif(p_payload->>'booking_id', '')::uuid,
    v_provider,
    v_provider_transaction_id,
    v_amount,
    v_currency,
    v_status,
    nullif(p_payload->>'provider_status', ''),
    nullif(p_payload->>'payment_method', ''),
    true,
    true,
    p_payload
  )
  returning id into v_transaction_id;

  -- Record verified webhook event linked to transaction
  insert into public.webhook_events (lodge_id, provider, event_id, status, payload, verification_result, transaction_id, verified_at)
  values (p_lodge_id, v_provider, v_event_id, 'verified', p_payload, v_verification, v_transaction_id, now());

  return jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'event_id', v_event_id,
    'webhook_verified', true
  );
end;
$$;

grant execute on function public.record_webhook_payment(uuid, jsonb, text, text) to authenticated;

-- Enhanced confirm_payment_from_webhook with transaction tracking
create or replace function public.confirm_payment_from_webhook(
  p_provider_payment_id text,
  p_provider text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pi record;
  v_bi record;
  v_txn_id uuid;
  v_booking_id uuid;
begin
  select * into v_pi
  from public.payment_intents
  where provider_payment_id = p_provider_payment_id and provider = p_provider
  limit 1;

  if v_pi is null then
    raise exception 'Payment intent not found for provider payment %', p_provider_payment_id;
  end if;

  if v_pi.status = 'succeeded' then
    return jsonb_build_object('success', true, 'booking_id', null, 'already_processed', true);
  end if;

  -- Precondition: webhook must have been verified before confirming payment
  if not exists (
    select 1 from public.payment_transactions pt
    where pt.provider = p_provider
      and pt.provider_transaction_id = p_provider_payment_id
      and pt.webhook_verified = true
  ) then
    raise exception 'Webhook not verified for provider payment %', p_provider_payment_id;
  end if;

  select * into v_bi from public.booking_intents where id = v_pi.booking_intent_id;
  if v_bi is null then
    raise exception 'Booking intent not found';
  end if;

  update public.payment_intents
  set status = 'succeeded',
      webhook_received_at = now(),
      webhook_payload = p_payload,
      updated_at = now()
  where id = v_pi.id;

  update public.booking_intents
  set status = 'payment_completed', updated_at = now()
  where id = v_bi.id;

  -- Record transaction
  insert into public.payment_transactions (
    lodge_id, booking_id, payment_intent_id, provider,
    provider_transaction_id, amount, currency, status,
    provider_status, webhook_received, webhook_verified, webhook_payload
  )
  values (
    v_bi.lodge_id, null, v_pi.id, p_provider,
    p_provider_payment_id, v_pi.amount, v_pi.currency, 'completed',
    'succeeded', true, true, p_payload
  )
  returning id into v_txn_id;

  return jsonb_build_object(
    'success', true,
    'transaction_id', v_txn_id,
    'booking_intent_id', v_bi.id,
    'lodge_id', v_bi.lodge_id,
    'slug', v_bi.slug,
    'room_id', v_bi.room_id,
    'total_amount', v_bi.total_amount,
    'deposit_amount', v_bi.deposit_amount,
    'guest_email', v_bi.guest_email,
    'guest_first_name', v_bi.guest_first_name,
    'guest_last_name', v_bi.guest_last_name,
    'check_in', v_bi.check_in,
    'check_out', v_bi.check_out,
    'adults', v_bi.adults,
    'children', v_bi.children,
    'notes', v_bi.notes,
    'booking_type', v_bi.booking_type
  );
end;
$$;

grant execute on function public.confirm_payment_from_webhook(text, text, jsonb) to service_role;

-- Get payment dashboard
create or replace function public.get_payment_dashboard(
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent jsonb;
  v_pending jsonb;
  v_failed jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin', 'finance']);

  select jsonb_agg(jsonb_build_object(
    'id', pt.id,
    'provider', pt.provider,
    'amount', pt.amount,
    'currency', pt.currency,
    'status', pt.status,
    'payment_method', pt.payment_method,
    'created_at', pt.created_at
  ) order by pt.created_at desc) into v_recent
  from public.payment_transactions pt
  where pt.lodge_id = p_lodge_id
  limit 20;

  select jsonb_agg(jsonb_build_object(
    'id', pt.id,
    'provider', pt.provider,
    'amount', pt.amount,
    'currency', pt.currency,
    'created_at', pt.created_at
  )) into v_pending
  from public.payment_transactions pt
  where pt.lodge_id = p_lodge_id and pt.status = 'pending';

  select jsonb_agg(jsonb_build_object(
    'id', pt.id,
    'provider', pt.provider,
    'amount', pt.amount,
    'currency', pt.currency,
    'error_message', pt.error_message,
    'created_at', pt.created_at
  )) into v_failed
  from public.payment_transactions pt
  where pt.lodge_id = p_lodge_id and pt.status = 'failed';

  return jsonb_build_object(
    'recent_transactions', coalesce(v_recent, '[]'::jsonb),
    'pending_transactions', coalesce(v_pending, '[]'::jsonb),
    'failed_transactions', coalesce(v_failed, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_payment_dashboard(uuid) to authenticated;
