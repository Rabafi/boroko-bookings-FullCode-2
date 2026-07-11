-- 20260704001000_subscription_requests_activation_hardening.sql
-- Harden commercial request intake and keep admin actions service-role only.

ALTER TABLE public.subscription_package_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscription_package_requests
  ADD COLUMN IF NOT EXISTS quote_payload jsonb,
  ADD COLUMN IF NOT EXISTS invoice_payload jsonb,
  ADD COLUMN IF NOT EXISTS invoice_number text;

DROP POLICY IF EXISTS "Anon can insert public subscription requests" ON public.subscription_package_requests;
DROP POLICY IF EXISTS "Authenticated users can read own subscription requests" ON public.subscription_package_requests;

CREATE POLICY subscription_package_requests_lodge_read
  ON public.subscription_package_requests
  FOR SELECT
  TO authenticated
  USING (
    lodge_id IS NOT NULL
    AND public.app_lodge_access(lodge_id)
  );

CREATE OR REPLACE FUNCTION public._validate_subscription_request_payload(
  p_source text,
  p_request_type text,
  p_property_type text,
  p_requested_plan text,
  p_requested_addons jsonb,
  p_company_name text,
  p_property_name text,
  p_contact_email text,
  p_contact_phone text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(p_source, '') NOT IN ('desktop_app', 'public_website', 'admin', 'support') THEN
    RAISE EXCEPTION 'Invalid subscription request source';
  END IF;

  IF coalesce(p_request_type, '') NOT IN ('new_subscription', 'plan_upgrade', 'addon_request', 'capacity_pack') THEN
    RAISE EXCEPTION 'Invalid subscription request type';
  END IF;

  IF coalesce(p_property_type, '') NOT IN ('guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant') THEN
    RAISE EXCEPTION 'Invalid property type';
  END IF;

  IF coalesce(p_requested_plan, '') NOT IN ('Starter', 'Standard', 'Pro', 'Enterprise') THEN
    RAISE EXCEPTION 'Invalid requested plan';
  END IF;

  IF jsonb_typeof(coalesce(p_requested_addons, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'requested_addons must be an array';
  END IF;

  IF coalesce(p_source, '') = 'public_website' THEN
    IF nullif(btrim(coalesce(p_company_name, '')), '') IS NULL
       AND nullif(btrim(coalesce(p_property_name, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Company or property name is required';
    END IF;

    IF nullif(btrim(coalesce(p_contact_email, '')), '') IS NULL
       AND nullif(btrim(coalesce(p_contact_phone, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Email or phone is required';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_subscription_request(
  p_source          text DEFAULT 'desktop_app',
  p_request_type    text DEFAULT 'plan_upgrade',
  p_lodge_id        uuid DEFAULT NULL,
  p_existing_license_id uuid DEFAULT NULL,
  p_company_name    text DEFAULT '',
  p_property_name   text DEFAULT '',
  p_contact_name    text DEFAULT '',
  p_contact_email   text DEFAULT '',
  p_contact_phone   text DEFAULT '',
  p_country         text DEFAULT '',
  p_property_type   text DEFAULT 'lodge',
  p_current_plan    text DEFAULT NULL,
  p_requested_plan  text DEFAULT 'Starter',
  p_requested_addons jsonb DEFAULT '[]'::jsonb,
  p_room_count      integer DEFAULT NULL,
  p_user_count      integer DEFAULT NULL,
  p_expected_monthly_bookings integer DEFAULT NULL,
  p_pricing_snapshot jsonb DEFAULT NULL,
  p_quote_number    text DEFAULT NULL,
  p_notes           text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_now timestamptz := now();
BEGIN
  IF p_lodge_id IS NULL THEN
    RAISE EXCEPTION 'lodge_id is required for in-app subscription requests';
  END IF;

  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  PERFORM public._validate_subscription_request_payload(
    p_source, p_request_type, p_property_type, p_requested_plan, p_requested_addons,
    p_company_name, p_property_name, p_contact_email, p_contact_phone
  );

  INSERT INTO public.subscription_package_requests (
    source, request_type, lodge_id, existing_license_id,
    company_name, property_name, contact_name, contact_email, contact_phone,
    country, property_type, current_plan, requested_plan, requested_addons,
    room_count, user_count, expected_monthly_bookings,
    pricing_snapshot, quote_number, notes, status, submitted_at, created_at, updated_at
  ) VALUES (
    'desktop_app', p_request_type, p_lodge_id, p_existing_license_id,
    p_company_name, p_property_name, p_contact_name, p_contact_email, p_contact_phone,
    p_country, p_property_type, p_current_plan, p_requested_plan, p_requested_addons,
    p_room_count, p_user_count, p_expected_monthly_bookings,
    p_pricing_snapshot, p_quote_number, p_notes, 'submitted', v_now, v_now, v_now
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'submitted_at', v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_public_subscription_request(
  p_company_name    text DEFAULT '',
  p_property_name   text DEFAULT '',
  p_contact_name    text DEFAULT '',
  p_contact_email   text DEFAULT '',
  p_contact_phone   text DEFAULT '',
  p_country         text DEFAULT '',
  p_property_type   text DEFAULT 'lodge',
  p_requested_plan  text DEFAULT 'Starter',
  p_requested_addons jsonb DEFAULT '[]'::jsonb,
  p_room_count      integer DEFAULT NULL,
  p_user_count      integer DEFAULT NULL,
  p_expected_monthly_bookings integer DEFAULT NULL,
  p_notes           text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_now timestamptz := now();
  v_quote_number text;
BEGIN
  PERFORM public._validate_subscription_request_payload(
    'public_website', 'new_subscription', p_property_type, p_requested_plan, p_requested_addons,
    p_company_name, p_property_name, p_contact_email, p_contact_phone
  );

  v_quote_number := 'QT-' || to_char(v_now, 'YYYYMMDD-HH24MISSMS');

  INSERT INTO public.subscription_package_requests (
    source, request_type, company_name, property_name,
    contact_name, contact_email, contact_phone,
    country, property_type, current_plan, requested_plan, requested_addons,
    room_count, user_count, expected_monthly_bookings,
    notes, quote_number, status, submitted_at, created_at, updated_at
  ) VALUES (
    'public_website', 'new_subscription', p_company_name, p_property_name,
    p_contact_name, p_contact_email, p_contact_phone,
    p_country, p_property_type, NULL, p_requested_plan, p_requested_addons,
    p_room_count, p_user_count, p_expected_monthly_bookings,
    p_notes, v_quote_number, 'submitted', v_now, v_now, v_now
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'quote_number', v_quote_number, 'submitted_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.get_subscription_requests(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_subscription_request_by_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_subscription_request_status(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_subscription_request(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_subscription_requests(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_subscription_request_by_id(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_subscription_request_status(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_subscription_request(uuid, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.submit_subscription_request(text, text, uuid, uuid, text, text, text, text, text, text, text, text, text, jsonb, integer, integer, integer, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_subscription_request(text, text, uuid, uuid, text, text, text, text, text, text, text, text, text, jsonb, integer, integer, integer, jsonb, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_public_subscription_request(text, text, text, text, text, text, text, text, jsonb, integer, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_subscription_request(text, text, text, text, text, text, text, text, jsonb, integer, integer, integer, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_subscription_request_document(
  p_request_id uuid,
  p_document_type text,
  p_document_payload jsonb,
  p_quote_pdf_path_or_url text DEFAULT NULL,
  p_reviewed_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_request record;
  v_document_number text;
  v_status text;
BEGIN
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request ID is required');
  END IF;

  IF p_document_type NOT IN ('quote', 'invoice') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Document type must be quote or invoice');
  END IF;

  IF p_document_payload IS NULL OR jsonb_typeof(p_document_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Document payload must be an object');
  END IF;

  SELECT * INTO v_request
  FROM public.subscription_package_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF v_request.status IN ('activated', 'rejected', 'expired') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Closed requests cannot receive new commercial documents');
  END IF;

  v_document_number := coalesce(
    nullif(p_document_payload->>'document_number', ''),
    CASE WHEN p_document_type = 'invoice'
      THEN 'PF-' || to_char(v_now, 'YYYYMMDD-HH24MISSMS')
      ELSE 'QT-' || to_char(v_now, 'YYYYMMDD-HH24MISSMS')
    END
  );
  v_status := CASE WHEN p_document_type = 'invoice' THEN 'invoice_sent' ELSE 'quoted' END;

  UPDATE public.subscription_package_requests SET
    status = v_status,
    quote_number = CASE WHEN p_document_type = 'quote' THEN v_document_number ELSE quote_number END,
    quote_payload = CASE WHEN p_document_type = 'quote' THEN p_document_payload || jsonb_build_object('document_number', v_document_number) ELSE quote_payload END,
    quote_pdf_path_or_url = CASE WHEN p_document_type = 'quote' THEN p_quote_pdf_path_or_url ELSE quote_pdf_path_or_url END,
    invoice_number = CASE WHEN p_document_type = 'invoice' THEN v_document_number ELSE invoice_number END,
    invoice_payload = CASE WHEN p_document_type = 'invoice' THEN p_document_payload || jsonb_build_object('document_number', v_document_number) ELSE invoice_payload END,
    reviewed_at = v_now,
    reviewed_by = coalesce(p_reviewed_by, reviewed_by),
    updated_at = v_now
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', p_request_id,
    'status', v_status,
    'document_type', p_document_type,
    'document_number', v_document_number,
    'updated_at', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_subscription_request(
  p_request_id uuid,
  p_activated_by text DEFAULT 'admin',
  p_activation_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_request record;
  v_license_id uuid;
  v_lodge_id uuid;
BEGIN
  SELECT * INTO v_request
  FROM public.subscription_package_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF v_request.status NOT IN ('approved', 'payment_under_review') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request must be approved or payment_under_review before activation');
  END IF;

  IF p_activation_payload IS NULL OR jsonb_typeof(p_activation_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Activation payload is required');
  END IF;

  v_license_id := nullif(p_activation_payload->>'license_id', '')::uuid;
  v_lodge_id := nullif(p_activation_payload->>'lodge_id', '')::uuid;

  IF v_license_id IS NULL OR v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'license_id and lodge_id are required for activation');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.licenses l
    WHERE l.id = v_license_id
      AND l.lodge_id = v_lodge_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected license does not belong to the selected lodge');
  END IF;

  UPDATE public.subscription_package_requests SET
    status = 'activated',
    lodge_id = coalesce(lodge_id, v_lodge_id),
    existing_license_id = coalesce(existing_license_id, v_license_id),
    activated_at = v_now,
    activated_by = p_activated_by,
    activation_payload = p_activation_payload,
    updated_at = v_now
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', p_request_id,
    'status', 'activated',
    'activated_at', v_now,
    'activated_by', p_activated_by,
    'license_id', v_license_id,
    'lodge_id', v_lodge_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_subscription_request_document(uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_subscription_request_document(uuid, text, jsonb, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.activate_subscription_request(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_subscription_request(uuid, text, jsonb) TO service_role;
