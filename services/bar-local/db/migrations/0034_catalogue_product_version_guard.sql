-- Require stale-write protection for local product edits.
-- Preserve the registered command signature and runtime grant from the original
-- command while adding a version check and before/after audit context.

CREATE OR REPLACE FUNCTION bar_local.cmd_catalogue_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_id uuid;
  v_expected_version integer;
  v_product bar_local.products%ROWTYPE;
  v_before jsonb;
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
    v_id := NULLIF(v_payload->>'product_id', '')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO bar_local.products (business_id, sku, name, category, price, tax_rate, track_stock, active)
      VALUES (v_ctx.business_id, v_payload->>'sku', v_payload->>'name', v_payload->>'category',
              (v_payload->>'price')::numeric, (v_payload->>'tax_rate')::numeric,
              COALESCE((v_payload->>'track_stock')::boolean, true), COALESCE((v_payload->>'active')::boolean, true))
      RETURNING * INTO v_product;
    ELSE
      v_expected_version := NULLIF(v_payload->>'expected_version', '')::integer;
      IF v_expected_version IS NULL OR v_expected_version < 1 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A current product version is required before editing this item. Refresh the menu and try again.');
      END IF;
      SELECT * INTO v_product FROM bar_local.products
       WHERE id = v_id AND business_id = v_ctx.business_id FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('PRODUCT_NOT_FOUND', 'The product to update was not found in this business.');
      END IF;
      IF v_product.version <> v_expected_version THEN
        PERFORM bar_local.raise_business('PRODUCT_VERSION_CONFLICT', 'This product changed on another till. Refresh the menu and review the current values before editing again.');
      END IF;
      v_before := jsonb_build_object(
        'product_id', v_product.id, 'sku', v_product.sku, 'name', v_product.name,
        'category', v_product.category, 'price', v_product.price, 'tax_rate', v_product.tax_rate,
        'track_stock', v_product.track_stock, 'active', v_product.active, 'version', v_product.version
      );
      UPDATE bar_local.products
         SET sku = v_payload->>'sku', name = v_payload->>'name', category = v_payload->>'category',
             price = (v_payload->>'price')::numeric, tax_rate = (v_payload->>'tax_rate')::numeric,
             track_stock = COALESCE((v_payload->>'track_stock')::boolean, track_stock),
             active = COALESCE((v_payload->>'active')::boolean, active),
             version = version + 1, updated_at = now()
       WHERE id = v_id AND business_id = v_ctx.business_id
      RETURNING * INTO v_product;
    END IF;

    UPDATE bar_local.authority SET catalogue_version = catalogue_version + 1
     WHERE singleton RETURNING catalogue_version INTO v_catalogue;
    v_result := jsonb_build_object(
      'product_id', v_product.id, 'catalogue_version', v_catalogue,
      'sku', v_product.sku, 'version', v_product.version
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'catalogue.upsert', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'catalogue.upsert', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.cmd_catalogue_upsert(text, uuid, jsonb, text, text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_catalogue_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_catalogue_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_catalogue_upsert(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_catalogue_upsert(text, uuid, jsonb, text, text) FROM bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_catalogue_upsert(text, uuid, jsonb, text, text) TO bar_local_runtime;
