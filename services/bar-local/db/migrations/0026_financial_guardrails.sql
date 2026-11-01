-- Financial recovery, return conservation, discount authorization, and staff delegation guardrails.
CREATE TABLE bar_local.sale_return_line_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  original_sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  original_sale_line_id uuid NOT NULL REFERENCES bar_local.sale_lines(id),
  return_sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  return_sale_line_id uuid NOT NULL UNIQUE REFERENCES bar_local.sale_lines(id),
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  discount_amount numeric(14,2) NOT NULL CHECK (discount_amount >= 0),
  tax_amount numeric(14,2) NOT NULL CHECK (tax_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_return_line_allocations_original_idx
  ON bar_local.sale_return_line_allocations(original_sale_line_id, created_at, id);

CREATE TABLE bar_local.sale_return_tender_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  original_tender_id uuid NOT NULL REFERENCES bar_local.sale_tenders(id),
  return_sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  return_tender_id uuid NOT NULL UNIQUE REFERENCES bar_local.sale_tenders(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_return_tender_allocations_original_idx
  ON bar_local.sale_return_tender_allocations(original_tender_id, created_at, id);

CREATE OR REPLACE FUNCTION bar_local.enforce_sale_discount_capability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_capabilities text[];
BEGIN
  IF COALESCE(NEW.discount, 0) > 0 OR COALESCE(NEW.promotion_discount, 0) > 0 THEN
    SELECT capabilities INTO v_capabilities FROM bar_local.staff
     WHERE id = NEW.actor_staff_id AND business_id = NEW.business_id AND status = 'active';
    IF NOT COALESCE('pos.discount' = ANY(v_capabilities), false) THEN
      PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'This staff member is not authorised to apply a discount or promotion discount.');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sales_discount_capability_guard ON bar_local.sales;
CREATE TRIGGER sales_discount_capability_guard
  BEFORE INSERT OR UPDATE OF discount, promotion_discount ON bar_local.sales
  FOR EACH ROW EXECUTE FUNCTION bar_local.enforce_sale_discount_capability();

CREATE OR REPLACE FUNCTION bar_local.cmd_staff_create(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text, p_secret jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_role text;
  v_caps text[];
  v_ceiling text[];
  v_id uuid;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF p_secret IS NULL OR COALESCE(p_secret->>'pin_hash','') = '' OR COALESCE(p_secret->>'pin_salt','') = '' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A local PIN verifier is required.');
    END IF;
    v_role := v_payload->>'role';
    IF v_role = 'owner' THEN
      PERFORM bar_local.raise_business('ROLE_NOT_DELEGABLE', 'Owner identities can only be established by first-owner commissioning or the protected owner-recovery procedure.');
    END IF;
    v_ceiling := CASE v_role
      WHEN 'manager' THEN ARRAY['pos.view','pos.manage','pos.void','pos.discount','pos.cashup','pos.reports','pos.menu_manage','inventory.view','inventory.manage','inventory.approve','customers.manage','vouchers.manage','staff.manage','accounting.read','accounting.manage','export.manage']
      WHEN 'cashier' THEN ARRAY['pos.view','pos.manage','pos.reports','inventory.view','customers.manage']
      WHEN 'stock' THEN ARRAY['pos.view','inventory.view','inventory.manage']
      WHEN 'finance' THEN ARRAY['pos.view','pos.reports','accounting.read','accounting.manage','accounting.approve','export.manage']
      ELSE ARRAY[]::text[] END;
    IF cardinality(v_ceiling) = 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The requested staff role is not delegable.');
    END IF;
    IF v_role IN ('manager','stock','finance') AND v_ctx.role <> 'owner' THEN
      PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'Only an owner may create manager, stock or finance identities.');
    END IF;
    IF v_role IN ('manager','stock','finance') AND
       (SELECT count(*) FROM bar_local.staff WHERE business_id = v_ctx.business_id AND role = 'owner' AND status = 'active') > 1 THEN
      PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'staff.manage',
        v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    END IF;
    IF jsonb_typeof(v_payload->'capabilities') = 'array' THEN
      SELECT COALESCE(array_agg(DISTINCT value), ARRAY[]::text[]) INTO v_caps
        FROM jsonb_array_elements_text(v_payload->'capabilities');
    ELSE
      v_caps := v_ceiling;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_caps) c WHERE NOT c = ANY(v_ceiling) OR NOT c = ANY(v_ctx.capabilities)) THEN
      PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'Requested staff capabilities exceed the role policy or the caller delegation ceiling.');
    END IF;
    INSERT INTO bar_local.staff (business_id, display_name, role, capabilities, pin_hash, pin_salt, pin_iterations)
    VALUES (v_ctx.business_id, v_payload->>'display_name', v_role, v_caps,
            p_secret->>'pin_hash', p_secret->>'pin_salt', (p_secret->>'pin_iterations')::integer)
    RETURNING id INTO v_id;
    v_result := jsonb_build_object('staff_id', v_id, 'display_name', v_payload->>'display_name', 'role', v_role,
      'capabilities', to_jsonb(v_caps));
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'staff.created', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','staff.created','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.cmd_staff_create(text,uuid,jsonb,text,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.cmd_staff_create(text,uuid,jsonb,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_staff_create(text,uuid,jsonb,text,text,jsonb) TO bar_local_runtime;
ALTER FUNCTION bar_local.enforce_sale_discount_capability() OWNER TO bar_local_migrator;
GRANT EXECUTE ON FUNCTION bar_local.enforce_sale_discount_capability() TO bar_local_runtime;
GRANT SELECT, INSERT ON bar_local.sale_return_line_allocations, bar_local.sale_return_tender_allocations TO bar_local_runtime;
