-- Bar POS Base tender boundary. This migration is repo-only until applied and
-- live-verified against the linked Supabase project.
begin;

create or replace function public.pos_bar_tender_entitlement_error(
  p_lodge_id uuid,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_settings jsonb := '{}'::jsonb;
  v_entitlement jsonb := '{}'::jsonb;
  v_features jsonb := '{}'::jsonb;
  v_bar_only boolean := false;
  v_has_voucher boolean := false;
  v_tip numeric := 0;
begin
  if p_lodge_id is null then
    return 'Bar POS commercial entitlement could not be verified.';
  end if;

  select to_jsonb(s)
    into v_settings
    from public.settings s
   where s.lodge_id = p_lodge_id
     and coalesce(s.deleted, false) = false
   order by s.updated_at desc nulls last, s.created_at desc nulls last
   limit 1;

  v_entitlement := coalesce(public.get_lodge_entitlement(p_lodge_id), '{}'::jsonb);
  v_features := coalesce(v_entitlement->'effective_features', '{}'::jsonb);
  v_bar_only := lower(coalesce(
    v_settings->>'hospitality_mode',
    v_settings->'operating_profile'->>'hospitality_mode',
    v_settings->>'operating_mode',
    v_settings->>'commercial_package_key',
    v_settings->'operating_profile'->>'commercial_package_key',
    ''
  )) = 'bar_only'
  or (
    v_entitlement->>'product_id' = 'hospitality-pos'
    and v_entitlement->>'commercial_package_key' = 'bar_pos'
  );

  if not v_bar_only then
    return null;
  end if;

  v_has_voucher := lower(coalesce(p_payload->>'payment_method', '')) = 'voucher'
    or exists (
      select 1
        from jsonb_array_elements(case
          when jsonb_typeof(p_payload->'payment_breakdown') = 'array'
            then p_payload->'payment_breakdown'
          else '[]'::jsonb
        end) as tender(value)
       where lower(coalesce(tender.value->>'method', '')) = 'voucher'
    );

  begin
    v_tip := coalesce(nullif(btrim(p_payload->>'tip_total'), '')::numeric, 0);
  exception when others then
    return 'Tip tender is invalid and has been blocked.';
  end;

  if v_has_voucher and coalesce((v_features->>'vouchers')::boolean, false) is not true then
    return 'Voucher tender is not included in the current Bar POS commercial entitlement.';
  end if;
  if v_tip <> 0 and coalesce((v_features->>'tips_payouts')::boolean, false) is not true then
    return 'Tip tender is not included in the current Bar POS commercial entitlement.';
  end if;
  return null;
end;
$function$;

revoke all on function public.pos_bar_tender_entitlement_error(uuid, jsonb) from public;
grant execute on function public.pos_bar_tender_entitlement_error(uuid, jsonb) to service_role;

-- Patch both authoritative order RPCs in place so Legacy POS and offline
-- replay cannot bypass the same commercial boundary. The guarded functions
-- retain their existing idempotency, totals, stock, and audit logic.
do $do$
declare
  v_oid oid;
  v_definition text;
  v_patched text;
  v_signature text;
  v_decl_token text := 'v_payment_breakdown jsonb :=';
  v_decl_pos integer;
  v_decl_length integer;
  v_occurrences integer;
  v_guard_anchor text;
  v_guard_replacement text;
begin
  foreach v_signature in array array['public.create_pos_order(jsonb)', 'public.create_pos_order_v3(jsonb)']
  loop
    v_oid := to_regprocedure(v_signature)::oid;
    if v_oid is null then
      raise exception 'Required POS order RPC is missing: %', v_signature;
    end if;
    v_definition := pg_get_functiondef(v_oid);
    if position('v_bar_tender_error text;' in v_definition) > 0 then
      continue;
    end if;

    -- pg_get_functiondef deparses the same function with harmless whitespace
    -- differences after an earlier dynamic migration. Anchor on the unique
    -- declaration token and its terminating semicolon, rather than copying
    -- the entire declaration expression or relying on line endings.
    v_occurrences := (length(v_definition) - length(replace(v_definition, v_decl_token, ''))) / length(v_decl_token);
    if v_occurrences <> 1 then
      raise exception 'Bar tender declaration anchor is ambiguous or missing for %', v_signature;
    end if;
    v_decl_pos := position(v_decl_token in v_definition);
    v_decl_length := position(';' in substring(v_definition from v_decl_pos));
    if v_decl_pos = 0 or v_decl_length <= 0 then
      raise exception 'Bar tender declaration terminator is missing for %', v_signature;
    end if;
    v_patched := overlay(
      v_definition placing
        substring(v_definition from v_decl_pos for v_decl_length)
        || E'\n  v_bar_tender_error text;'
      from v_decl_pos for v_decl_length
    );

    if v_signature = 'public.create_pos_order(jsonb)' then
      v_guard_anchor := 'perform public.app_require_lodge_role(v_lodge_id,';
      v_guard_replacement := $guard$v_bar_tender_error := public.pos_bar_tender_entitlement_error(v_lodge_id, payload);
  if v_bar_tender_error is not null then
    return jsonb_build_object('success', false, 'error', v_bar_tender_error, 'code', 'commercial_entitlement_blocked');
  end if;
  $guard$ || v_guard_anchor;
    else
      v_guard_anchor := 'if jsonb_typeof(v_items)';
      v_guard_replacement := $guard$v_bar_tender_error := public.pos_bar_tender_entitlement_error(v_lodge_id, payload);
  if v_bar_tender_error is not null then
    return jsonb_build_object('success', false, 'error', v_bar_tender_error, 'code', 'commercial_entitlement_blocked');
  end if;
  $guard$ || v_guard_anchor;
    end if;
    v_occurrences := (length(v_patched) - length(replace(v_patched, v_guard_anchor, ''))) / length(v_guard_anchor);
    if v_occurrences <> 1 then
      raise exception 'Bar tender guard anchor is ambiguous or missing for %', v_signature;
    end if;
    v_patched := replace(v_patched, v_guard_anchor, v_guard_replacement);
    if position('pos_bar_tender_entitlement_error' in v_patched) = 0 then
      raise exception 'Could not insert Bar tender guard into %', v_signature;
    end if;
    execute v_patched;
  end loop;
end;
$do$;

commit;
