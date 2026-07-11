-- Store client-facing pricing/trial snapshots for automatic subscription quotations.

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
  p_notes           text DEFAULT '',
  p_pricing_snapshot jsonb DEFAULT NULL,
  p_quote_payload   jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_now timestamptz := now();
  v_quote_number text;
  v_quote_payload jsonb;
BEGIN
  PERFORM public._validate_subscription_request_payload(
    'public_website', 'new_subscription', p_property_type, p_requested_plan, p_requested_addons,
    p_company_name, p_property_name, p_contact_email, p_contact_phone
  );

  IF p_pricing_snapshot IS NOT NULL AND jsonb_typeof(p_pricing_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'pricing_snapshot must be an object';
  END IF;

  IF p_quote_payload IS NOT NULL AND jsonb_typeof(p_quote_payload) <> 'object' THEN
    RAISE EXCEPTION 'quote_payload must be an object';
  END IF;

  v_quote_number := 'QT-' || to_char(v_now, 'YYYYMMDD-HH24MISSMS');
  v_quote_payload := coalesce(p_quote_payload, '{}'::jsonb) || jsonb_build_object(
    'document_type', 'quote',
    'document_number', v_quote_number,
    'issued_at', v_now,
    'status', 'quoted'
  );

  INSERT INTO public.subscription_package_requests (
    source, request_type, company_name, property_name,
    contact_name, contact_email, contact_phone,
    country, property_type, current_plan, requested_plan, requested_addons,
    room_count, user_count, expected_monthly_bookings,
    notes, pricing_snapshot, quote_number, quote_payload, status,
    submitted_at, reviewed_at, reviewed_by, created_at, updated_at
  ) VALUES (
    'public_website', 'new_subscription', p_company_name, p_property_name,
    p_contact_name, p_contact_email, p_contact_phone,
    p_country, p_property_type, NULL, p_requested_plan, p_requested_addons,
    p_room_count, p_user_count, p_expected_monthly_bookings,
    p_notes, p_pricing_snapshot, v_quote_number, v_quote_payload, 'quoted',
    v_now, v_now, 'auto-quote', v_now, v_now
  ) RETURNING id INTO v_id;

  IF to_regclass('public.admin_notifications') IS NOT NULL THEN
    INSERT INTO public.admin_notifications (
      title,
      body,
      type,
      entity_type,
      entity_id,
      created_at
    ) VALUES (
      'New package quotation request',
      concat_ws(
        E'\n',
        'Quote: ' || v_quote_number,
        'Property: ' || coalesce(nullif(p_property_name, ''), nullif(p_company_name, ''), 'Unknown'),
        'Contact: ' || coalesce(nullif(p_contact_name, ''), 'Unknown'),
        'Email: ' || coalesce(nullif(p_contact_email, ''), 'Not supplied'),
        'Phone: ' || coalesce(nullif(p_contact_phone, ''), 'Not supplied'),
        'Requested package: ' || p_requested_plan
      ),
      'action_required',
      'subscription_package_request',
      v_id::text,
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'quote_number', v_quote_number,
    'quote_payload', v_quote_payload,
    'submitted_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_public_subscription_request(text, text, text, text, text, text, text, text, jsonb, integer, integer, integer, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_subscription_request(text, text, text, text, text, text, text, text, jsonb, integer, integer, integer, text, jsonb, jsonb) TO anon, authenticated, service_role;
