-- Outlet-scoped sellability. Products remain globally catalogued, while each
-- outlet can mark an item sold out without changing its price or stock ledger.

CREATE TABLE bar_local.product_availability (
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  available boolean NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  created_operation_id uuid NOT NULL,
  updated_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, outlet_id, product_id)
);
CREATE INDEX product_availability_product_idx ON bar_local.product_availability (business_id, product_id);

CREATE OR REPLACE FUNCTION bar_local.price_and_deplete_items(
  p_business_id uuid,
  p_outlet_id uuid,
  p_items jsonb,
  p_operation_id uuid,
  p_business_date date,
  p_deplete boolean
) RETURNS TABLE (
  product_id uuid, name text, sku text, quantity numeric, unit_price numeric,
  tax_rate numeric, line_subtotal numeric, line_tax numeric, line_total numeric, notes text
) LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v_item jsonb;
  v_product bar_local.products%ROWTYPE;
  v_qty numeric(18,6);
  v_on_hand numeric(18,6);
  v_allow_negative boolean := false;
  v_subtotal numeric(14,2);
  v_tax numeric(14,2);
BEGIN
  SELECT COALESCE((value #>> '{}')::boolean, false) INTO v_allow_negative
    FROM bar_local.settings WHERE key = 'allow_negative_stock';
  v_allow_negative := COALESCE(v_allow_negative, false);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Item quantity must be greater than zero.');
    END IF;
    SELECT * INTO v_product FROM bar_local.products
     WHERE id = (v_item->>'product_id')::uuid AND business_id = p_business_id AND active;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('PRODUCT_UNAVAILABLE', 'A selected product is not available in the local catalogue. Refresh the menu.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM bar_local.product_availability pa
       WHERE pa.business_id = p_business_id
         AND pa.outlet_id = p_outlet_id
         AND pa.product_id = v_product.id
         AND NOT pa.available
    ) THEN
      PERFORM bar_local.raise_business('PRODUCT_UNAVAILABLE', v_product.name || ' is marked unavailable in this outlet.');
    END IF;
    IF v_product.track_stock THEN
      INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
      VALUES (p_business_id, p_outlet_id, v_product.id, 0)
      ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
      SELECT quantity INTO v_on_hand FROM bar_local.stock_balances
       WHERE business_id = p_business_id AND outlet_id = p_outlet_id AND product_id = v_product.id
       FOR UPDATE;
      IF v_on_hand < v_qty AND NOT v_allow_negative THEN
        PERFORM bar_local.raise_business('INSUFFICIENT_STOCK', 'Not enough stock for ' || v_product.name || '. Another till may have sold it.');
      END IF;
      IF p_deplete THEN
        UPDATE bar_local.stock_balances
           SET quantity = quantity - v_qty, version = version + 1, updated_at = now()
         WHERE business_id = p_business_id AND outlet_id = p_outlet_id AND product_id = v_product.id;
        INSERT INTO bar_local.stock_movements
          (business_id, outlet_id, product_id, delta, reason, operation_id, business_date)
        VALUES (p_business_id, p_outlet_id, v_product.id, -v_qty, 'sale.depletion', p_operation_id, p_business_date);
      END IF;
    END IF;
    v_subtotal := round(v_product.price * v_qty, 2);
    v_tax := round(v_subtotal * v_product.tax_rate, 2);
    product_id := v_product.id;
    name := v_product.name;
    sku := v_product.sku;
    quantity := v_qty;
    unit_price := v_product.price;
    tax_rate := v_product.tax_rate;
    line_subtotal := v_subtotal;
    line_tax := v_tax;
    line_total := v_subtotal + v_tax;
    notes := v_item->>'notes';
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_catalogue_availability_set(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_product bar_local.products%ROWTYPE;
  v_existing bar_local.product_availability%ROWTYPE;
  v_before jsonb;
  v_version integer;
  v_available boolean;
  v_catalogue bigint;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.menu_manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_available := (v_payload->>'available')::boolean;
    IF v_available IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'An availability value is required.');
    END IF;
    SELECT * INTO v_product FROM bar_local.products
     WHERE id = (v_payload->>'product_id')::uuid AND business_id = v_ctx.business_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('PRODUCT_NOT_FOUND', 'The product could not be found in this business.');
    END IF;
    SELECT * INTO v_existing FROM bar_local.product_availability
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND product_id = v_product.id
     FOR UPDATE;
    IF FOUND THEN
      IF NULLIF(v_payload->>'expected_version', '') IS NULL THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'An expected availability version is required for an update.');
      END IF;
      IF v_existing.version <> (v_payload->>'expected_version')::integer THEN
        PERFORM bar_local.raise_business('PRODUCT_AVAILABILITY_VERSION_CONFLICT', 'The outlet availability changed since it was loaded. Refresh and try again.');
      END IF;
      v_before := to_jsonb(v_existing);
      UPDATE bar_local.product_availability
         SET available = v_available,
             version = version + 1,
             updated_by = v_ctx.staff_id,
             updated_operation_id = (p_envelope->>'operation_id')::uuid,
             updated_at = now()
       WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND product_id = v_product.id
       RETURNING version INTO v_version;
    ELSE
      IF NULLIF(v_payload->>'expected_version', '') IS NOT NULL THEN
        PERFORM bar_local.raise_business('PRODUCT_AVAILABILITY_VERSION_CONFLICT', 'No outlet availability exists for the expected version. Refresh and try again.');
      END IF;
      INSERT INTO bar_local.product_availability
        (business_id, outlet_id, product_id, available, created_by, updated_by,
         created_operation_id, updated_operation_id)
      VALUES
        (v_ctx.business_id, v_ctx.outlet_id, v_product.id, v_available, v_ctx.staff_id, v_ctx.staff_id,
         (p_envelope->>'operation_id')::uuid, (p_envelope->>'operation_id')::uuid)
      RETURNING version INTO v_version;
      v_before := NULL;
    END IF;
    UPDATE bar_local.authority
       SET catalogue_version = catalogue_version + 1
     WHERE singleton
     RETURNING catalogue_version INTO v_catalogue;
    v_result := jsonb_build_object(
      'product_id', v_product.id,
      'outlet_id', v_ctx.outlet_id,
      'available', v_available,
      'version', v_version,
      'catalogue_version', v_catalogue
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'catalogue.availability.updated', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'catalogue.availability.updated', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'Outlet availability already exists for this product.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_purchasing;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_query text,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_outlet uuid;
  v_limit integer;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_filters jsonb;
BEGIN
  IF p_query IS DISTINCT FROM 'menu.availability' THEN
    RETURN bar_local.query_dispatch_purchasing(
      p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
    );
  END IF;
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.view');
  v_outlet := bar_local.query_outlet(v_ctx, COALESCE(p_filters, '{}'::jsonb));
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_limit := bar_local.query_limit(v_filters);
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sku, x.product_id), '[]'::jsonb) INTO v_data
    FROM (
      SELECT p.id AS product_id, p.sku, p.name, p.category, p.price, p.tax_rate, p.track_stock,
             p.active AS product_active,
             (p.active AND COALESCE(pa.available, true)) AS available,
             pa.available AS override_available,
             COALESCE(pa.version, 0) AS availability_version,
             COALESCE(sb.quantity, 0) AS stock_quantity,
             pa.updated_at AS availability_updated_at
        FROM bar_local.products p
        LEFT JOIN bar_local.product_availability pa
          ON pa.business_id = p.business_id AND pa.outlet_id = v_outlet AND pa.product_id = p.id
        LEFT JOIN bar_local.stock_balances sb
          ON sb.business_id = p.business_id AND sb.outlet_id = v_outlet AND sb.product_id = p.id
       WHERE p.business_id = v_ctx.business_id
         AND (COALESCE((v_filters->>'include_inactive')::boolean, false) OR p.active)
         AND (NOT COALESCE((v_filters->>'available_only')::boolean, false)
              OR (p.active AND COALESCE(pa.available, true)))
         AND (v_filters->>'cursor' IS NULL OR p.sku > v_filters->>'cursor')
       ORDER BY p.sku, p.id
       LIMIT v_limit + 1
    ) x;
  IF jsonb_array_length(v_data) > v_limit THEN
    v_data := v_data - v_limit;
    v_has_more := true;
    v_next := v_data->-1->>'sku';
  END IF;
  RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
    'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);
END;
$$;

REVOKE ALL ON bar_local.product_availability FROM PUBLIC;
REVOKE ALL ON bar_local.product_availability FROM bar_local_runtime;

ALTER FUNCTION bar_local.cmd_catalogue_availability_set(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_catalogue_availability_set(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_catalogue_availability_set(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_catalogue_availability_set(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch_purchasing(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_purchasing(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_purchasing(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_purchasing(text, uuid, uuid, bigint, text, jsonb) FROM bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
