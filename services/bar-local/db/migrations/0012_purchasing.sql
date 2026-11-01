CREATE SEQUENCE bar_local.purchase_order_number_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE bar_local.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  contact_name text,
  phone text,
  email text,
  address text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  created_operation_id uuid NOT NULL,
  updated_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_business_name_key ON bar_local.suppliers (business_id, lower(name));
CREATE INDEX suppliers_business_active_idx ON bar_local.suppliers (business_id, active, name);

CREATE TABLE bar_local.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  supplier_id uuid NOT NULL REFERENCES bar_local.suppliers(id),
  po_number text NOT NULL,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'partially_received', 'received', 'cancelled')),
  ordered_on date NOT NULL,
  expected_on date,
  notes text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  cancelled_by uuid REFERENCES bar_local.staff(id),
  cancelled_at timestamptz,
  cancel_reason text,
  operation_id uuid NOT NULL UNIQUE,
  cancel_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, po_number)
);
CREATE INDEX purchase_orders_outlet_status_idx ON bar_local.purchase_orders (business_id, outlet_id, status, po_number);
CREATE INDEX purchase_orders_supplier_idx ON bar_local.purchase_orders (business_id, supplier_id, po_number);

CREATE TABLE bar_local.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES bar_local.purchase_orders(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  sku_snapshot text NOT NULL,
  name_snapshot text NOT NULL,
  quantity_ordered numeric(18,6) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received numeric(18,6) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  tax_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 1),
  line_subtotal numeric(14,2) NOT NULL CHECK (line_subtotal >= 0),
  line_tax numeric(14,2) NOT NULL CHECK (line_tax >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  line_number integer NOT NULL CHECK (line_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_order_id, product_id),
  UNIQUE (purchase_order_id, line_number)
);
CREATE INDEX purchase_order_lines_product_idx ON bar_local.purchase_order_lines (product_id, purchase_order_id);

CREATE TABLE bar_local.purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  purchase_order_id uuid NOT NULL REFERENCES bar_local.purchase_orders(id),
  supplier_reference text,
  notes text,
  received_on date NOT NULL,
  received_by uuid NOT NULL REFERENCES bar_local.staff(id),
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  operation_id uuid NOT NULL UNIQUE,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_receipts_order_idx ON bar_local.purchase_receipts (purchase_order_id, received_at);

CREATE TABLE bar_local.purchase_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_receipt_id uuid NOT NULL REFERENCES bar_local.purchase_receipts(id),
  purchase_order_line_id uuid NOT NULL REFERENCES bar_local.purchase_order_lines(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  stock_movement_id uuid NOT NULL REFERENCES bar_local.stock_movements(id),
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  lot_code text,
  expires_on date,
  line_subtotal numeric(14,2) NOT NULL CHECK (line_subtotal >= 0),
  line_tax numeric(14,2) NOT NULL CHECK (line_tax >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_receipt_lines_receipt_idx ON bar_local.purchase_receipt_lines (purchase_receipt_id);
CREATE INDEX purchase_receipt_lines_order_line_idx ON bar_local.purchase_receipt_lines (purchase_order_line_id);

CREATE OR REPLACE FUNCTION bar_local.cmd_supplier_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_supplier bar_local.suppliers%ROWTYPE;
  v_before jsonb;
  v_id uuid;
  v_version integer;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF NULLIF(v_payload->>'supplier_id', '') IS NOT NULL THEN
      SELECT * INTO v_supplier FROM bar_local.suppliers
       WHERE id = (v_payload->>'supplier_id')::uuid AND business_id = v_ctx.business_id
       FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('SUPPLIER_NOT_FOUND', 'The supplier could not be found in this business.');
      END IF;
      IF NULLIF(v_payload->>'expected_version', '') IS NULL THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'An expected supplier version is required for updates.');
      END IF;
      IF v_supplier.version <> (v_payload->>'expected_version')::integer THEN
        PERFORM bar_local.raise_business('SUPPLIER_VERSION_CONFLICT', 'The supplier changed since it was loaded. Refresh and try again.');
      END IF;
      IF EXISTS (SELECT 1 FROM bar_local.suppliers s
                  WHERE s.business_id = v_ctx.business_id AND lower(s.name) = lower(v_payload->>'name')
                    AND s.id <> v_supplier.id) THEN
        PERFORM bar_local.raise_business('DUPLICATE_RECORD', 'A supplier with this name already exists.');
      END IF;
      v_before := to_jsonb(v_supplier);
      UPDATE bar_local.suppliers
         SET name = v_payload->>'name',
             contact_name = NULLIF(v_payload->>'contact_name', ''),
             phone = NULLIF(v_payload->>'phone', ''),
             email = NULLIF(v_payload->>'email', ''),
             address = NULLIF(v_payload->>'address', ''),
             notes = NULLIF(v_payload->>'notes', ''),
             active = COALESCE((v_payload->>'active')::boolean, true),
             version = version + 1,
             updated_by = v_ctx.staff_id,
             updated_operation_id = (p_envelope->>'operation_id')::uuid,
             updated_at = now()
       WHERE id = v_supplier.id
       RETURNING id, version INTO v_id, v_version;
    ELSE
      IF EXISTS (SELECT 1 FROM bar_local.suppliers s
                  WHERE s.business_id = v_ctx.business_id AND lower(s.name) = lower(v_payload->>'name')) THEN
        PERFORM bar_local.raise_business('DUPLICATE_RECORD', 'A supplier with this name already exists.');
      END IF;
      INSERT INTO bar_local.suppliers
        (business_id, name, contact_name, phone, email, address, notes, active,
         created_by, updated_by, created_operation_id, updated_operation_id)
      VALUES
        (v_ctx.business_id, v_payload->>'name', NULLIF(v_payload->>'contact_name', ''),
         NULLIF(v_payload->>'phone', ''), NULLIF(v_payload->>'email', ''), NULLIF(v_payload->>'address', ''),
         NULLIF(v_payload->>'notes', ''), COALESCE((v_payload->>'active')::boolean, true),
         v_ctx.staff_id, v_ctx.staff_id, (p_envelope->>'operation_id')::uuid,
         (p_envelope->>'operation_id')::uuid)
      RETURNING id, version INTO v_id, v_version;
      v_before := NULL;
    END IF;
    v_result := jsonb_build_object(
      'supplier_id', v_id,
      'name', v_payload->>'name',
      'active', COALESCE((v_payload->>'active')::boolean, true),
      'version', v_version
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      CASE WHEN v_before IS NULL THEN 'supplier.created' ELSE 'supplier.updated' END,
      (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object(
        'event_type', CASE WHEN v_before IS NULL THEN 'supplier.created' ELSE 'supplier.updated' END,
        'payload', v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'A supplier with this name already exists.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_purchase_order_create(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_supplier bar_local.suppliers%ROWTYPE;
  v_product bar_local.products%ROWTYPE;
  v_line jsonb;
  v_po_id uuid;
  v_po_number text;
  v_quantity numeric(18,6);
  v_unit_cost numeric(14,4);
  v_tax_rate numeric(7,4);
  v_line_subtotal numeric(14,2);
  v_line_tax numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_line_number integer := 0;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF v_payload->'lines' IS NULL OR jsonb_array_length(v_payload->'lines') = 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'At least one purchase-order line is required.');
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(v_payload->'lines'))
       <> (SELECT count(DISTINCT value->>'product_id') FROM jsonb_array_elements(v_payload->'lines')) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A product may appear only once on a purchase order.');
    END IF;
    SELECT * INTO v_supplier FROM bar_local.suppliers
     WHERE id = (v_payload->>'supplier_id')::uuid AND business_id = v_ctx.business_id
     FOR SHARE;
    IF NOT FOUND OR NOT v_supplier.active THEN
      PERFORM bar_local.raise_business('SUPPLIER_NOT_FOUND', 'An active supplier is required for this purchase order.');
    END IF;
    IF NULLIF(v_payload->>'expected_supplier_version', '') IS NOT NULL
       AND v_supplier.version <> (v_payload->>'expected_supplier_version')::integer THEN
      PERFORM bar_local.raise_business('SUPPLIER_VERSION_CONFLICT', 'The supplier changed since it was loaded. Refresh and try again.');
    END IF;
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'inventory.approve',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    v_po_number := 'PO-' || lpad(nextval('bar_local.purchase_order_number_seq')::text, 6, '0');
    INSERT INTO bar_local.purchase_orders
      (business_id, outlet_id, supplier_id, po_number, status, ordered_on, expected_on, notes,
       created_by, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_supplier.id, v_po_number, 'ordered',
       bar_local.current_business_date(), NULLIF(v_payload->>'expected_on', '')::date,
       NULLIF(v_payload->>'notes', ''), v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_po_id;
    FOR v_line IN
      SELECT value FROM jsonb_array_elements(v_payload->'lines') ORDER BY value->>'product_id'
    LOOP
      v_line_number := v_line_number + 1;
      SELECT * INTO v_product FROM bar_local.products
       WHERE id = (v_line->>'product_id')::uuid AND business_id = v_ctx.business_id
       FOR SHARE;
      IF NOT FOUND OR NOT v_product.active OR NOT v_product.track_stock THEN
        PERFORM bar_local.raise_business('PRODUCT_UNAVAILABLE', 'Every purchase-order product must be active and stock-tracked.');
      END IF;
      v_quantity := (v_line->>'quantity')::numeric;
      v_unit_cost := (v_line->>'unit_cost')::numeric;
      v_tax_rate := COALESCE(NULLIF(v_line->>'tax_rate', '')::numeric, v_product.tax_rate);
      IF v_quantity <= 0 OR v_quantity > 1000000 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Purchase-order quantities must be positive and within range.');
      END IF;
      IF v_unit_cost < 0 OR v_tax_rate < 0 OR v_tax_rate > 1 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Purchase-order costs and tax rates are invalid.');
      END IF;
      v_line_subtotal := round(v_quantity * v_unit_cost, 2);
      v_line_tax := round(v_line_subtotal * v_tax_rate, 2);
      v_subtotal := v_subtotal + v_line_subtotal;
      v_tax_total := v_tax_total + v_line_tax;
      INSERT INTO bar_local.purchase_order_lines
        (purchase_order_id, product_id, sku_snapshot, name_snapshot, quantity_ordered,
         unit_cost, tax_rate, line_subtotal, line_tax, line_total, line_number)
      VALUES
        (v_po_id, v_product.id, v_product.sku, v_product.name, v_quantity,
         v_unit_cost, v_tax_rate, v_line_subtotal, v_line_tax, v_line_subtotal + v_line_tax, v_line_number);
    END LOOP;
    UPDATE bar_local.purchase_orders
       SET subtotal = v_subtotal, tax_total = v_tax_total, total = v_subtotal + v_tax_total
     WHERE id = v_po_id;
    v_result := jsonb_build_object(
      'purchase_order_id', v_po_id,
      'po_number', v_po_number,
      'supplier_id', v_supplier.id,
      'status', 'ordered',
      'subtotal', v_subtotal,
      'tax_total', v_tax_total,
      'total', v_subtotal + v_tax_total,
      'version', 1,
      'line_count', v_line_number
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'purchase_order.created', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'purchase_order.created', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'The purchase order identity conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_purchase_order_cancel(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_po bar_local.purchase_orders%ROWTYPE;
  v_before jsonb;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_po FROM bar_local.purchase_orders
     WHERE id = (v_payload->>'purchase_order_id')::uuid AND business_id = v_ctx.business_id
     FOR UPDATE;
    IF NOT FOUND OR v_po.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('PURCHASE_ORDER_NOT_FOUND', 'The purchase order could not be found in this outlet.');
    END IF;
    IF v_po.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('PURCHASE_ORDER_VERSION_CONFLICT', 'The purchase order changed since it was loaded. Refresh and try again.');
    END IF;
    IF v_po.status <> 'ordered' THEN
      PERFORM bar_local.raise_business('PURCHASE_ORDER_STATE_CONFLICT', 'Only an unreceived purchase order can be cancelled.');
    END IF;
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'inventory.approve',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    v_before := to_jsonb(v_po);
    UPDATE bar_local.purchase_orders
       SET status = 'cancelled', cancelled_by = v_ctx.staff_id, cancelled_at = now(),
           cancel_reason = v_payload->>'reason', cancel_operation_id = (p_envelope->>'operation_id')::uuid,
           version = version + 1, updated_at = now()
     WHERE id = v_po.id;
    v_result := jsonb_build_object(
      'purchase_order_id', v_po.id,
      'po_number', v_po.po_number,
      'status', 'cancelled',
      'version', v_po.version + 1,
      'reason', v_payload->>'reason'
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'purchase_order.cancelled', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'purchase_order.cancelled', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_purchase_order_receive(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_po bar_local.purchase_orders%ROWTYPE;
  v_line jsonb;
  v_receipt_line record;
  v_product record;
  v_movement_id uuid;
  v_receipt_id uuid;
  v_quantity numeric(18,6);
  v_unit_cost numeric(14,4);
  v_line_subtotal numeric(14,2);
  v_line_tax numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_business_date date;
  v_status text;
  v_supplier_reference text;
  v_reference text;
  v_received_lines integer := 0;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_business_date := COALESCE(NULLIF(v_payload->>'received_on', '')::date, bar_local.current_business_date());
    IF v_business_date > bar_local.current_business_date() THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A stock receipt cannot be dated in the future.');
    END IF;
    SELECT * INTO v_po FROM bar_local.purchase_orders
     WHERE id = (v_payload->>'purchase_order_id')::uuid AND business_id = v_ctx.business_id
     FOR UPDATE;
    IF NOT FOUND OR v_po.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('PURCHASE_ORDER_NOT_FOUND', 'The purchase order could not be found in this outlet.');
    END IF;
    IF v_po.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('PURCHASE_ORDER_VERSION_CONFLICT', 'The purchase order changed since it was loaded. Refresh and try again.');
    END IF;
    IF v_po.status NOT IN ('ordered', 'partially_received') THEN
      PERFORM bar_local.raise_business('PURCHASE_ORDER_STATE_CONFLICT', 'This purchase order cannot receive more stock.');
    END IF;
    IF v_payload->'lines' IS NULL OR jsonb_array_length(v_payload->'lines') = 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'At least one receipt line is required.');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_payload->'lines') l
                WHERE (l->>'quantity')::numeric <= 0 OR (l->>'quantity')::numeric > 1000000) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Receipt quantities must be positive and within range.');
    END IF;
    IF EXISTS (
      SELECT 1
        FROM (SELECT DISTINCT (l->>'purchase_order_line_id')::uuid AS id
                FROM jsonb_array_elements(v_payload->'lines') l) r
        LEFT JOIN bar_local.purchase_order_lines pol
          ON pol.id = r.id AND pol.purchase_order_id = v_po.id
       WHERE pol.id IS NULL
    ) THEN
      PERFORM bar_local.raise_business('PURCHASE_ORDER_LINE_NOT_FOUND', 'A receipt line does not belong to this purchase order.');
    END IF;
    IF EXISTS (
      SELECT 1
        FROM (SELECT (l->>'purchase_order_line_id')::uuid AS id, sum((l->>'quantity')::numeric) AS quantity
                FROM jsonb_array_elements(v_payload->'lines') l
               GROUP BY 1) r
        JOIN bar_local.purchase_order_lines pol ON pol.id = r.id AND pol.purchase_order_id = v_po.id
       WHERE r.quantity > pol.quantity_ordered - pol.quantity_received
    ) THEN
      PERFORM bar_local.raise_business('PURCHASE_OVER_RECEIPT', 'The receipt exceeds the outstanding quantity on a purchase-order line.');
    END IF;
    UPDATE bar_local.purchase_order_lines pol
       SET quantity_received = pol.quantity_received + r.quantity
      FROM (SELECT (l->>'purchase_order_line_id')::uuid AS id, sum((l->>'quantity')::numeric) AS quantity
              FROM jsonb_array_elements(v_payload->'lines') l
             GROUP BY 1) r
     WHERE pol.id = r.id AND pol.purchase_order_id = v_po.id;
    SELECT CASE WHEN NOT EXISTS (
             SELECT 1 FROM bar_local.purchase_order_lines
              WHERE purchase_order_id = v_po.id AND quantity_received < quantity_ordered
           ) THEN 'received' ELSE 'partially_received' END
      INTO v_status;
    v_supplier_reference := NULLIF(v_payload->>'supplier_reference', '');
    v_reference := COALESCE(v_supplier_reference, v_po.po_number);
    INSERT INTO bar_local.purchase_receipts
      (business_id, outlet_id, purchase_order_id, supplier_reference, notes, received_on, received_by, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_po.id, v_supplier_reference, NULLIF(v_payload->>'notes', ''),
       v_business_date, v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_receipt_id;
    FOR v_product IN
      SELECT pol.product_id, sum((l->>'quantity')::numeric) AS quantity
        FROM jsonb_array_elements(v_payload->'lines') l
        JOIN bar_local.purchase_order_lines pol ON pol.id = (l->>'purchase_order_line_id')::uuid
       WHERE pol.purchase_order_id = v_po.id
       GROUP BY pol.product_id
       ORDER BY pol.product_id
    LOOP
      INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
      VALUES (v_ctx.business_id, v_ctx.outlet_id, v_product.product_id, 0)
      ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
      PERFORM 1 FROM bar_local.stock_balances
       WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
         AND product_id = v_product.product_id
       FOR UPDATE;
      UPDATE bar_local.stock_balances
         SET quantity = quantity + v_product.quantity, version = version + 1, updated_at = now()
       WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
         AND product_id = v_product.product_id;
    END LOOP;
    FOR v_receipt_line IN
      SELECT l.value AS payload, pol.*
        FROM jsonb_array_elements(v_payload->'lines') l(value)
        JOIN bar_local.purchase_order_lines pol ON pol.id = (l.value->>'purchase_order_line_id')::uuid
       WHERE pol.purchase_order_id = v_po.id
       ORDER BY pol.product_id, l.value->>'lot_code'
    LOOP
      v_received_lines := v_received_lines + 1;
      v_quantity := (v_receipt_line.payload->>'quantity')::numeric;
      v_unit_cost := COALESCE(NULLIF(v_receipt_line.payload->>'unit_cost', '')::numeric, v_receipt_line.unit_cost);
      v_line_subtotal := round(v_quantity * v_unit_cost, 2);
      v_line_tax := round(v_line_subtotal * v_receipt_line.tax_rate, 2);
      v_subtotal := v_subtotal + v_line_subtotal;
      v_tax_total := v_tax_total + v_line_tax;
      INSERT INTO bar_local.stock_movements
        (business_id, outlet_id, product_id, delta, reason, operation_id, business_date,
         unit_cost, lot_code, expires_on, reference)
      VALUES
        (v_ctx.business_id, v_ctx.outlet_id, v_receipt_line.product_id, v_quantity, 'purchase.receive',
         (p_envelope->>'operation_id')::uuid, v_business_date, v_unit_cost,
         NULLIF(v_receipt_line.payload->>'lot_code', ''), NULLIF(v_receipt_line.payload->>'expires_on', '')::date, v_reference)
      RETURNING id INTO v_movement_id;
      INSERT INTO bar_local.purchase_receipt_lines
        (purchase_receipt_id, purchase_order_line_id, product_id, stock_movement_id, quantity,
         unit_cost, lot_code, expires_on, line_subtotal, line_tax, line_total)
      VALUES
        (v_receipt_id, v_receipt_line.id, v_receipt_line.product_id, v_movement_id, v_quantity,
         v_unit_cost, NULLIF(v_receipt_line.payload->>'lot_code', ''), NULLIF(v_receipt_line.payload->>'expires_on', '')::date,
         v_line_subtotal, v_line_tax, v_line_subtotal + v_line_tax);
    END LOOP;
    UPDATE bar_local.purchase_receipts
       SET subtotal = v_subtotal, tax_total = v_tax_total, total = v_subtotal + v_tax_total
     WHERE id = v_receipt_id;
    UPDATE bar_local.purchase_orders
       SET status = v_status, version = version + 1, updated_at = now()
     WHERE id = v_po.id;
    v_result := jsonb_build_object(
      'purchase_order_id', v_po.id,
      'po_number', v_po.po_number,
      'receipt_id', v_receipt_id,
      'status', v_status,
      'version', v_po.version + 1,
      'received_on', v_business_date,
      'line_count', v_received_lines,
      'subtotal', v_subtotal,
      'tax_total', v_tax_total,
      'total', v_subtotal + v_tax_total
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'purchase_order.received', (p_envelope->>'operation_id')::uuid,
      jsonb_build_object('status', v_po.status, 'version', v_po.version), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'purchase_order.received', 'payload', v_result)),
      v_business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_core;

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
  IF p_query IS NULL OR p_query NOT IN ('suppliers.list', 'purchase_orders.list', 'purchase_order.get') THEN
    RETURN bar_local.query_dispatch_core(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters);
  END IF;
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  IF p_query = 'suppliers.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.view');
    v_limit := bar_local.query_limit(v_filters);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name_key, x.supplier_id), '[]'::jsonb)
      INTO v_data
      FROM (SELECT s.id AS supplier_id, s.name, lower(s.name) AS name_key, s.contact_name, s.phone,
                   s.email, s.address, s.notes, s.active, s.version, s.updated_at
              FROM bar_local.suppliers s
             WHERE s.business_id = v_ctx.business_id
               AND (COALESCE((v_filters->>'include_inactive')::boolean, false) OR s.active)
               AND (v_filters->>'search' IS NULL OR s.name ILIKE '%' || v_filters->>'search' || '%'
                    OR COALESCE(s.contact_name, '') ILIKE '%' || v_filters->>'search' || '%')
               AND (v_filters->>'cursor' IS NULL OR lower(s.name) > v_filters->>'cursor')
             ORDER BY lower(s.name), s.id
             LIMIT v_limit + 1) x;
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := lower(v_data->-1->>'name');
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'purchase_orders.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.view');
    v_outlet := bar_local.query_outlet(v_ctx, v_filters);
    v_limit := bar_local.query_limit(v_filters);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.po_number), '[]'::jsonb)
      INTO v_data
      FROM (SELECT po.id AS purchase_order_id, po.po_number, po.supplier_id, s.name AS supplier_name,
                   po.outlet_id, po.status, po.ordered_on, po.expected_on, po.subtotal, po.tax_total,
                   po.total, po.version, po.created_at, po.updated_at,
                   (SELECT count(*) FROM bar_local.purchase_order_lines pol
                     WHERE pol.purchase_order_id = po.id) AS line_count
              FROM bar_local.purchase_orders po
              JOIN bar_local.suppliers s ON s.id = po.supplier_id
             WHERE po.business_id = v_ctx.business_id AND po.outlet_id = v_outlet
               AND (v_filters->>'supplier_id' IS NULL OR po.supplier_id = (v_filters->>'supplier_id')::uuid)
               AND (v_filters->>'status' IS NULL OR po.status = v_filters->>'status')
               AND (v_filters->>'from' IS NULL OR po.ordered_on >= (v_filters->>'from')::date)
               AND (v_filters->>'to' IS NULL OR po.ordered_on <= (v_filters->>'to')::date)
               AND (v_filters->>'cursor' IS NULL OR po.po_number > v_filters->>'cursor')
             ORDER BY po.po_number
             LIMIT v_limit + 1) x;
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := v_data->-1->>'po_number';
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'purchase_order.get' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.view');
    IF NULLIF(v_filters->>'purchase_order_id', '') IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'purchase_order_id is required.');
    END IF;
    SELECT jsonb_build_object(
      'purchase_order_id', po.id,
      'po_number', po.po_number,
      'outlet_id', po.outlet_id,
      'supplier', jsonb_build_object('supplier_id', s.id, 'name', s.name, 'contact_name', s.contact_name,
                                      'phone', s.phone, 'email', s.email),
      'status', po.status,
      'ordered_on', po.ordered_on,
      'expected_on', po.expected_on,
      'notes', po.notes,
      'subtotal', po.subtotal,
      'tax_total', po.tax_total,
      'total', po.total,
      'version', po.version,
      'cancel_reason', po.cancel_reason,
      'created_at', po.created_at,
      'updated_at', po.updated_at,
      'lines', COALESCE((
        SELECT jsonb_agg(row_to_json(l)::jsonb ORDER BY l.line_number)
          FROM (SELECT pol.id AS purchase_order_line_id, pol.product_id, pol.sku_snapshot, pol.name_snapshot,
                       pol.quantity_ordered, pol.quantity_received,
                       (pol.quantity_ordered - pol.quantity_received) AS quantity_remaining,
                       pol.unit_cost, pol.tax_rate, pol.line_subtotal, pol.line_tax, pol.line_total,
                       pol.line_number
                  FROM bar_local.purchase_order_lines pol
                 WHERE pol.purchase_order_id = po.id) l), '[]'::jsonb),
      'receipts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'receipt_id', r.id,
          'supplier_reference', r.supplier_reference,
          'notes', r.notes,
          'received_on', r.received_on,
          'received_by', r.received_by,
          'subtotal', r.subtotal,
          'tax_total', r.tax_total,
          'total', r.total,
          'received_at', r.received_at,
          'lines', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'receipt_line_id', rl.id,
              'purchase_order_line_id', rl.purchase_order_line_id,
              'product_id', rl.product_id,
              'stock_movement_id', rl.stock_movement_id,
              'quantity', rl.quantity,
              'unit_cost', rl.unit_cost,
              'lot_code', rl.lot_code,
              'expires_on', rl.expires_on,
              'line_subtotal', rl.line_subtotal,
              'line_tax', rl.line_tax,
              'line_total', rl.line_total) ORDER BY rl.created_at, rl.id)
              FROM bar_local.purchase_receipt_lines rl WHERE rl.purchase_receipt_id = r.id), '[]'::jsonb)
        ) ORDER BY r.received_at, r.id)
        FROM bar_local.purchase_receipts r WHERE r.purchase_order_id = po.id), '[]'::jsonb)
    ) INTO v_data
    FROM bar_local.purchase_orders po
    JOIN bar_local.suppliers s ON s.id = po.supplier_id
    WHERE po.id = (v_filters->>'purchase_order_id')::uuid
      AND po.business_id = v_ctx.business_id
      AND po.outlet_id = v_ctx.outlet_id;
    IF v_data IS NULL THEN
      PERFORM bar_local.raise_business('PURCHASE_ORDER_NOT_FOUND', 'The purchase order could not be found in this outlet.');
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);
  END IF;

  PERFORM bar_local.raise_business('QUERY_NOT_REGISTERED', 'The local query is not registered: ' || COALESCE(p_query, ''));
END;
$$;

REVOKE ALL ON bar_local.suppliers FROM PUBLIC;
REVOKE ALL ON bar_local.suppliers FROM bar_local_runtime;
REVOKE ALL ON bar_local.purchase_orders FROM PUBLIC;
REVOKE ALL ON bar_local.purchase_orders FROM bar_local_runtime;
REVOKE ALL ON bar_local.purchase_order_lines FROM PUBLIC;
REVOKE ALL ON bar_local.purchase_order_lines FROM bar_local_runtime;
REVOKE ALL ON bar_local.purchase_receipts FROM PUBLIC;
REVOKE ALL ON bar_local.purchase_receipts FROM bar_local_runtime;
REVOKE ALL ON bar_local.purchase_receipt_lines FROM PUBLIC;
REVOKE ALL ON bar_local.purchase_receipt_lines FROM bar_local_runtime;
REVOKE ALL ON SEQUENCE bar_local.purchase_order_number_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE bar_local.purchase_order_number_seq FROM bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch_core(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_core(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_core(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_core(text, uuid, uuid, bigint, text, jsonb) FROM bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_supplier_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_supplier_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_supplier_upsert(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_supplier_upsert(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_purchase_order_create(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_purchase_order_create(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_purchase_order_create(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_purchase_order_create(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_purchase_order_cancel(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_purchase_order_cancel(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_purchase_order_cancel(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_purchase_order_cancel(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_purchase_order_receive(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_purchase_order_receive(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_purchase_order_receive(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_purchase_order_receive(text, uuid, jsonb, text, text) TO bar_local_runtime;
