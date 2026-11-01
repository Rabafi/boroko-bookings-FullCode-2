-- Return allocation hardening.
--
-- 1. Replaces reverse_sale so every refund cent is allocated to a tender with
--    remaining capacity. The final tender is no longer force-filled with an
--    unclamped residual.
-- 2. Backfills allocation rows for historical returns created before 0026/0027
--    (or otherwise missing allocation proof). The backfill is deliberately
--    conservative:
--      * line allocations are reconstructed only when the return line maps to
--        exactly one original line by product, price, tax rate and proportional
--        amounts, or when every matching original line is financially identical;
--      * tender allocations are reconstructed only when the historical return
--        tender exactly matches the pre-0027 proportional share of an original
--        tender and the original tender still has capacity;
--      * anything that cannot be proved is recorded in
--        bar_local.return_allocation_reconciliation instead of fabricated.
--    reverse_sale fails closed when an original sale has reconciliation
--    blockers, so unresolved history cannot be used to bypass cumulative limits.
--    Inspect blockers with:
--      SELECT * FROM bar_local.return_allocation_reconciliation
--       WHERE original_sale_id = '<sale-id>';
-- 3. Removes direct table access from bar_local_runtime. Runtime may only reach
--    these tables through the SECURITY DEFINER command functions.
-- 4. Adds lineage/scope triggers proving that original and return tender/line
--    identities belong to the sales recorded on each allocation.
--
-- Data assumptions: historical return sales created before 0027 were produced
-- by the 0005 reverse_sale shape (negative return sale lines/tenders linked by
-- sales.original_sale_id) and did not write allocation rows. Rows that do not
-- fit that shape are reported as blockers rather than guessed.

CREATE TABLE IF NOT EXISTS bar_local.return_allocation_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  original_sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  original_sale_line_id uuid REFERENCES bar_local.sale_lines(id),
  return_sale_id uuid REFERENCES bar_local.sales(id),
  return_sale_line_id uuid REFERENCES bar_local.sale_lines(id),
  return_tender_id uuid REFERENCES bar_local.sale_tenders(id),
  issue text NOT NULL CHECK (length(btrim(issue)) > 0),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bar_local.return_allocation_reconciliation OWNER TO bar_local_migrator;
CREATE INDEX IF NOT EXISTS return_allocation_reconciliation_sale_idx
  ON bar_local.return_allocation_reconciliation(original_sale_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS return_allocation_reconciliation_line_key
  ON bar_local.return_allocation_reconciliation(return_sale_line_id)
  WHERE return_sale_line_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS return_allocation_reconciliation_tender_key
  ON bar_local.return_allocation_reconciliation(return_tender_id)
  WHERE return_tender_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sale_return_line_allocations_return_idx
  ON bar_local.sale_return_line_allocations(return_sale_id, created_at, id);
CREATE INDEX IF NOT EXISTS sale_return_tender_allocations_return_idx
  ON bar_local.sale_return_tender_allocations(return_sale_id, created_at, id);
CREATE INDEX IF NOT EXISTS sale_return_tender_allocations_sale_tender_idx
  ON bar_local.sale_return_tender_allocations(original_sale_id, return_sale_id, created_at, id);

-- Runtime must never read or write allocation proof directly.
REVOKE ALL ON TABLE bar_local.sale_return_line_allocations FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.sale_return_line_allocations FROM bar_local_runtime;
REVOKE ALL ON TABLE bar_local.sale_return_tender_allocations FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.sale_return_tender_allocations FROM bar_local_runtime;
REVOKE ALL ON TABLE bar_local.return_allocation_reconciliation FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.return_allocation_reconciliation FROM bar_local_runtime;

-- Proves the original line and return line both belong to the sales named on
-- the allocation, and that both sales share the same business and outlet.
CREATE OR REPLACE FUNCTION bar_local.enforce_return_line_allocation_lineage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_original_sale bar_local.sales%ROWTYPE;
  v_return_sale bar_local.sales%ROWTYPE;
  v_original_line bar_local.sale_lines%ROWTYPE;
  v_return_line bar_local.sale_lines%ROWTYPE;
BEGIN
  SELECT * INTO v_original_sale FROM bar_local.sales WHERE id = NEW.original_sale_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation original sale does not exist.');
  END IF;
  SELECT * INTO v_return_sale FROM bar_local.sales WHERE id = NEW.return_sale_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation return sale does not exist.');
  END IF;
  SELECT * INTO v_original_line FROM bar_local.sale_lines WHERE id = NEW.original_sale_line_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation original line does not exist.');
  END IF;
  SELECT * INTO v_return_line FROM bar_local.sale_lines WHERE id = NEW.return_sale_line_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation return line does not exist.');
  END IF;

  IF v_original_line.sale_id <> NEW.original_sale_id THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The original line does not belong to the original sale.');
  END IF;
  IF v_return_line.sale_id <> NEW.return_sale_id THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The return line does not belong to the return sale.');
  END IF;
  IF v_return_sale.original_sale_id IS DISTINCT FROM NEW.original_sale_id THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The return sale does not point at the original sale.');
  END IF;
  IF v_original_sale.business_id <> NEW.business_id
     OR v_return_sale.business_id <> NEW.business_id
     OR v_original_sale.outlet_id <> v_return_sale.outlet_id THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation crosses a business or outlet boundary.');
  END IF;
  IF v_return_line.quantity <> -NEW.quantity
     OR v_return_line.line_subtotal <> -NEW.gross_amount
     OR v_return_line.line_discount <> -NEW.discount_amount
     OR v_return_line.line_tax <> -NEW.tax_amount THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The line allocation amounts do not match the return line.');
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION bar_local.enforce_return_line_allocation_lineage() OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.enforce_return_line_allocation_lineage() SECURITY DEFINER;
ALTER FUNCTION bar_local.enforce_return_line_allocation_lineage() SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.enforce_return_line_allocation_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.enforce_return_line_allocation_lineage() FROM bar_local_runtime;

DROP TRIGGER IF EXISTS return_line_allocation_lineage_guard ON bar_local.sale_return_line_allocations;
CREATE TRIGGER return_line_allocation_lineage_guard
  BEFORE INSERT OR UPDATE ON bar_local.sale_return_line_allocations
  FOR EACH ROW EXECUTE FUNCTION bar_local.enforce_return_line_allocation_lineage();

-- Proves the original tender belongs to the original sale and the return tender
-- belongs to the return sale, with matching amount and shared scope.
CREATE OR REPLACE FUNCTION bar_local.enforce_return_tender_allocation_lineage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_original_sale bar_local.sales%ROWTYPE;
  v_return_sale bar_local.sales%ROWTYPE;
  v_original_tender bar_local.sale_tenders%ROWTYPE;
  v_return_tender bar_local.sale_tenders%ROWTYPE;
BEGIN
  SELECT * INTO v_original_sale FROM bar_local.sales WHERE id = NEW.original_sale_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation original sale does not exist.');
  END IF;
  SELECT * INTO v_return_sale FROM bar_local.sales WHERE id = NEW.return_sale_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation return sale does not exist.');
  END IF;
  SELECT * INTO v_original_tender FROM bar_local.sale_tenders WHERE id = NEW.original_tender_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation original tender does not exist.');
  END IF;
  SELECT * INTO v_return_tender FROM bar_local.sale_tenders WHERE id = NEW.return_tender_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation return tender does not exist.');
  END IF;

  IF v_original_tender.sale_id <> NEW.original_sale_id THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The original tender does not belong to the original sale.');
  END IF;
  IF v_return_tender.sale_id <> NEW.return_sale_id THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The return tender does not belong to the return sale.');
  END IF;
  IF v_return_sale.original_sale_id IS DISTINCT FROM NEW.original_sale_id THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The return sale does not point at the original sale.');
  END IF;
  IF v_original_sale.business_id <> v_return_sale.business_id
     OR v_original_sale.outlet_id <> v_return_sale.outlet_id THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The allocation crosses a business or outlet boundary.');
  END IF;
  IF v_original_tender.amount <= 0 OR v_return_tender.amount <> -NEW.amount THEN
    PERFORM bar_local.raise_business('RETURN_ALLOCATION_LINEAGE_INVALID', 'The tender allocation amount does not match the return tender.');
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION bar_local.enforce_return_tender_allocation_lineage() OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.enforce_return_tender_allocation_lineage() SECURITY DEFINER;
ALTER FUNCTION bar_local.enforce_return_tender_allocation_lineage() SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.enforce_return_tender_allocation_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.enforce_return_tender_allocation_lineage() FROM bar_local_runtime;

DROP TRIGGER IF EXISTS return_tender_allocation_lineage_guard ON bar_local.sale_return_tender_allocations;
CREATE TRIGGER return_tender_allocation_lineage_guard
  BEFORE INSERT OR UPDATE ON bar_local.sale_return_tender_allocations
  FOR EACH ROW EXECUTE FUNCTION bar_local.enforce_return_tender_allocation_lineage();

-- Deterministic, conservative reconstruction of pre-0027 allocation proof.
CREATE OR REPLACE FUNCTION bar_local.backfill_return_allocations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_return_sale record;
  v_line record;
  v_candidate record;
  v_candidate_count integer;
  v_equivalent boolean;
  v_first_gross numeric(14,2);
  v_first_discount numeric(14,2);
  v_first_tax numeric(14,2);
  v_first_qty numeric(18,6);
  v_chosen_line uuid;
  v_sale_line record;
  v_original_tender record;
  v_matched_tender uuid;
  v_tender_total numeric(14,2);
  v_return_total numeric(14,2);
  v_expected_remaining numeric(14,2);
  v_expected_share numeric(14,2);
  v_prior_amount numeric(14,2);
  v_added integer;
  v_line_inserted integer := 0;
  v_tender_inserted integer := 0;
  v_blockers integer := 0;
BEGIN
  DELETE FROM bar_local.return_allocation_reconciliation
   WHERE issue LIKE 'backfill.%' OR issue LIKE 'validation.%';

  -- Line allocations are rebuilt oldest-return first so cumulative capacities
  -- are consumed deterministically.
  FOR v_return_sale IN
    SELECT r.id, r.business_id, r.outlet_id, r.original_sale_id, r.created_at
      FROM bar_local.sales r
      JOIN bar_local.sales o ON o.id = r.original_sale_id
     WHERE r.status = 'returned'
       AND r.total < 0
       AND o.business_id = r.business_id
       AND o.outlet_id = r.outlet_id
     ORDER BY r.created_at, r.id
  LOOP
    FOR v_line IN
      SELECT rl.id, rl.product_id, rl.unit_price, rl.tax_rate, rl.quantity,
             rl.line_subtotal, rl.line_discount, rl.line_tax, rl.line_number
        FROM bar_local.sale_lines rl
       WHERE rl.sale_id = v_return_sale.id
         AND rl.quantity < 0
         AND NOT EXISTS (
           SELECT 1 FROM bar_local.sale_return_line_allocations a
            WHERE a.return_sale_line_id = rl.id
         )
       ORDER BY rl.line_number, rl.id
    LOOP
      IF -v_line.line_subtotal < 0 OR -v_line.line_discount < 0 OR -v_line.line_tax < 0 THEN
        INSERT INTO bar_local.return_allocation_reconciliation
          (business_id, original_sale_id, return_sale_id, return_sale_line_id, issue, detail)
        VALUES
          (v_return_sale.business_id, v_return_sale.original_sale_id, v_return_sale.id, v_line.id,
           'backfill.line_amount_invalid',
           jsonb_build_object('quantity', v_line.quantity, 'gross', v_line.line_subtotal,
                              'discount', v_line.line_discount, 'tax', v_line.line_tax));
        v_blockers := v_blockers + 1;
        CONTINUE;
      END IF;

      v_candidate_count := 0;
      v_equivalent := true;
      v_chosen_line := NULL;
      FOR v_candidate IN
        SELECT ol.id, ol.line_subtotal, ol.line_discount, ol.line_tax, ol.quantity
          FROM bar_local.sale_lines ol
         WHERE ol.sale_id = v_return_sale.original_sale_id
           AND ol.product_id = v_line.product_id
           AND ol.unit_price = v_line.unit_price
           AND ol.tax_rate = v_line.tax_rate
           AND ol.quantity > 0
           AND (-v_line.quantity) <= ol.quantity
           AND round(ol.line_subtotal * ((-v_line.quantity) / ol.quantity), 2) = -v_line.line_subtotal
           AND round(ol.line_discount * ((-v_line.quantity) / ol.quantity), 2) = -v_line.line_discount
           AND round(ol.line_tax * ((-v_line.quantity) / ol.quantity), 2) = -v_line.line_tax
           AND COALESCE((SELECT sum(a.quantity) FROM bar_local.sale_return_line_allocations a
                          WHERE a.original_sale_line_id = ol.id), 0) + (-v_line.quantity) <= ol.returned_quantity
           AND COALESCE((SELECT sum(a.gross_amount) FROM bar_local.sale_return_line_allocations a
                          WHERE a.original_sale_line_id = ol.id), 0) + (-v_line.line_subtotal) <= ol.line_subtotal
           AND COALESCE((SELECT sum(a.discount_amount) FROM bar_local.sale_return_line_allocations a
                          WHERE a.original_sale_line_id = ol.id), 0) + (-v_line.line_discount) <= ol.line_discount
           AND COALESCE((SELECT sum(a.tax_amount) FROM bar_local.sale_return_line_allocations a
                          WHERE a.original_sale_line_id = ol.id), 0) + (-v_line.line_tax) <= ol.line_tax
         ORDER BY ol.line_number, ol.id
      LOOP
        v_candidate_count := v_candidate_count + 1;
        IF v_candidate_count = 1 THEN
          v_chosen_line := v_candidate.id;
          v_first_gross := v_candidate.line_subtotal;
          v_first_discount := v_candidate.line_discount;
          v_first_tax := v_candidate.line_tax;
          v_first_qty := v_candidate.quantity;
        ELSIF v_candidate.line_subtotal IS DISTINCT FROM v_first_gross
           OR v_candidate.line_discount IS DISTINCT FROM v_first_discount
           OR v_candidate.line_tax IS DISTINCT FROM v_first_tax
           OR v_candidate.quantity IS DISTINCT FROM v_first_qty THEN
          v_equivalent := false;
        END IF;
      END LOOP;

      IF v_candidate_count = 0 THEN
        INSERT INTO bar_local.return_allocation_reconciliation
          (business_id, original_sale_id, return_sale_id, return_sale_line_id, issue, detail)
        VALUES
          (v_return_sale.business_id, v_return_sale.original_sale_id, v_return_sale.id, v_line.id,
           'backfill.line_unreconstructable',
           jsonb_build_object('product_id', v_line.product_id, 'quantity', -v_line.quantity,
                              'unit_price', v_line.unit_price, 'tax_rate', v_line.tax_rate,
                              'gross', -v_line.line_subtotal, 'discount', -v_line.line_discount,
                              'tax', -v_line.line_tax));
        v_blockers := v_blockers + 1;
        CONTINUE;
      END IF;
      IF v_candidate_count > 1 AND NOT v_equivalent THEN
        INSERT INTO bar_local.return_allocation_reconciliation
          (business_id, original_sale_id, return_sale_id, return_sale_line_id, issue, detail)
        VALUES
          (v_return_sale.business_id, v_return_sale.original_sale_id, v_return_sale.id, v_line.id,
           'backfill.line_ambiguous',
           jsonb_build_object('matched_original_lines', v_candidate_count,
                              'quantity', -v_line.quantity, 'gross', -v_line.line_subtotal));
        v_blockers := v_blockers + 1;
        CONTINUE;
      END IF;

      INSERT INTO bar_local.sale_return_line_allocations
        (business_id, original_sale_id, original_sale_line_id, return_sale_id, return_sale_line_id,
         quantity, gross_amount, discount_amount, tax_amount)
      VALUES
        (v_return_sale.business_id, v_return_sale.original_sale_id, v_chosen_line, v_return_sale.id, v_line.id,
         -v_line.quantity, -v_line.line_subtotal, -v_line.line_discount, -v_line.line_tax);
      v_line_inserted := v_line_inserted + 1;
    END LOOP;
  END LOOP;

  -- Any existing returned_quantity that still has no matching allocation proof
  -- is a blocker. This catches rows created before return sales were linked.
  FOR v_sale_line IN
    SELECT ol.id, ol.sale_id, ol.returned_quantity,
           COALESCE((SELECT sum(a.quantity) FROM bar_local.sale_return_line_allocations a
                      WHERE a.original_sale_line_id = ol.id), 0) AS allocated_quantity
      FROM bar_local.sale_lines ol
     WHERE ol.returned_quantity <> 0
  LOOP
    IF v_sale_line.allocated_quantity IS DISTINCT FROM v_sale_line.returned_quantity
       AND NOT EXISTS (
         SELECT 1 FROM bar_local.return_allocation_reconciliation r
          WHERE r.original_sale_line_id = v_sale_line.id
       ) THEN
      INSERT INTO bar_local.return_allocation_reconciliation
        (business_id, original_sale_id, original_sale_line_id, issue, detail)
      SELECT o.business_id, v_sale_line.sale_id, v_sale_line.id,
             'backfill.line_quantity_mismatch',
             jsonb_build_object('returned_quantity', v_sale_line.returned_quantity,
                                'allocated_quantity', v_sale_line.allocated_quantity)
        FROM bar_local.sales o WHERE o.id = v_sale_line.sale_id;
      v_blockers := v_blockers + 1;
    END IF;
  END LOOP;

  -- Tender allocations use the pre-0027 per-return proportional share. A share
  -- is accepted only when an unallocated historical return tender matches it
  -- exactly and the original tender has capacity left.
  FOR v_return_sale IN
    SELECT r.id, r.business_id, r.outlet_id, r.original_sale_id, r.total, r.created_at
      FROM bar_local.sales r
      JOIN bar_local.sales o ON o.id = r.original_sale_id
       AND o.business_id = r.business_id
       AND o.outlet_id = r.outlet_id
     WHERE r.status = 'returned'
       AND r.total < 0
       AND EXISTS (
         SELECT 1 FROM bar_local.sale_tenders rt
          WHERE rt.sale_id = r.id
            AND rt.amount < 0
            AND NOT EXISTS (
              SELECT 1 FROM bar_local.sale_return_tender_allocations a
               WHERE a.return_tender_id = rt.id
            )
       )
     ORDER BY r.created_at, r.id
  LOOP
    SELECT COALESCE(sum(amount), 0) INTO v_tender_total
      FROM bar_local.sale_tenders
     WHERE sale_id = v_return_sale.original_sale_id AND amount > 0;
    v_return_total := -v_return_sale.total;

    IF v_tender_total <= 0 THEN
      INSERT INTO bar_local.return_allocation_reconciliation
        (business_id, original_sale_id, return_sale_id, return_tender_id, issue, detail)
      SELECT v_return_sale.business_id, v_return_sale.original_sale_id, v_return_sale.id, rt.id,
             'backfill.tender_no_original_tender', jsonb_build_object('amount', rt.amount)
        FROM bar_local.sale_tenders rt
       WHERE rt.sale_id = v_return_sale.id
         AND rt.amount < 0
         AND NOT EXISTS (
           SELECT 1 FROM bar_local.sale_return_tender_allocations a
            WHERE a.return_tender_id = rt.id
         );
      GET DIAGNOSTICS v_added = ROW_COUNT;
      v_blockers := v_blockers + v_added;
      CONTINUE;
    END IF;

    v_expected_remaining := v_return_total;
    FOR v_original_tender IN
      SELECT * FROM bar_local.sale_tenders
       WHERE sale_id = v_return_sale.original_sale_id AND amount > 0
       ORDER BY id
    LOOP
      v_expected_share := round(v_return_total * v_original_tender.amount / v_tender_total, 2);
      IF v_expected_remaining - v_expected_share < 0 THEN
        v_expected_share := v_expected_remaining;
      END IF;
      v_expected_remaining := v_expected_remaining - v_expected_share;
      CONTINUE WHEN v_expected_share <= 0;

      SELECT rt.id INTO v_matched_tender
        FROM bar_local.sale_tenders rt
       WHERE rt.sale_id = v_return_sale.id
         AND rt.amount = -v_expected_share
         AND rt.method = v_original_tender.method
         AND rt.voucher_id IS NOT DISTINCT FROM v_original_tender.voucher_id
         AND rt.customer_id IS NOT DISTINCT FROM v_original_tender.customer_id
         AND NOT EXISTS (
           SELECT 1 FROM bar_local.sale_return_tender_allocations a
            WHERE a.return_tender_id = rt.id
         )
       ORDER BY rt.id
       LIMIT 1;

      IF v_matched_tender IS NULL THEN
        INSERT INTO bar_local.return_allocation_reconciliation
          (business_id, original_sale_id, return_sale_id, issue, detail)
        VALUES
          (v_return_sale.business_id, v_return_sale.original_sale_id, v_return_sale.id,
           'backfill.tender_unmatched',
           jsonb_build_object('original_tender_id', v_original_tender.id,
                              'method', v_original_tender.method,
                              'expected_amount', v_expected_share));
        v_blockers := v_blockers + 1;
        CONTINUE;
      END IF;

      SELECT COALESCE(sum(amount), 0) INTO v_prior_amount
        FROM bar_local.sale_return_tender_allocations
       WHERE original_tender_id = v_original_tender.id;
      IF v_prior_amount + v_expected_share > v_original_tender.amount THEN
        INSERT INTO bar_local.return_allocation_reconciliation
          (business_id, original_sale_id, return_sale_id, issue, detail)
        VALUES
          (v_return_sale.business_id, v_return_sale.original_sale_id, v_return_sale.id,
           'backfill.tender_capacity_exceeded',
           jsonb_build_object('original_tender_id', v_original_tender.id,
                              'expected_amount', v_expected_share,
                              'already_allocated', v_prior_amount,
                              'original_amount', v_original_tender.amount));
        v_blockers := v_blockers + 1;
        CONTINUE;
      END IF;

      INSERT INTO bar_local.sale_return_tender_allocations
        (original_sale_id, original_tender_id, return_sale_id, return_tender_id, amount)
      VALUES
        (v_return_sale.original_sale_id, v_original_tender.id, v_return_sale.id, v_matched_tender, v_expected_share);
      v_tender_inserted := v_tender_inserted + 1;
    END LOOP;

    INSERT INTO bar_local.return_allocation_reconciliation
      (business_id, original_sale_id, return_sale_id, return_tender_id, issue, detail)
    SELECT v_return_sale.business_id, v_return_sale.original_sale_id, v_return_sale.id, rt.id,
           'backfill.tender_unresolved',
           jsonb_build_object('amount', rt.amount, 'method', rt.method)
      FROM bar_local.sale_tenders rt
     WHERE rt.sale_id = v_return_sale.id
       AND rt.amount < 0
       AND NOT EXISTS (
         SELECT 1 FROM bar_local.sale_return_tender_allocations a
          WHERE a.return_tender_id = rt.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM bar_local.return_allocation_reconciliation r
          WHERE r.return_tender_id = rt.id
       );
    GET DIAGNOSTICS v_added = ROW_COUNT;
    v_blockers := v_blockers + v_added;
  END LOOP;

  -- Surface any pre-existing over-allocation (for example rows written by the
  -- 0027 last-tender path) so that the affected sale fails closed until it is
  -- reconciled. Historical over-refunds are never silently rewritten.
  FOR v_sale_line IN
    SELECT a.original_sale_line_id, ol.sale_id,
           sum(a.quantity) AS allocated_quantity, ol.quantity AS original_quantity,
           sum(a.gross_amount) AS allocated_gross, ol.line_subtotal AS original_gross,
           sum(a.discount_amount) AS allocated_discount, ol.line_discount AS original_discount,
           sum(a.tax_amount) AS allocated_tax, ol.line_tax AS original_tax
      FROM bar_local.sale_return_line_allocations a
      JOIN bar_local.sale_lines ol ON ol.id = a.original_sale_line_id
     GROUP BY a.original_sale_line_id, ol.sale_id, ol.quantity,
              ol.line_subtotal, ol.line_discount, ol.line_tax
    HAVING sum(a.quantity) > ol.quantity
        OR sum(a.gross_amount) > ol.line_subtotal
        OR sum(a.discount_amount) > ol.line_discount
        OR sum(a.tax_amount) > ol.line_tax
  LOOP
    INSERT INTO bar_local.return_allocation_reconciliation
      (business_id, original_sale_id, original_sale_line_id, issue, detail)
    SELECT o.business_id, v_sale_line.sale_id, v_sale_line.original_sale_line_id,
           'validation.line_overallocated',
           jsonb_build_object('allocated_quantity', v_sale_line.allocated_quantity,
                              'original_quantity', v_sale_line.original_quantity,
                              'allocated_gross', v_sale_line.allocated_gross,
                              'original_gross', v_sale_line.original_gross,
                              'allocated_discount', v_sale_line.allocated_discount,
                              'original_discount', v_sale_line.original_discount,
                              'allocated_tax', v_sale_line.allocated_tax,
                              'original_tax', v_sale_line.original_tax)
      FROM bar_local.sales o WHERE o.id = v_sale_line.sale_id;
    v_blockers := v_blockers + 1;
  END LOOP;

  FOR v_original_tender IN
    SELECT a.original_tender_id, ot.sale_id, ot.amount AS original_amount,
           sum(a.amount) AS allocated_amount
      FROM bar_local.sale_return_tender_allocations a
      JOIN bar_local.sale_tenders ot ON ot.id = a.original_tender_id
     GROUP BY a.original_tender_id, ot.sale_id, ot.amount
    HAVING sum(a.amount) > ot.amount
  LOOP
    INSERT INTO bar_local.return_allocation_reconciliation
      (business_id, original_sale_id, issue, detail)
    SELECT o.business_id, v_original_tender.sale_id,
           'validation.tender_overallocated',
           jsonb_build_object('original_tender_id', v_original_tender.original_tender_id,
                              'allocated_amount', v_original_tender.allocated_amount,
                              'original_amount', v_original_tender.original_amount)
      FROM bar_local.sales o WHERE o.id = v_original_tender.sale_id;
    v_blockers := v_blockers + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'line_allocations_inserted', v_line_inserted,
    'tender_allocations_inserted', v_tender_inserted,
    'blockers', v_blockers
  );
END;
$$;
ALTER FUNCTION bar_local.backfill_return_allocations() OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.backfill_return_allocations() SECURITY DEFINER;
ALTER FUNCTION bar_local.backfill_return_allocations() SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.backfill_return_allocations() FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.backfill_return_allocations() FROM bar_local_runtime;

SELECT bar_local.backfill_return_allocations();

-- Exact tender allocation. Pass 1 applies each tender's cumulative proportional
-- target clamped to its remaining capacity. Pass 2 distributes any residual
-- cent(s) only to tenders that still have capacity. If residual remains, the
-- return fails instead of over-refunding any tender.
CREATE OR REPLACE FUNCTION bar_local.reverse_sale(
  p_ctx bar_local.session_context,
  p_operation_id uuid,
  p_receipt_sequence bigint,
  p_original_sale_id uuid,
  p_lines jsonb,
  p_reason text,
  p_disposition text,
  p_mark_void boolean
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_original bar_local.sales%ROWTYPE;
  v_original_line bar_local.sale_lines%ROWTYPE;
  v_return_line_id uuid;
  v_return_tender_id uuid;
  v_line jsonb;
  v_stored_line jsonb;
  v_recipe_line jsonb;
  v_tender bar_local.sale_tenders%ROWTYPE;
  v_qty numeric(18,6);
  v_cumulative_qty numeric(18,6);
  v_ratio numeric;
  v_gross_target numeric(14,2);
  v_discount_target numeric(14,2);
  v_tax_target numeric(14,2);
  v_prior_gross numeric(14,2);
  v_prior_discount numeric(14,2);
  v_prior_tax numeric(14,2);
  v_gross numeric(14,2);
  v_discount numeric(14,2);
  v_tax numeric(14,2);
  v_net numeric(14,2);
  v_return_lines jsonb := '[]'::jsonb;
  v_return_subtotal numeric(14,2) := 0;
  v_return_tax numeric(14,2) := 0;
  v_return_total numeric(14,2) := 0;
  v_sale_id uuid;
  v_stock_product_id uuid;
  v_stock_qty numeric(18,6);
  v_tender_total numeric(14,2) := 0;
  v_prior_refund_total numeric(14,2) := 0;
  v_cumulative_refund numeric(14,2);
  v_prior_tender_refund numeric(14,2);
  v_tender_capacity numeric(14,2);
  v_tender_target numeric(14,2);
  v_share numeric(14,2);
  v_remaining numeric(14,2);
  v_pass integer;
  v_line_no integer := 0;
  v_series text;
  v_voucher bar_local.vouchers%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'At least one sale line is required for a return.');
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_lines)) <>
     (SELECT count(DISTINCT value->>'sale_line_id') FROM jsonb_array_elements(p_lines)) THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A sale line may appear only once in a return request.');
  END IF;

  SELECT * INTO v_original FROM bar_local.sales WHERE id = p_original_sale_id FOR UPDATE;
  IF NOT FOUND OR v_original.business_id <> p_ctx.business_id OR v_original.outlet_id <> p_ctx.outlet_id THEN
    PERFORM bar_local.raise_business('SALE_NOT_FOUND', 'The original sale could not be found in this outlet.');
  END IF;
  IF v_original.status = 'voided' THEN
    PERFORM bar_local.raise_business('SALE_ALREADY_VOIDED', 'This sale has already been voided.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM bar_local.return_allocation_reconciliation
     WHERE original_sale_id = v_original.id
  ) THEN
    PERFORM bar_local.raise_business('RETURN_RECONCILIATION_REQUIRED',
      'Historical return allocations for this sale must be reconciled before another return can be processed.');
  END IF;
  PERFORM 1 FROM bar_local.sale_tenders WHERE sale_id = v_original.id AND amount > 0 FOR UPDATE;
  SELECT COALESCE(sum(amount), 0) INTO v_tender_total FROM bar_local.sale_tenders WHERE sale_id = v_original.id AND amount > 0;
  SELECT COALESCE(sum(amount), 0) INTO v_prior_refund_total
    FROM bar_local.sale_return_tender_allocations WHERE original_sale_id = v_original.id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_original_line FROM bar_local.sale_lines
     WHERE id = (v_line->>'sale_line_id')::uuid AND sale_id = v_original.id FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A return line does not belong to the original sale.');
    END IF;
    v_qty := (v_line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > (v_original_line.quantity - v_original_line.returned_quantity) THEN
      PERFORM bar_local.raise_business('RETURN_EXCEEDS_ORIGINAL', 'Return quantity exceeds the original quantity remaining.');
    END IF;
    v_cumulative_qty := v_original_line.returned_quantity + v_qty;
    v_ratio := v_cumulative_qty / v_original_line.quantity;
    v_gross_target := CASE WHEN v_cumulative_qty = v_original_line.quantity THEN v_original_line.line_subtotal ELSE round(v_original_line.line_subtotal * v_ratio, 2) END;
    v_discount_target := CASE WHEN v_cumulative_qty = v_original_line.quantity THEN v_original_line.line_discount ELSE round(v_original_line.line_discount * v_ratio, 2) END;
    v_tax_target := CASE WHEN v_cumulative_qty = v_original_line.quantity THEN v_original_line.line_tax ELSE round(v_original_line.line_tax * v_ratio, 2) END;
    SELECT COALESCE(sum(gross_amount), 0), COALESCE(sum(discount_amount), 0), COALESCE(sum(tax_amount), 0)
      INTO v_prior_gross, v_prior_discount, v_prior_tax
      FROM bar_local.sale_return_line_allocations WHERE original_sale_line_id = v_original_line.id;
    v_gross := v_gross_target - v_prior_gross;
    v_discount := v_discount_target - v_prior_discount;
    v_tax := v_tax_target - v_prior_tax;
    v_net := v_gross - v_discount;
    IF v_gross < 0 OR v_discount < 0 OR v_tax < 0 OR v_net < 0 THEN
      PERFORM bar_local.raise_business('RETURN_ALLOCATION_INVALID', 'The remaining original line value cannot be allocated safely.');
    END IF;
    v_return_subtotal := v_return_subtotal + v_net;
    v_return_tax := v_return_tax + v_tax;
    v_return_lines := v_return_lines || jsonb_build_array(jsonb_build_object(
      'sale_line_id', v_original_line.id, 'quantity', v_qty, 'gross', v_gross,
      'discount', v_discount, 'tax', v_tax, 'net', v_net));

    IF p_disposition = 'restock' THEN
      IF jsonb_typeof(v_original_line.recipe_snapshot) = 'array' AND jsonb_array_length(v_original_line.recipe_snapshot) > 0 THEN
        FOR v_recipe_line IN SELECT value FROM jsonb_array_elements(v_original_line.recipe_snapshot)
        LOOP
          v_stock_product_id := (v_recipe_line->>'ingredient_product_id')::uuid;
          -- Existence of the immutable original movement proves this ingredient was stock-tracked when sold.
          IF EXISTS (SELECT 1 FROM bar_local.stock_movements
                      WHERE operation_id = v_original_line.operation_id AND product_id = v_stock_product_id
                        AND reason = 'sale.recipe.depletion') THEN
            v_stock_qty := round((v_recipe_line->>'quantity_per_unit')::numeric * v_qty, 6);
            INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
            VALUES (p_ctx.business_id, p_ctx.outlet_id, v_stock_product_id, 0)
            ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
            UPDATE bar_local.stock_balances SET quantity = quantity + v_stock_qty, version = version + 1, updated_at = now()
             WHERE business_id = p_ctx.business_id AND outlet_id = p_ctx.outlet_id AND product_id = v_stock_product_id;
            INSERT INTO bar_local.stock_movements (business_id, outlet_id, product_id, delta, reason, operation_id, business_date, reference)
            VALUES (p_ctx.business_id, p_ctx.outlet_id, v_stock_product_id, v_stock_qty, 'sale.return.restock', p_operation_id,
              v_original.business_date, p_original_sale_id::text || ':line:' || v_original_line.id::text);
          END IF;
        END LOOP;
      ELSIF EXISTS (SELECT 1 FROM bar_local.stock_movements
                     WHERE operation_id = v_original_line.operation_id AND product_id = v_original_line.product_id
                       AND reason = 'sale.depletion') THEN
        INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
        VALUES (p_ctx.business_id, p_ctx.outlet_id, v_original_line.product_id, 0)
        ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
        UPDATE bar_local.stock_balances SET quantity = quantity + v_qty, version = version + 1, updated_at = now()
         WHERE business_id = p_ctx.business_id AND outlet_id = p_ctx.outlet_id AND product_id = v_original_line.product_id;
        INSERT INTO bar_local.stock_movements (business_id, outlet_id, product_id, delta, reason, operation_id, business_date, reference)
        VALUES (p_ctx.business_id, p_ctx.outlet_id, v_original_line.product_id, v_qty, 'sale.return.restock', p_operation_id,
          v_original.business_date, p_original_sale_id::text || ':line:' || v_original_line.id::text);
      END IF;
    END IF;
    UPDATE bar_local.sale_lines SET returned_quantity = returned_quantity + v_qty WHERE id = v_original_line.id;
  END LOOP;

  v_return_total := v_return_subtotal + v_return_tax;
  IF v_prior_refund_total + v_return_total > v_tender_total THEN
    PERFORM bar_local.raise_business('RETURN_EXCEEDS_ORIGINAL', 'The return exceeds the remaining original tender value.');
  END IF;
  IF v_return_total > 0 AND v_tender_total <= 0 THEN
    PERFORM bar_local.raise_business('RETURN_TENDER_UNALLOCATABLE', 'The original sale has no refundable tender balance.');
  END IF;

  SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
  INSERT INTO bar_local.sales
    (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number, receipt_series,
     business_date, status, subtotal, discount, tax, tip, total, customer_id, note, original_sale_id, operation_id)
  VALUES (p_ctx.business_id, p_ctx.outlet_id, v_original.shift_id, p_ctx.device_id, p_ctx.staff_id, v_original.tab_id,
     p_receipt_sequence, COALESCE(v_series, 'BAR'), v_original.business_date, 'returned',
     -v_return_subtotal, 0, -v_return_tax, 0, -v_return_total, v_original.customer_id, p_reason,
     v_original.id, p_operation_id)
  RETURNING id INTO v_sale_id;

  v_line_no := 0;
  FOR v_stored_line IN SELECT value FROM jsonb_array_elements(v_return_lines)
  LOOP
    v_line_no := v_line_no + 1;
    SELECT * INTO v_original_line FROM bar_local.sale_lines WHERE id = (v_stored_line->>'sale_line_id')::uuid;
    INSERT INTO bar_local.sale_lines
      (sale_id,line_number,product_id,name_snapshot,sku_snapshot,quantity,unit_price,tax_rate,
       line_subtotal,line_discount,line_tax,line_total,notes,modifier_snapshot,recipe_cost,recipe_snapshot,
       promotion_code,promotion_discount,promotion_snapshot,operation_id)
    VALUES (v_sale_id,v_line_no,v_original_line.product_id,v_original_line.name_snapshot,v_original_line.sku_snapshot,
      -(v_stored_line->>'quantity')::numeric,v_original_line.unit_price,v_original_line.tax_rate,
      -(v_stored_line->>'gross')::numeric,-(v_stored_line->>'discount')::numeric,-(v_stored_line->>'tax')::numeric,
      -((v_stored_line->>'net')::numeric + (v_stored_line->>'tax')::numeric),p_reason,
      v_original_line.modifier_snapshot,v_original_line.recipe_cost,v_original_line.recipe_snapshot,NULL,0,NULL,p_operation_id)
    RETURNING id INTO v_return_line_id;
    INSERT INTO bar_local.sale_return_line_allocations
      (business_id,original_sale_id,original_sale_line_id,return_sale_id,return_sale_line_id,quantity,gross_amount,discount_amount,tax_amount)
    VALUES (p_ctx.business_id,v_original.id,v_original_line.id,v_sale_id,v_return_line_id,
      (v_stored_line->>'quantity')::numeric,(v_stored_line->>'gross')::numeric,
      (v_stored_line->>'discount')::numeric,(v_stored_line->>'tax')::numeric);
  END LOOP;

  v_cumulative_refund := v_prior_refund_total + v_return_total;
  v_remaining := v_return_total;

  -- Pass 1: proportional cumulative target, clamped to each tender's capacity.
  -- Pass 2: residual cents only into tenders that still have capacity.
  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_remaining <= 0;
    FOR v_tender IN SELECT * FROM bar_local.sale_tenders WHERE sale_id = v_original.id AND amount > 0 ORDER BY id FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      SELECT COALESCE(sum(amount),0) INTO v_prior_tender_refund
        FROM bar_local.sale_return_tender_allocations WHERE original_tender_id = v_tender.id;
      v_tender_capacity := v_tender.amount - v_prior_tender_refund;
      IF v_pass = 1 THEN
        v_tender_target := round(v_cumulative_refund * v_tender.amount / v_tender_total, 2);
        v_share := greatest(0, least(v_tender_capacity, v_tender_target - v_prior_tender_refund, v_remaining));
      ELSE
        v_share := greatest(0, least(v_tender_capacity, v_remaining));
      END IF;
      IF v_share > 0 THEN
        INSERT INTO bar_local.sale_tenders
          (sale_id,method,amount,tendered,change_amount,reference,provider_status,voucher_id,customer_id,operation_id)
        VALUES (v_sale_id,v_tender.method,-v_share,NULL,0,'return:' || v_original.id::text,
          CASE WHEN v_tender.method IN ('card','mobile_money','bank_transfer','external') THEN 'locally_asserted' ELSE 'not_applicable' END,
          v_tender.voucher_id,v_tender.customer_id,p_operation_id)
        RETURNING id INTO v_return_tender_id;
        INSERT INTO bar_local.sale_return_tender_allocations(original_sale_id,original_tender_id,return_sale_id,return_tender_id,amount)
        VALUES (v_original.id,v_tender.id,v_sale_id,v_return_tender_id,v_share);
        v_remaining := v_remaining - v_share;
        IF v_tender.method = 'customer_credit' AND v_tender.customer_id IS NOT NULL THEN
          INSERT INTO bar_local.credit_ledger (business_id,customer_id,delta,type,sale_id,operation_id,reference)
          VALUES (p_ctx.business_id,v_tender.customer_id,-v_share,'sale.return.credit',v_sale_id,p_operation_id,p_original_sale_id::text);
        ELSIF v_tender.method = 'voucher' AND v_tender.voucher_id IS NOT NULL THEN
          SELECT * INTO v_voucher FROM bar_local.vouchers WHERE id = v_tender.voucher_id FOR UPDATE;
          UPDATE bar_local.vouchers SET balance = balance + v_share,
            status = CASE WHEN status = 'redeemed' THEN 'active' ELSE status END, version = version + 1 WHERE id = v_tender.voucher_id;
          INSERT INTO bar_local.voucher_ledger (voucher_id,delta,type,sale_id,operation_id)
          VALUES (v_tender.voucher_id,v_share,'sale.return',v_sale_id,p_operation_id);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF v_remaining <> 0 THEN
    PERFORM bar_local.raise_business('RETURN_TENDER_UNALLOCATABLE', 'The return cannot be allocated within the original tender balances.');
  END IF;
  IF p_mark_void THEN
    UPDATE bar_local.sales SET status='voided',version=version+1 WHERE id=v_original.id;
  ELSE
    UPDATE bar_local.sales SET status='returned',version=version+1 WHERE id=v_original.id;
  END IF;
  RETURN bar_local.build_receipt(v_sale_id);
END;
$$;

-- Preserve the established owner / SECURITY DEFINER / execute-only conventions.
ALTER FUNCTION bar_local.cmd_sale_return(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_sale_return(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_sale_return(text,uuid,jsonb,text,text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_sale_return(text,uuid,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_sale_return(text,uuid,jsonb,text,text) FROM bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_sale_return(text,uuid,jsonb,text,text) TO bar_local_runtime;

ALTER FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) SECURITY DEFINER;
ALTER FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) FROM bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) TO bar_local_runtime;
