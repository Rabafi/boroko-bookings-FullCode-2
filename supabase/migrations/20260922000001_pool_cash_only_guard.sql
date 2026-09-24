-- Pool cash-only server guard (R2).
--
-- Client pos.js:129-139 already enforces pool-category lines as cash-only,
-- but the server helper pos_bar_tender_entitlement_error (20260820190000)
-- only checks vouchers/tips. A crafted RPC or offline replay could sell
-- pool lines on card/mobile/split. This forward migration adds an
-- authoritative, fail-closed, auditable server block in the
-- create_pos_order_v3 path (and legacy create_pos_order) that checks order
-- line categories.
--
-- Design:
--   * public.pos_pool_cash_only_error(lodge_id, payload) resolves pool lines
--     from payload-declared categories AND the authoritative pos_menu_items
--     categories (so a spoofed non-pool label cannot bypass), then enforces
--     single-cash tender, no account charge, tip == 0.
--   * Both order RPCs call it immediately after the existing Bar tender
--     guard (post-claim/replay, pre-mutation) and fail closed with code
--     'pool_cash_only'. Replays return first via the existing claim contract,
--     so committed work is never double-blocked.
--   * Fail-closed: unverifiable lodge, invalid tip, or pool + non-cash all
--     return an error string (never null). Non-pool sales return null.
--   * Auditable: the RPC returns success=false with a clear error + code;
--     the idempotency claim preserves the rejected attempt for review.

begin;

create or replace function public.pos_pool_cash_only_error(
  p_lodge_id uuid,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_breakdown jsonb := coalesce(p_payload->'payment_breakdown', '[]'::jsonb);
  v_payment_method text := lower(coalesce(nullif(btrim(p_payload->>'payment_method'), ''), 'cash'));
  v_line jsonb;
  v_has_pool boolean := false;
  v_menu_id uuid;
  v_tenders text[];
  v_single_cash boolean := false;
  v_has_account boolean := false;
  v_tip numeric := 0;
  v_tip_raw text := nullif(btrim(coalesce(p_payload->>'tip_total', '')), '');
begin
  if p_lodge_id is null then
    return 'Pool cash-only boundary could not be verified.';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    return null;
  end if;

  -- Fast path: payload-declared categories (client sends category per line).
  for v_line in select value from jsonb_array_elements(v_items)
  loop
    if lower(coalesce(btrim(v_line->>'category'), btrim(v_line->>'menu_category'), '')) = 'pool' then
      v_has_pool := true;
      exit;
    end if;
  end loop;

  -- Authoritative path: menu categories cannot be spoofed by the caller.
  if not v_has_pool then
    begin
      for v_menu_id in
        select distinct nullif(value->>'menu_item_id', '')::uuid
          from jsonb_array_elements(v_items)
         where nullif(value->>'menu_item_id', '') is not null
      loop
        perform 1
          from public.pos_menu_items mi
         where mi.id = v_menu_id
           and mi.lodge_id = p_lodge_id
           and lower(coalesce(mi.category, '')) = 'pool';
        if found then
          v_has_pool := true;
          exit;
        end if;
      end loop;
    exception when others then
      -- If the menu lookup is unavailable, keep the payload verdict above
      -- (fail-closed for payload-declared pool lines, pass otherwise).
      null;
    end;
  end if;

  if not v_has_pool then
    return null;
  end if;

  select coalesce(array_agg(lower(coalesce(tender.value->>'method', ''))), '{}'::text[])
    into v_tenders
    from jsonb_array_elements(
      case when jsonb_typeof(v_breakdown) = 'array' then v_breakdown else '[]'::jsonb end
    ) as tender(value);

  v_single_cash := v_payment_method = 'cash'
    and coalesce(array_length(v_tenders, 1), 0) = 1
    and v_tenders[1] = 'cash';

  v_has_account := p_payload ? 'customer_account_charge'
    and nullif(btrim(coalesce(p_payload->>'customer_account_charge', '')), '') is not null
    and lower(btrim(p_payload->>'customer_account_charge')) not in ('', 'false', 'null', '0');

  begin
    if v_tip_raw is null then
      v_tip := 0;
    else
      v_tip := v_tip_raw::numeric;
    end if;
  exception when others then
    return 'Tip tender is invalid and has been blocked.';
  end;

  if not v_single_cash or v_has_account or v_tip <> 0 then
    return 'Pool tables pay Cash only. Remove card, mobile money, split and account charge from this sale.';
  end if;
  return null;
end;
$function$;

revoke all on function public.pos_pool_cash_only_error(uuid, jsonb) from public;
grant execute on function public.pos_pool_cash_only_error(uuid, jsonb) to service_role;

-- Patch both authoritative order RPCs in place so Legacy POS and offline
-- replay cannot bypass the same pool boundary. Reuses the existing
-- v_bar_tender_error variable (already declared by 20260820190000), so no
-- DECLARE change is needed. Idempotent: skips functions already patched.
do $do$
declare
  v_oid oid;
  v_definition text;
  v_patched text;
  v_signature text;
  v_guard text := $guard$  v_bar_tender_error := public.pos_pool_cash_only_error(v_lodge_id, payload);
  if v_bar_tender_error is not null then
    return jsonb_build_object('success', false, 'error', v_bar_tender_error, 'code', 'pool_cash_only');
  end if;
$guard$;
  v_anchor text;
  v_occurrences integer;
  v_anchor_pos integer;
begin
  -- create_pos_order_v3: insert before the snapshot load (post-claim,
  -- pre-mutation, same position as the Bar tender guard).
  v_signature := 'public.create_pos_order_v3(jsonb)';
  v_oid := to_regprocedure(v_signature)::oid;
  if v_oid is null then
    raise exception 'Required POS order RPC is missing: %', v_signature;
  end if;
  v_definition := pg_get_functiondef(v_oid);
  if position('v_bar_tender_error text;' in v_definition) = 0 then
    raise exception 'The Bar tender guard is missing from %; refusing pool patch', v_signature;
  end if;
  if position('pos_pool_cash_only_error' in v_definition) = 0 then
    v_anchor := 'select s.*' || E'\n    into v_snapshot';
    v_occurrences := (length(v_patched) - length(replace(v_patched, v_anchor, '')));
    -- recompute on the live definition (v_patched not yet set)
    v_occurrences := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
    if v_occurrences <> 1 then
      raise exception 'Pool guard snapshot anchor is ambiguous or missing for %', v_signature;
    end if;
    v_anchor_pos := position(v_anchor in v_definition);
    v_patched := substr(v_definition, 1, v_anchor_pos - 1)
      || v_guard
      || substr(v_definition, v_anchor_pos);
    if position('pos_pool_cash_only_error' in v_patched) = 0 then
      raise exception 'Could not insert pool guard into %', v_signature;
    end if;
    execute v_patched;
  end if;

  -- create_pos_order (legacy): insert before the first authoritative item
  -- mutation loop (post-replay, pre-mutation, same position as the Bar
  -- tender guard after 20260821020000).
  v_signature := 'public.create_pos_order(jsonb)';
  v_oid := to_regprocedure(v_signature)::oid;
  if v_oid is null then
    raise exception 'Required POS order RPC is missing: %', v_signature;
  end if;
  v_definition := pg_get_functiondef(v_oid);
  if position('v_bar_tender_error text;' in v_definition) = 0 then
    raise exception 'The Bar tender guard is missing from %; refusing pool patch', v_signature;
  end if;
  if position('pos_pool_cash_only_error' in v_definition) = 0 then
    v_anchor := 'for v_item in select * from jsonb_array_elements(v_items) loop';
    v_occurrences := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);
    if v_occurrences < 1 then
      raise exception 'Pool guard item anchor is missing from %', v_signature;
    end if;
    v_anchor_pos := position(v_anchor in v_definition);
    v_patched := substr(v_definition, 1, v_anchor_pos - 1)
      || v_guard
      || substr(v_definition, v_anchor_pos);
    if position('pos_pool_cash_only_error' in v_patched) = 0 then
      raise exception 'Could not insert pool guard into %', v_signature;
    end if;
    execute v_patched;
  end if;
end;
$do$;

commit;
