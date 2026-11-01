-- Forward-only lot ledger. Existing balances are explicitly imported as
-- unknown-provenance stock; historical receipt rows are not assigned a fake
-- remaining quantity. New receipts and outbound movements maintain this ledger
-- transactionally with the existing stock movement contract.
CREATE TABLE bar_local.stock_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  origin_movement_id uuid REFERENCES bar_local.stock_movements(id),
  parent_lot_id uuid REFERENCES bar_local.stock_lots(id),
  lot_code text,
  expires_on date,
  received_quantity numeric(18,6) NOT NULL CHECK (received_quantity > 0),
  remaining_quantity numeric(18,6) NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= received_quantity),
  source_kind text NOT NULL CHECK (source_kind IN ('legacy_unallocated','stock.receive','purchase.receive','stock.transfer.in','stocktake_surplus','sale.return.restock','sale_return_quarantine','other_positive')),
  sale_eligible boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  provenance text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_lots_fefo_idx
  ON bar_local.stock_lots (business_id, outlet_id, product_id, expires_on ASC NULLS LAST, created_at, id)
  WHERE remaining_quantity > 0;
CREATE INDEX stock_lots_origin_idx ON bar_local.stock_lots (origin_movement_id) WHERE origin_movement_id IS NOT NULL;

CREATE TABLE bar_local.stock_lot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  lot_id uuid NOT NULL REFERENCES bar_local.stock_lots(id),
  stock_movement_id uuid REFERENCES bar_local.stock_movements(id),
  event_kind text NOT NULL CHECK (event_kind IN ('opening_unknown','receipt','allocate','waste','transfer_in','return_restore','return_quarantine','other_positive')),
  delta_quantity numeric(18,6) NOT NULL CHECK (delta_quantity <> 0),
  linked_lot_id uuid REFERENCES bar_local.stock_lots(id),
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_lot_events_movement_lot_kind_uq
  ON bar_local.stock_lot_events (stock_movement_id, lot_id, event_kind)
  WHERE stock_movement_id IS NOT NULL;
CREATE INDEX stock_lot_events_lot_time_idx ON bar_local.stock_lot_events (lot_id, created_at, id);
ALTER TABLE bar_local.stock_lots OWNER TO bar_local_migrator;
ALTER TABLE bar_local.stock_lot_events OWNER TO bar_local_migrator;
REVOKE ALL ON TABLE bar_local.stock_lots,bar_local.stock_lot_events FROM PUBLIC,bar_local_runtime;
ALTER TABLE bar_local.stock_movements ADD COLUMN lot_id uuid REFERENCES bar_local.stock_lots(id);
CREATE INDEX stock_movements_lot_idx ON bar_local.stock_movements (lot_id) WHERE lot_id IS NOT NULL;

-- The pre-ledger on-hand total is known, but its lot/custody breakdown is not.
-- Preserve the exact quantity under an explicit unknown-provenance label.
WITH opening AS (
  INSERT INTO bar_local.stock_lots
    (business_id,outlet_id,product_id,lot_code,received_quantity,remaining_quantity,source_kind,sale_eligible,provenance)
  SELECT business_id,outlet_id,product_id,NULL,quantity,quantity,'legacy_unallocated',true,
         'Opening balance at lot-ledger migration; source lots and expiry are unknown.'
    FROM bar_local.stock_balances
   WHERE quantity > 0
  RETURNING id,business_id,outlet_id,product_id,remaining_quantity
)
INSERT INTO bar_local.stock_lot_events
  (business_id,outlet_id,product_id,lot_id,event_kind,delta_quantity,reference)
SELECT business_id,outlet_id,product_id,id,'opening_unknown',remaining_quantity,
       'Migration 0069; historical lot allocation was not available.'
  FROM opening;

CREATE OR REPLACE FUNCTION bar_local.stock_lot_movement_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,bar_local AS $$
DECLARE
  v_lot record;
  v_source record;
  v_original record;
  v_take numeric(18,6);
  v_transfer_total numeric(18,6) := 0;
  v_remaining numeric(18,6);
  v_expiry date;
  v_sale_eligible boolean;
  v_source_kind text;
  v_event_kind text;
  v_lot_id uuid;
  v_return_remaining numeric(18,6);
  v_business_date date;
BEGIN
  IF NEW.delta > 0 THEN
    IF NEW.reason IN ('stock.receive','purchase.receive') THEN
      v_source_kind := NEW.reason;
      v_sale_eligible := true;
      v_event_kind := 'receipt';
      v_expiry := NEW.expires_on;
      INSERT INTO bar_local.stock_lots
        (business_id,outlet_id,product_id,origin_movement_id,lot_code,expires_on,
         received_quantity,remaining_quantity,source_kind,sale_eligible,provenance)
      VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,NEW.id,NEW.lot_code,NEW.expires_on,
         NEW.delta,NEW.delta,v_source_kind,v_sale_eligible,COALESCE(NEW.reference,'Supplier reference not recorded.'))
      RETURNING id INTO v_lot_id;
      INSERT INTO bar_local.stock_lot_events
        (business_id,outlet_id,product_id,lot_id,stock_movement_id,event_kind,delta_quantity,reference)
      VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,v_lot_id,NEW.id,v_event_kind,NEW.delta,NEW.reference);
      RETURN NEW;
    ELSIF NEW.reason = 'stock.transfer.in' THEN
      FOR v_source IN
        SELECT e.lot_id, -e.delta_quantity AS quantity, l.lot_code, l.expires_on,
               l.sale_eligible, l.provenance
          FROM bar_local.stock_lot_events e
          JOIN bar_local.stock_movements source_movement ON source_movement.id=e.stock_movement_id
          JOIN bar_local.stock_lots l ON l.id=e.lot_id
         WHERE source_movement.business_id=NEW.business_id
           AND source_movement.outlet_id=NULLIF(NEW.reference,'')::uuid
           AND source_movement.product_id=NEW.product_id
           AND source_movement.operation_id=NEW.operation_id
           AND source_movement.reason='stock.transfer'
           AND e.event_kind='allocate'
         ORDER BY l.expires_on ASC NULLS LAST,l.created_at,l.id
      LOOP
        INSERT INTO bar_local.stock_lots
          (business_id,outlet_id,product_id,origin_movement_id,parent_lot_id,lot_code,expires_on,
           received_quantity,remaining_quantity,source_kind,sale_eligible,provenance)
        VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,NEW.id,v_source.lot_id,v_source.lot_code,v_source.expires_on,
           v_source.quantity,v_source.quantity,'stock.transfer.in',v_source.sale_eligible,
           'Transferred from outlet '||NEW.reference||'; '||v_source.provenance)
        RETURNING id INTO v_lot_id;
        INSERT INTO bar_local.stock_lot_events
          (business_id,outlet_id,product_id,lot_id,stock_movement_id,event_kind,delta_quantity,linked_lot_id,reference)
        VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,v_lot_id,NEW.id,'transfer_in',v_source.quantity,v_source.lot_id,NEW.reference);
        v_transfer_total := v_transfer_total+v_source.quantity;
      END LOOP;
      IF v_transfer_total<>NEW.delta THEN
        PERFORM bar_local.raise_business('STOCK_LOT_TRANSFER_MISMATCH',
          'The source lot allocation does not match the stock transfer. No destination stock was recorded.');
      END IF;
      RETURN NEW;
    ELSIF NEW.reason = 'sale.return.restock' THEN
      v_return_remaining := NEW.delta;
      v_business_date := bar_local.current_business_date();
      IF NEW.reference ~* '^[0-9a-f-]{36}:line:[0-9a-f-]{36}$' THEN
        SELECT sl.id,sl.product_id,s.operation_id,
               (SELECT count(*) FROM bar_local.sale_lines same_product
                 WHERE same_product.sale_id=s.id AND same_product.product_id=sl.product_id) AS same_product_lines
          INTO v_original
          FROM bar_local.sales s
          JOIN bar_local.sale_lines sl ON sl.sale_id=s.id
         WHERE s.id=split_part(NEW.reference,':',1)::uuid
           AND sl.id=split_part(NEW.reference,':',3)::uuid
           AND s.business_id=NEW.business_id AND s.outlet_id=NEW.outlet_id;
        IF FOUND AND v_original.same_product_lines=1 THEN
          FOR v_source IN
            SELECT sm.id AS source_movement_id,e.lot_id,l.lot_code,l.expires_on,l.sale_eligible,
                   -e.delta_quantity AS allocated_quantity,
                   COALESCE((SELECT sum(returned.delta_quantity)
                               FROM bar_local.stock_lot_events returned
                              WHERE returned.event_kind IN ('return_restore','return_quarantine')
                                AND returned.reference=sm.id::text AND returned.linked_lot_id=e.lot_id),0) AS restored_quantity,
                   l.provenance
              FROM bar_local.stock_movements sm
              JOIN bar_local.stock_lot_events e ON e.stock_movement_id=sm.id AND e.event_kind='allocate'
              JOIN bar_local.stock_lots l ON l.id=e.lot_id
             WHERE sm.business_id=NEW.business_id AND sm.outlet_id=NEW.outlet_id
               AND sm.operation_id=v_original.operation_id AND sm.product_id=NEW.product_id
               AND ((sm.reason='sale.depletion' AND sm.product_id=v_original.product_id)
                 OR (sm.reason='sale.recipe.depletion' AND sm.reference=v_original.product_id::text))
             ORDER BY l.expires_on ASC NULLS LAST,l.created_at,l.id
          LOOP
            EXIT WHEN v_return_remaining<=0;
            v_take:=LEAST(v_return_remaining,v_source.allocated_quantity-v_source.restored_quantity);
            IF v_take<=0 THEN CONTINUE; END IF;
            v_sale_eligible:=v_source.sale_eligible AND (v_source.expires_on IS NULL OR v_source.expires_on>=v_business_date);
            INSERT INTO bar_local.stock_lots
              (business_id,outlet_id,product_id,origin_movement_id,parent_lot_id,lot_code,expires_on,
               received_quantity,remaining_quantity,source_kind,sale_eligible,provenance)
            VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,NEW.id,v_source.lot_id,v_source.lot_code,v_source.expires_on,
               v_take,v_take,'sale.return.restock',v_sale_eligible,
               'Returned from sale line '||NEW.reference||'; original lot provenance preserved. '||v_source.provenance)
            RETURNING id INTO v_lot_id;
            INSERT INTO bar_local.stock_lot_events
              (business_id,outlet_id,product_id,lot_id,stock_movement_id,event_kind,delta_quantity,linked_lot_id,reference)
            VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,v_lot_id,NEW.id,
               CASE WHEN v_sale_eligible THEN 'return_restore' ELSE 'return_quarantine' END,
               v_take,v_source.lot_id,v_source.source_movement_id::text);
            v_return_remaining:=v_return_remaining-v_take;
          END LOOP;
        END IF;
      END IF;
      IF v_return_remaining>0 THEN
        INSERT INTO bar_local.stock_lots
          (business_id,outlet_id,product_id,origin_movement_id,lot_code,expires_on,
           received_quantity,remaining_quantity,source_kind,sale_eligible,provenance)
        VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,NEW.id,NEW.lot_code,NEW.expires_on,
           v_return_remaining,v_return_remaining,'sale_return_quarantine',false,
           'Returned stock whose original lot could not be identified is held for inspection.')
        RETURNING id INTO v_lot_id;
        INSERT INTO bar_local.stock_lot_events
          (business_id,outlet_id,product_id,lot_id,stock_movement_id,event_kind,delta_quantity,reference)
        VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,v_lot_id,NEW.id,'return_quarantine',v_return_remaining,NEW.reference);
      END IF;
      RETURN NEW;
    ELSE
      v_source_kind := CASE WHEN NEW.reason='stock.stocktake' THEN 'stocktake_surplus' ELSE 'other_positive' END;
      v_event_kind := 'other_positive';
      v_sale_eligible := true;
      INSERT INTO bar_local.stock_lots
        (business_id,outlet_id,product_id,origin_movement_id,lot_code,expires_on,
         received_quantity,remaining_quantity,source_kind,sale_eligible,provenance)
      VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,NEW.id,NEW.lot_code,NEW.expires_on,
         NEW.delta,NEW.delta,v_source_kind,v_sale_eligible,
         'Positive stock movement without receipt lot provenance.')
      RETURNING id INTO v_lot_id;
      INSERT INTO bar_local.stock_lot_events
        (business_id,outlet_id,product_id,lot_id,stock_movement_id,event_kind,delta_quantity,reference)
      VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,v_lot_id,NEW.id,v_event_kind,NEW.delta,NEW.reference);
      RETURN NEW;
    END IF;
  END IF;

  v_remaining := -NEW.delta;
  IF NEW.reason='stock.waste' AND NEW.lot_id IS NOT NULL THEN
    SELECT id,remaining_quantity INTO v_lot
      FROM bar_local.stock_lots
     WHERE id=NEW.lot_id AND business_id=NEW.business_id AND outlet_id=NEW.outlet_id AND product_id=NEW.product_id
     FOR UPDATE;
    IF NOT FOUND OR v_lot.remaining_quantity<v_remaining THEN
      PERFORM bar_local.raise_business('INSUFFICIENT_LOT_STOCK',
        'The selected lot does not have enough remaining stock for this waste. Refresh lot balances and retry with a new operation.');
    END IF;
    UPDATE bar_local.stock_lots SET remaining_quantity=remaining_quantity-v_remaining,version=version+1 WHERE id=v_lot.id;
    INSERT INTO bar_local.stock_lot_events
      (business_id,outlet_id,product_id,lot_id,stock_movement_id,event_kind,delta_quantity,reference)
    VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,v_lot.id,NEW.id,'waste',-v_remaining,NEW.reference);
    RETURN NEW;
  END IF;
  FOR v_lot IN
    SELECT id,remaining_quantity
      FROM bar_local.stock_lots
     WHERE business_id=NEW.business_id AND outlet_id=NEW.outlet_id AND product_id=NEW.product_id
       AND remaining_quantity > 0
       AND (NEW.reason NOT IN ('sale.depletion','sale.recipe.depletion') OR
            (sale_eligible AND (expires_on IS NULL OR expires_on >= NEW.business_date)))
     ORDER BY expires_on ASC NULLS LAST,created_at,id
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining,v_lot.remaining_quantity);
    UPDATE bar_local.stock_lots SET remaining_quantity=remaining_quantity-v_take,version=version+1 WHERE id=v_lot.id;
    INSERT INTO bar_local.stock_lot_events
      (business_id,outlet_id,product_id,lot_id,stock_movement_id,event_kind,delta_quantity,reference)
    VALUES (NEW.business_id,NEW.outlet_id,NEW.product_id,v_lot.id,NEW.id,'allocate',-v_take,NEW.reason);
    v_remaining := v_remaining-v_take;
  END LOOP;
  IF v_remaining > 0 THEN
    PERFORM bar_local.raise_business('INSUFFICIENT_LOT_STOCK',
      'Available in-date stock lots do not cover this movement. Review expiry and unknown-provenance stock before continuing.');
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION bar_local.stock_lot_movement_trigger() OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.stock_lot_movement_trigger() FROM PUBLIC,bar_local_runtime;
CREATE TRIGGER stock_movement_lot_ledger_after_insert
AFTER INSERT ON bar_local.stock_movements
FOR EACH ROW EXECUTE FUNCTION bar_local.stock_lot_movement_trigger();

CREATE OR REPLACE FUNCTION bar_local.stock_lot_balances_report(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_outlet uuid;
  v_data jsonb;
  v_limit integer;
  v_more boolean := false;
  v_next text;
  v_today date;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities,'inventory.view');
  v_outlet := bar_local.query_outlet(v_ctx,COALESCE(p_filters,'{}'::jsonb));
  v_limit := bar_local.query_limit(COALESCE(p_filters,'{}'::jsonb),100,500);
  v_today := bar_local.current_business_date();
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.lot_id),'[]'::jsonb)
    INTO v_data
    FROM (
      SELECT l.id AS lot_id,l.product_id,p.sku,p.name,l.lot_code,l.expires_on,
             l.received_quantity::text AS received_quantity,
             (l.received_quantity-l.remaining_quantity)::text AS allocated_quantity,
             l.remaining_quantity::text AS remaining_quantity,l.source_kind,l.sale_eligible,l.version,
             l.parent_lot_id,l.provenance,
             m.reference AS supplier_reference,l.created_at,
             CASE WHEN NOT l.sale_eligible THEN 'quarantined'
                  WHEN l.expires_on IS NULL THEN 'no_expiry'
                  WHEN l.expires_on<v_today THEN 'expired'
                  WHEN l.expires_on<=v_today+30 THEN 'expiring_soon'
                  ELSE 'in_date' END AS expiry_status
        FROM bar_local.stock_lots l
        JOIN bar_local.products p ON p.id=l.product_id AND p.business_id=l.business_id
        LEFT JOIN bar_local.stock_movements m ON m.id=l.origin_movement_id
       WHERE l.business_id=v_ctx.business_id AND l.outlet_id=v_outlet
           AND (p_filters->>'cursor' IS NULL OR l.id::text>p_filters->>'cursor')
       ORDER BY l.id
       LIMIT v_limit+1
    ) x;
  IF jsonb_array_length(v_data)>v_limit THEN
    v_data:=v_data-v_limit;
    v_more:=true;
    v_next:=v_data->-1->>'lot_id';
  END IF;
  RETURN jsonb_build_object(
    'data',v_data,'pagination',jsonb_build_object('has_more',v_more,'next_cursor',v_next),
    'snapshot_watermark',(SELECT commit_sequence FROM bar_local.authority_counter WHERE singleton),
    'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_outlet,
      'device_id',v_ctx.device_id,'actor_staff_id',v_ctx.staff_id,'role',v_ctx.role),
    'as_of',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'business_date',v_today,'complete',true,'unavailable','[]'::jsonb,
    'quantity_semantics','remaining_quantity is the current lot ledger balance; quarantined returned stock is not sale eligible.'
  );
END;
$$;
ALTER FUNCTION bar_local.stock_lot_balances_report(text,uuid,uuid,bigint,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.stock_lot_balances_report(text,uuid,uuid,bigint,jsonb) FROM PUBLIC,bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) RENAME TO query_dispatch_before_lot_balances;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_lot_balances(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,bar_local AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_query='stock.lot_balances' THEN
    RETURN bar_local.stock_lot_balances_report(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_filters);
  END IF;
  v_result:=bar_local.query_dispatch_before_lot_balances(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  IF p_query='outbox.bundle.get' THEN RETURN v_result; END IF;
  RETURN jsonb_set(v_result,'{data}',bar_local.decimal_json_transport(v_result->'data'));
END;
$$;
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
