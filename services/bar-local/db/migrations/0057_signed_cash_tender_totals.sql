-- Original posted tenders remain in the ledger after voiding; their signed
-- reversal tenders offset them. Excluding the original double-counts the refund.
-- Do not rewrite historical submitted cash-ups or their immutable receipts.
CREATE OR REPLACE FUNCTION bar_local.expected_shift_cash(p_shift_id uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
  SELECT s.opening_float
   + COALESCE((SELECT sum(t.amount) FROM bar_local.sale_tenders t JOIN bar_local.sales sale ON sale.id=t.sale_id
       WHERE sale.shift_id=p_shift_id AND sale.business_id=s.business_id AND sale.outlet_id=s.outlet_id
        AND t.method='cash' AND sale.status IN ('completed','returned','voided')),0)
   + COALESCE((SELECT sum(m.amount) FROM bar_local.cash_movements m WHERE m.shift_id=p_shift_id AND m.type IN ('paid_in','float','handover')),0)
   - COALESCE((SELECT sum(m.amount) FROM bar_local.cash_movements m WHERE m.shift_id=p_shift_id AND m.type IN ('paid_out','tip_payout')),0)
  FROM bar_local.shifts s WHERE s.id=p_shift_id
 ),0)::numeric(14,2);
$$;
REVOKE ALL ON FUNCTION bar_local.expected_shift_cash(uuid) FROM PUBLIC,bar_local_runtime;

-- Preserve the established scoped query envelopes, capabilities and grants.
-- Exact source anchors fail the migration if an incompatible base replaces them.
DO $$
DECLARE v_function record;v_definition text;v_count integer:=0;
BEGIN
 FOR v_function IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='bar_local' AND p.proname LIKE 'query_dispatch%'
   AND strpos(p.prosrc,'sa.status IN (''completed'',''returned'') AND st.method')>0
 LOOP
  v_definition:=pg_get_functiondef(v_function.oid);
  v_definition:=replace(v_definition,'sa.status IN (''completed'',''returned'') AND st.method',
    'sa.status IN (''completed'',''returned'',''voided'') AND st.method');
  EXECUTE v_definition;v_count:=v_count+1;
 END LOOP;
 IF v_count<>1 THEN RAISE EXCEPTION 'Expected one scoped cash-up summary base; found %',v_count;END IF;
 v_definition:=pg_get_functiondef('bar_local.cashup_report(text,uuid,uuid,bigint,jsonb)'::regprocedure);
 IF strpos(v_definition,'s.status IN (''completed'', ''returned'')')=0 THEN
  RAISE EXCEPTION 'Cash-up report signed tender anchor is unavailable';
 END IF;
 EXECUTE replace(v_definition,'s.status IN (''completed'', ''returned'')','s.status IN (''completed'', ''returned'', ''voided'')');
END;
$$;
