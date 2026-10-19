-- Keep the completed packet's transaction read model in original statement order.
-- Existing packet content and hashes remain immutable; old rows without the new
-- ordinal column may use the order already recorded in that packet's manifest.
create or replace function public.get_restaurant_bank_reconciliation_packet_v2(
  p_lodge_id uuid,
  p_reconciliation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_packet jsonb;
  v_tx jsonb;
  v_adj jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');

  select to_jsonb(p)
    into v_packet
    from public.restaurant_bank_reconciliation_packets p
   where p.lodge_id = p_lodge_id
     and p.control_totals->>'reconciliation_id' = p_reconciliation_id::text;

  if v_packet is null then
    select to_jsonb(p)
      into v_packet
      from public.restaurant_bank_reconciliation_packets p
      join public.restaurant_bank_reconciliations r
        on r.statement_import_id = p.statement_import_id
       and r.id = p_reconciliation_id
     where p.lodge_id = p_lodge_id;
  end if;

  if v_packet is null then
    raise exception 'Reconciliation packet not found' using errcode = 'P0002';
  end if;

  -- Fail closed if a legacy row has no stable source ordinal and is absent from
  -- the immutable packet manifest. Never substitute a timestamp or random UUID.
  if exists (
    select 1
      from public.restaurant_bank_transactions t
      left join lateral (
        select m.ordinality::integer as manifest_ordinal
          from jsonb_array_elements(
                 coalesce(v_packet->'source_manifest'->'transactions', '[]'::jsonb)
               ) with ordinality as m(value, ordinality)
         where m.value->>'id' = t.id::text
         limit 1
      ) manifest on true
     where t.reconciliation_id = p_reconciliation_id
       and t.lodge_id = p_lodge_id
       and coalesce(t.source_row_ordinal, manifest.manifest_ordinal) is null
  ) then
    raise exception 'Statement row order is unverified; source ordinal or immutable packet manifest order is required'
      using errcode = '23514';
  end if;

  -- The effective ordinal must be unique within the packet, otherwise there is
  -- no safe deterministic source-row sequence to return.
  if exists (
    select 1
      from (
        select coalesce(t.source_row_ordinal, manifest.manifest_ordinal) as row_ordinal
          from public.restaurant_bank_transactions t
          left join lateral (
            select m.ordinality::integer as manifest_ordinal
              from jsonb_array_elements(
                     coalesce(v_packet->'source_manifest'->'transactions', '[]'::jsonb)
                   ) with ordinality as m(value, ordinality)
             where m.value->>'id' = t.id::text
             limit 1
          ) manifest on true
         where t.reconciliation_id = p_reconciliation_id
           and t.lodge_id = p_lodge_id
      ) ordered_rows
     group by row_ordinal
    having count(*) > 1
  ) then
    raise exception 'Statement row order is unverified; packet row ordinals are not unique'
      using errcode = '23514';
  end if;

  select coalesce(
           jsonb_agg(ordered_rows.row_json order by ordered_rows.row_ordinal),
           '[]'::jsonb
         )
    into v_tx
    from (
      select to_jsonb(t) as row_json,
             coalesce(t.source_row_ordinal, manifest.manifest_ordinal) as row_ordinal
        from public.restaurant_bank_transactions t
        left join lateral (
          select m.ordinality::integer as manifest_ordinal
            from jsonb_array_elements(
                   coalesce(v_packet->'source_manifest'->'transactions', '[]'::jsonb)
                 ) with ordinality as m(value, ordinality)
           where m.value->>'id' = t.id::text
           limit 1
        ) manifest on true
       where t.reconciliation_id = p_reconciliation_id
         and t.lodge_id = p_lodge_id
    ) ordered_rows;

  select coalesce(
           jsonb_agg(to_jsonb(a) order by a.statement_transaction_id),
           '[]'::jsonb
         )
    into v_adj
    from public.restaurant_reconciliation_adjustments a
   where a.reconciliation_id = p_reconciliation_id
     and a.lodge_id = p_lodge_id;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'packet', v_packet,
      'transactions', v_tx,
      'adjustments', v_adj,
      'complete', true,
      'packet_hash', v_packet->>'packet_hash'
    )
  );
end
$function$;