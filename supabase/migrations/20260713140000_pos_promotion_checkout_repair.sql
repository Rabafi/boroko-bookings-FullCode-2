-- Forward repair for the deployed snapshot-based POS v3 pricing contract.
do $$
declare
  v_definition text;
  v_start integer;
  v_finish integer;
  v_block text := $body$if v_promotion_id is not null then
    select value into v_promotion
      from jsonb_array_elements(coalesce(v_snapshot.payload->'promotions', '[]'::jsonb))
     where nullif(value->>'id', '')::uuid = v_promotion_id
       and coalesce((value->>'active')::boolean, false)
     limit 1;
    if v_promotion is null then
      return jsonb_build_object('success', false, 'error', 'Promotion is not valid in this catalog snapshot');
    end if;
    if nullif(v_promotion->>'starts_at', '') is not null and (v_promotion->>'starts_at')::timestamptz > now()
       or nullif(v_promotion->>'ends_at', '') is not null and (v_promotion->>'ends_at')::timestamptz < now() then
      return jsonb_build_object('success', false, 'error', 'Promotion is outside its scheduled period');
    end if;
    if v_gross_total < coalesce(nullif(v_promotion->>'minimum_spend', '')::numeric, 0) then
      return jsonb_build_object('success', false, 'error', 'Promotion minimum spend is not met');
    end if;
    if nullif(v_promotion->>'customer_segment', '') is not null
       and lower(v_promotion->>'customer_segment') <> lower(coalesce(payload->>'customer_segment', '')) then
      return jsonb_build_object('success', false, 'error', 'Promotion is not available for this customer');
    end if;
    if lower(coalesce(v_promotion->>'applies_to_category', 'all')) = 'all' then
      v_promotion_base := v_gross_total;
    else
      select coalesce(sum((value->>'gross_subtotal')::numeric), 0) into v_promotion_base
        from jsonb_array_elements(v_priced_items)
       where lower(value->>'category') = lower(v_promotion->>'applies_to_category');
    end if;
    v_promotion_discount := case lower(coalesce(v_promotion->>'discount_type', 'amount'))
      when 'percent' then round(v_promotion_base * least(100, greatest(0, (v_promotion->>'discount_value')::numeric)) / 100, 2)
      else round(least(v_promotion_base, greatest(0, (v_promotion->>'discount_value')::numeric)), 2)
    end;
  end if;

  $body$;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure) into v_definition;
  v_start := position('if v_promotion_id is not null then' in v_definition);
  v_finish := position('if jsonb_typeof(v_manual_discount)' in v_definition);
  if v_start = 0 or v_finish <= v_start then raise exception 'Could not locate deployed promotion pricing block'; end if;
  execute substring(v_definition from 1 for v_start - 1) || v_block || substring(v_definition from v_finish);

  select pg_get_functiondef('public.publish_pos_catalog_snapshot(uuid,uuid)'::regprocedure) into v_definition;
  if position('''name'', p.name,' in v_definition) = 0 then raise exception 'Could not locate promotion snapshot payload'; end if;
  v_definition := replace(v_definition, '''name'', p.name,', '''name'', p.name,
      ''discount_type'', p.discount_type,
      ''discount_value'', p.discount_value,
      ''applies_to_category'', p.applies_to_category,
      ''active'', p.active,
      ''starts_at'', p.starts_at,
      ''ends_at'', p.ends_at,
      ''minimum_spend'', p.minimum_spend,
      ''customer_segment'', p.customer_segment,');
  v_definition := replace(v_definition, 'and p.is_active = true;', 'and p.active = true;');
  execute v_definition;
end $$;
