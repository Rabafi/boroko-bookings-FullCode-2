begin;

-- The consolidated invoice balance comes from authoritative booking totals.
-- Keep its receipt count and latest payment timestamp consistent with that
-- active balance when a duplicate receipt has been voided.
do $$
declare
  v_signature text := 'public.get_invoice_summary(uuid,uuid)';
  v_definition text;
  v_before text;
  v_replaced integer;
begin
  if to_regprocedure(v_signature) is null then raise exception 'Missing consolidated invoice summary RPC'; end if;
  select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
  v_before := v_definition;
  if position('public.payments' in v_definition) > 0 then
    v_definition := replace(v_definition, 'public.payments', 'public.payment_reporting_active');
    v_replaced := (length(v_before) - length(v_definition)) / (length('public.payments') - length('public.payment_reporting_active'));
    if v_replaced < 2 then raise exception 'Expected payment count and timestamp sources were not found in invoice summary'; end if;
    execute v_definition;
  elsif position('public.payment_reporting_active' in v_definition) = 0 then
    raise exception 'Invoice summary has no recognized active payment source';
  end if;
end;
$$;

commit;
