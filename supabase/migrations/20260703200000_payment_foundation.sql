-- ── Phase 8: Custom Website and Payments Foundation ─────────────────────────
-- Creates booking intents, payment intents, and payment provider config tables.

-- ── 1. Payment Provider Config ───────────────────────────────────────────────
-- Stores per-lodge payment gateway configuration. Secrets are stored server-side only.
-- Provider keys: 'dpo', 'paygate', 'paystack', 'flutterwave', 'stripe', 'manual_adapter'
CREATE TABLE IF NOT EXISTS public.payment_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('dpo', 'paygate', 'paystack', 'flutterwave', 'stripe', 'manual_adapter')),
  mode text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  country text NOT NULL DEFAULT 'BW',
  currency text NOT NULL DEFAULT 'BWP',
  public_key text,
  secret_key text,
  webhook_secret text,
  merchant_account_id text,
  settlement_bank text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lodge_id, provider, mode)
);

ALTER TABLE public.payment_provider_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_provider_configs_lodge_policy ON public.payment_provider_configs
  USING (public.app_lodge_access(lodge_id));

GRANT SELECT ON public.payment_provider_configs TO authenticated, anon;
-- Mutations go through RPCs only
REVOKE INSERT, UPDATE, DELETE ON public.payment_provider_configs FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS payment_provider_configs_lodge_idx ON public.payment_provider_configs (lodge_id, is_active);

-- ── 2. Public Booking Intents ────────────────────────────────────────────────
-- Stores a guest's intent to book before payment. Created server-side after
-- availability check and price calculation. Expires after 30 minutes.
CREATE TABLE IF NOT EXISTS public.booking_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  slug text NOT NULL,
  room_id uuid NOT NULL,
  room_number text,
  room_type text,
  check_in date NOT NULL,
  check_out date NOT NULL,
  nights integer NOT NULL DEFAULT 1,
  adults integer NOT NULL DEFAULT 1,
  children integer NOT NULL DEFAULT 0,
  guest_first_name text NOT NULL,
  guest_last_name text NOT NULL,
  guest_email text NOT NULL,
  guest_phone text NOT NULL,
  booking_type text NOT NULL DEFAULT 'room',
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  deposit_amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BWP',
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'payment_started', 'payment_completed', 'payment_failed', 'expired', 'cancelled', 'confirmed')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.booking_intents ENABLE ROW LEVEL SECURITY;

-- Service-role only for booking intents (created by RPC, read by webhook)
GRANT SELECT ON public.booking_intents TO authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.booking_intents FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS booking_intents_lodge_status_idx ON public.booking_intents (lodge_id, status);
CREATE INDEX IF NOT EXISTS booking_intents_expires_idx ON public.booking_intents (expires_at) WHERE status IN ('pending', 'payment_started');
CREATE INDEX IF NOT EXISTS booking_intents_slug_idx ON public.booking_intents (slug, status);

-- ── 3. Payment Intents ──────────────────────────────────────────────────────
-- Tracks payment state for a booking intent. One-to-one with booking_intents.
-- State machine: created -> processing -> succeeded | failed | refunded
CREATE TABLE IF NOT EXISTS public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_intent_id uuid NOT NULL REFERENCES public.booking_intents(id) ON DELETE CASCADE,
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_payment_id text,
  provider_reference text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BWP',
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'processing', 'succeeded', 'failed', 'refunded')),
  failure_reason text,
  webhook_received_at timestamptz,
  webhook_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.payment_intents TO authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_intents FROM authenticated, anon;

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_booking_idx ON public.payment_intents (booking_intent_id);
CREATE INDEX IF NOT EXISTS payment_intents_provider_idx ON public.payment_intents (provider, provider_payment_id);
CREATE INDEX IF NOT EXISTS payment_intents_lodge_status_idx ON public.payment_intents (lodge_id, status);

-- ── 4. RPCs ─────────────────────────────────────────────────────────────────

-- Create a booking intent (called from public booking site)
CREATE OR REPLACE FUNCTION public.create_booking_intent(
  p_slug text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
  v_room_id uuid;
  v_room_number text;
  v_room_type text;
  v_check_in date;
  v_check_out date;
  v_nights integer;
  v_adults integer;
  v_children integer;
  v_total numeric(12,2);
  v_deposit numeric(12,2);
  v_currency text;
  v_intent_id uuid;
  v_room_available boolean;
BEGIN
  -- Validate slug
  IF p_slug IS NULL OR p_slug = '' THEN
    RAISE EXCEPTION 'Property slug is required';
  END IF;

  -- Resolve lodge
  SELECT lodge_id, COALESCE(currency, 'BWP') INTO v_lodge_id, v_currency
  FROM public.settings
  WHERE slug = p_slug
    AND COALESCE(deleted, false) = false;
  IF v_lodge_id IS NULL THEN
    RAISE EXCEPTION 'Property not found or inactive';
  END IF;

  -- Extract payload
  v_room_id := nullif(p_payload->>'room_id', '')::uuid;
  v_check_in := nullif(p_payload->>'check_in', '')::date;
  v_check_out := nullif(p_payload->>'check_out', '')::date;
  v_adults := COALESCE((p_payload->>'adults')::int, 1);
  v_children := COALESCE((p_payload->>'children')::int, 0);

  -- Validate dates
  IF v_check_in IS NULL OR v_check_out IS NULL THEN
    RAISE EXCEPTION 'Check-in and check-out dates are required';
  END IF;
  IF v_check_out <= v_check_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;

  v_nights := v_check_out - v_check_in;
  IF v_nights < 1 THEN
    RAISE EXCEPTION 'Minimum stay is 1 night';
  END IF;
  IF v_adults < 1 THEN
    RAISE EXCEPTION 'At least 1 adult is required';
  END IF;

  -- Validate room exists and belongs to this lodge
  SELECT room_number, room_type INTO v_room_number, v_room_type
  FROM public.rooms
  WHERE id = v_room_id AND lodge_id = v_lodge_id;
  IF v_room_number IS NULL THEN
    RAISE EXCEPTION 'Room not found for this property';
  END IF;

  -- Check availability (no overlapping confirmed/pending bookings)
  v_room_available := NOT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.room_id = v_room_id
      AND b.status IN ('confirmed', 'pending')
      AND b.check_in < v_check_out
      AND b.check_out > v_check_in
  );
  IF NOT v_room_available THEN
    RAISE EXCEPTION 'Room is not available for the selected dates';
  END IF;

  -- Calculate price (use room rate * nights as estimate)
  -- Authoritative pricing should come from rate plans if available
  v_total := (
    SELECT COALESCE(r.rate_per_night, 0) * v_nights
    FROM public.rooms r WHERE r.id = v_room_id
  );
  v_deposit := ROUND(v_total * 0.25, 2); -- 25% deposit estimate

  -- Create intent
  v_intent_id := gen_random_uuid();
  INSERT INTO public.booking_intents (
    id, lodge_id, slug, room_id, room_number, room_type,
    check_in, check_out, nights, adults, children,
    guest_first_name, guest_last_name, guest_email, guest_phone,
    booking_type, total_amount, deposit_amount, currency, notes
  ) VALUES (
    v_intent_id, v_lodge_id, p_slug, v_room_id, v_room_number, v_room_type,
    v_check_in, v_check_out, v_nights, v_adults, v_children,
    p_payload->>'guest_first_name', p_payload->>'guest_last_name',
    p_payload->>'guest_email', p_payload->>'guest_phone',
    COALESCE(p_payload->>'booking_type', 'room'),
    v_total, v_deposit, v_currency, p_payload->>'notes'
  );

  RETURN jsonb_build_object(
    'success', true,
    'intent_id', v_intent_id,
    'total_amount', v_total,
    'deposit_amount', v_deposit,
    'currency', v_currency,
    'expires_at', (now() + interval '30 minutes')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking_intent(text, jsonb) TO anon, authenticated;

-- Create a payment intent (called internally after checkout creation)
CREATE OR REPLACE FUNCTION public.create_payment_intent(
  p_booking_intent_id uuid,
  p_provider text,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pi_id uuid;
  v_lodge_id uuid;
  v_currency text;
BEGIN
  IF p_booking_intent_id IS NULL THEN
    RAISE EXCEPTION 'Booking intent ID is required';
  END IF;

  -- Get lodge from booking intent
  SELECT bi.lodge_id, bi.currency INTO v_lodge_id, v_currency
  FROM public.booking_intents bi
  WHERE bi.id = p_booking_intent_id AND bi.status = 'pending';
  IF v_lodge_id IS NULL THEN
    RAISE EXCEPTION 'Booking intent not found or no longer pending';
  END IF;

  -- Verify provider is configured for this lodge
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_provider_configs
    WHERE lodge_id = v_lodge_id AND provider = p_provider AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Payment provider % is not configured for this property', p_provider;
  END IF;

  -- Create payment intent
  v_pi_id := gen_random_uuid();
  INSERT INTO public.payment_intents (id, booking_intent_id, lodge_id, provider, amount, currency)
  VALUES (v_pi_id, p_booking_intent_id, v_lodge_id, p_provider, p_amount, v_currency);

  -- Update booking intent status
  UPDATE public.booking_intents
  SET status = 'payment_started', updated_at = now()
  WHERE id = p_booking_intent_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_intent_id', v_pi_id,
    'provider', p_provider,
    'amount', p_amount,
    'currency', v_currency
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_intent(uuid, text, numeric) TO authenticated;

-- Confirm payment from webhook (service-role)
CREATE OR REPLACE FUNCTION public.confirm_payment_from_webhook(
  p_provider_payment_id text,
  p_provider text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pi record;
  v_bi record;
  v_booking_id uuid;
BEGIN
  -- Find payment intent by provider payment ID
  SELECT * INTO v_pi
  FROM public.payment_intents
  WHERE provider_payment_id = p_provider_payment_id AND provider = p_provider
  LIMIT 1;

  IF v_pi IS NULL THEN
    RAISE EXCEPTION 'Payment intent not found for provider payment %', p_provider_payment_id;
  END IF;

  -- Idempotent: if already succeeded, return success
  IF v_pi.status = 'succeeded' THEN
    RETURN jsonb_build_object('success', true, 'booking_id', NULL, 'already_processed', true);
  END IF;

  -- Get booking intent
  SELECT * INTO v_bi
  FROM public.booking_intents
  WHERE id = v_pi.booking_intent_id;
  IF v_bi IS NULL THEN
    RAISE EXCEPTION 'Booking intent not found';
  END IF;

  -- Mark payment as succeeded
  UPDATE public.payment_intents
  SET status = 'succeeded',
      webhook_received_at = now(),
      webhook_payload = p_payload,
      updated_at = now()
  WHERE id = v_pi.id;

  -- Mark booking intent as payment completed
  UPDATE public.booking_intents
  SET status = 'payment_completed', updated_at = now()
  WHERE id = v_bi.id;

  -- Create the actual booking through existing authoritative RPC
  -- The booking creation should go through create_booking or equivalent
  -- For now, return success with the intent data for the caller to create the booking
  RETURN jsonb_build_object(
    'success', true,
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payment_from_webhook(text, text, jsonb) TO service_role;

-- Get payment provider config for a lodge
CREATE OR REPLACE FUNCTION public.get_payment_provider_config(
  p_lodge_id uuid,
  p_provider text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_configs jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'id', ppc.id,
    'provider', ppc.provider,
    'mode', ppc.mode,
    'country', ppc.country,
    'currency', ppc.currency,
    'public_key', ppc.public_key,
    'is_active', ppc.is_active
  )) INTO v_configs
  FROM public.payment_provider_configs ppc
  WHERE ppc.lodge_id = p_lodge_id
    AND ppc.is_active = true
    AND (p_provider IS NULL OR ppc.provider = p_provider);

  RETURN COALESCE(v_configs, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_payment_provider_config(uuid, text) TO authenticated, anon;

-- Save payment provider config
CREATE OR REPLACE FUNCTION public.save_payment_provider_config(
  p_lodge_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text;
  v_mode text;
  v_config_id uuid;
BEGIN
  -- Require manager/admin role
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  v_provider := p_payload->>'provider';
  v_mode := COALESCE(p_payload->>'mode', 'test');

  IF v_provider IS NULL OR v_provider = '' THEN
    RAISE EXCEPTION 'Provider name is required';
  END IF;

  -- Upsert config
  INSERT INTO public.payment_provider_configs (
    lodge_id, provider, mode, country, currency,
    public_key, secret_key, webhook_secret,
    merchant_account_id, settlement_bank, is_active
  ) VALUES (
    p_lodge_id,
    v_provider,
    v_mode,
    COALESCE(p_payload->>'country', 'BW'),
    COALESCE(p_payload->>'currency', 'BWP'),
    p_payload->>'public_key',
    p_payload->>'secret_key',
    p_payload->>'webhook_secret',
    p_payload->>'merchant_account_id',
    p_payload->>'settlement_bank',
    COALESCE((p_payload->>'is_active')::boolean, true)
  )
  ON CONFLICT (lodge_id, provider, mode) DO UPDATE SET
    public_key = EXCLUDED.public_key,
    secret_key = EXCLUDED.secret_key,
    webhook_secret = EXCLUDED.webhook_secret,
    merchant_account_id = EXCLUDED.merchant_account_id,
    settlement_bank = EXCLUDED.settlement_bank,
    is_active = EXCLUDED.is_active,
    country = EXCLUDED.country,
    currency = EXCLUDED.currency,
    updated_at = now()
  RETURNING id INTO v_config_id;

  RETURN jsonb_build_object('success', true, 'config_id', v_config_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_payment_provider_config(uuid, jsonb) TO authenticated;

-- Expire stale booking intents (run periodically)
CREATE OR REPLACE FUNCTION public.expire_stale_booking_intents()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired integer;
BEGIN
  UPDATE public.booking_intents
  SET status = 'expired', updated_at = now()
  WHERE status IN ('pending', 'payment_started')
    AND expires_at < now();

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_booking_intents() TO service_role;

-- ── 5. RLS policies for booking_intents (guest can read own) ─────────────────
-- No public RLS - booking intents are internal. Guests see success/failure via
-- the payment flow redirect, not direct DB access.
