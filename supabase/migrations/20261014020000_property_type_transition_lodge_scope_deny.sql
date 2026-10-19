-- LodgingOS property-type transitions: explicit wrong-lodge denial (follow-up).
--
-- Defect repaired (forward fix; 20261014010000 is never modified):
-- _property_transition_resolve_caller() returns the SESSION lodge when the
-- requested p_lodge_id differs, with a comment claiming "the caller
-- comparison rejects" — but no such comparison existed in any of the three
-- RPCs. A valid session asking about another lodge was therefore silently
-- re-scoped onto its own lodge (preview/commit/status all operated on the
-- session lodge and returned success) instead of failing closed with
-- LODGE_SCOPE_DENIED. Cross-lodge writes were never possible (every effect
-- always landed on the session lodge), but a stale/mismatched lodge id
-- could silently reclassify the caller's own lodge while the caller
-- believed it addressed another one, and the documented LODGE_SCOPE_DENIED
-- contract (asserted by tests/property-type-transition-sql.test.mjs) did
-- not hold.
--
-- This migration redefines the three RPCs byte-identically except for one
-- explicit guard placed immediately after the UNAUTHENTICATED check and
-- before every lodge-scoped read/write:
--   if p_lodge_id is not null and v_lodge is distinct from p_lodge_id
--     -> LODGE_SCOPE_DENIED ("Access denied for this lodge.")
-- The resolver is intentionally unchanged (still never re-scopes); the
-- denial now lives where the comment always said it did. All other
-- behavior — advisory preview (no writes), FOR UPDATE row lock, capability,
-- same-product, expected-state, payload-hash idempotency (23505),
-- audited no-op, narrow profile fill, preservation, grants — is preserved.
--
-- Idempotent: CREATE OR REPLACE functions, re-issued grants/comments.

begin;

-- Clarify the resolver contract: mismatch returns the session lodge and the
-- RPC-level guard below denies; the resolver itself never re-scopes.
create or replace function public._property_transition_resolve_caller(p_lodge_id uuid)
returns table (lodge_id uuid, user_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_session public.app_sessions%rowtype;
  v_lodge uuid;
  v_user uuid;
  v_auth uuid;
begin
  select * into v_session from public.app_current_session_row();
  if v_session.id is not null then
    v_lodge := v_session.lodge_id;
    v_user := v_session.user_id;
  else
    begin
      v_auth := public.app_authenticated_user_id();
    exception when undefined_function then
      v_auth := null;
    end;
    if v_auth is not null then
      select u.id, u.lodge_id into v_user, v_lodge
        from public.users u
       where u.auth_user_id = v_auth
         and coalesce(u.status, 'active') = 'active'
       order by u.created_at, u.id
       limit 1;
    end if;
  end if;

  if p_lodge_id is not null and v_lodge is not null and v_lodge <> p_lodge_id then
    -- Lodge mismatch: return the session lodge (never re-scope to the
    -- request). Every transition RPC explicitly denies when the resolved
    -- lodge differs from the requested lodge (LODGE_SCOPE_DENIED).
    lodge_id := v_lodge;
    user_id := v_user;
    return next;
    return;
  end if;

  lodge_id := coalesce(p_lodge_id, v_lodge);
  user_id := v_user;
  return next;
end;
$$;

revoke all on function public._property_transition_resolve_caller(uuid) from public, anon, authenticated;

-- ── Advisory preview (never writes) ─────────────────────────────────────────
create or replace function public.preview_property_type_change(
  p_lodge_id uuid,
  p_target_type text,
  p_expected_property_type text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_target text := public._property_transition_normalize(p_target_type);
  v_settings public.settings%rowtype;
  v_expected_type text := public._property_transition_normalize(p_expected_property_type);
  v_expected_match boolean := true;
  v_from jsonb;
  v_to jsonb;
  v_total integer := 0;
  v_sites integer := 0;
  v_notes jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
begin
  select * into v_caller from public._property_transition_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;

  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED',
      'error', 'Sign in again and retry.');
  end if;
  -- Explicit wrong-lodge denial: the resolver returns the session lodge on
  -- mismatch, so any remaining difference is a cross-lodge call and fails
  -- closed instead of previewing the session lodge.
  if p_lodge_id is not null and v_lodge is distinct from p_lodge_id then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED',
      'error', 'Access denied for this lodge.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED',
      'error', 'Access denied for this lodge.');
  end if;
  if not public._property_transition_can_manage(v_lodge, v_user) then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED',
      'error', 'Only a lodge administrator can preview a property-type change. Ask an administrator.');
  end if;

  if v_target not in ('guest_house', 'bnb', 'lodge', 'camp', 'motel') then
    return jsonb_build_object('success', false, 'code', 'cross_product_rejected',
      'error', 'Property type changes stay inside LodgingOS (guest house, B&B, lodge, camp, motel). Hotel, resort, restaurant, bar and POS-only belong to other products.');
  end if;

  select * into v_settings from public.settings where lodge_id = v_lodge;
  if not found then
    return jsonb_build_object('success', false, 'code', 'SETTINGS_MISSING',
      'error', 'No company settings exist for this lodge yet. Complete setup first.');
  end if;

  if p_expected_property_type is not null and btrim(coalesce(p_expected_property_type, '')) <> ''
     and v_expected_type <> public._property_transition_normalize(v_settings.property_type) then
    v_expected_match := false;
  end if;
  if p_expected_updated_at is not null and v_settings.updated_at is distinct from p_expected_updated_at then
    v_expected_match := false;
  end if;

  -- Actual accommodation mix from live inventory (guarded for older shapes).
  if to_regclass('public.rooms') is not null then
    begin
      execute 'select count(*)::integer from public.rooms where lodge_id = $1'
        into v_total using v_lodge;
    exception when others then
      v_total := 0;
    end;
    begin
      execute 'select count(*)::integer from public.rooms where lodge_id = $1 and coalesce(room_type, '''') ilike any (array[''%camp%'', ''%site%'', ''%tent%'', ''%pitch%''])'
        into v_sites using v_lodge;
    exception when others then
      v_sites := 0;
    end;
  end if;

  v_from := public._property_transition_wording(v_settings.property_type);
  v_to := public._property_transition_wording(v_target);

  v_notes := v_notes || jsonb_build_array(jsonb_build_object('code', 'WORDING',
    'message', 'Wording changes from "' || (v_from->>'label') || '" to "' || (v_to->>'label')
      || '"; unit names change from "' || (v_from->>'unit_label') || '" to "' || (v_to->>'unit_label')
      || '"; exclusive-use label changes from "' || (v_from->>'exclusive_use') || '" to "' || (v_to->>'exclusive_use') || '".'));
  if v_total > 0 then
    v_notes := v_notes || jsonb_build_array(jsonb_build_object('code', 'INVENTORY_PRESERVED',
      'message', 'All ' || v_total::text || ' existing unit(s) (' || (v_total - v_sites)::text
        || ' room-style, ' || v_sites::text || ' site-style) are preserved with their IDs, bookings and rates unchanged.'));
  else
    v_notes := v_notes || jsonb_build_array(jsonb_build_object('code', 'NO_INVENTORY',
      'message', 'No accommodation units exist yet; only presentation defaults change.'));
  end if;
  if public._property_transition_normalize(v_settings.property_type) = v_target then
    v_notes := v_notes || jsonb_build_array(jsonb_build_object('code', 'UNCHANGED_TARGET',
      'message', 'The lodge is already "' || (v_to->>'label') || '". Committing records a no-op transition.'));
  end if;
  if not v_expected_match then
    v_notes := v_notes || jsonb_build_array(jsonb_build_object('code', 'STALE_PREVIEW',
      'message', 'The company settings changed since this preview was requested. Reload the current type before committing.'));
  end if;

  -- Mixed inventory is valid where supported, so it never blocks. The only
  -- configuration blocker is an incomplete setup: classification changes
  -- require a completed company record.
  if coalesce(v_settings.setup_complete, false) is not true then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'SETUP_INCOMPLETE',
      'message', 'Company setup is not complete for this lodge yet.',
      'repair', 'Complete company setup first, then change the property type.'));
  end if;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'current_type', public._property_transition_normalize(v_settings.property_type),
      'target_type', v_target,
      'expected_match', v_expected_match,
      'wording', jsonb_build_object(
        'from_label', v_from->>'label',
        'to_label', v_to->>'label',
        'unit_label_from', v_from->>'unit_label',
        'unit_label_to', v_to->>'unit_label',
        'exclusive_use_from', v_from->>'exclusive_use',
        'exclusive_use_to', v_to->>'exclusive_use'
      ),
      'navigation', jsonb_build_object('notes', v_notes),
      'blockers', v_blockers,
      'accommodation_mix', jsonb_build_object(
        'rooms', greatest(v_total - v_sites, 0),
        'sites', greatest(v_sites, 0),
        'mixed', (v_sites > 0 and (v_total - v_sites) > 0)
      ),
      'preserved', jsonb_build_array(
        'lodge_id', 'room_ids', 'site_ids', 'bookings', 'ledgers',
        'amount_paid', 'payment_status', 'rates', 'invoices', 'stock',
        'operating_profile_choices', 'entitlements'
      )
    )
  );
end;
$$;

revoke all on function public.preview_property_type_change(uuid, text, text, timestamptz) from public;
grant execute on function public.preview_property_type_change(uuid, text, text, timestamptz) to anon, authenticated, service_role;

comment on function public.preview_property_type_change(uuid, text, text, timestamptz) is
  'SECURITY DEFINER advisory preview for LodgingOS same-product property-type changes. Never writes.';

-- ── Atomic commit (locks settings row; idempotent per lodge + key) ──────────
create or replace function public.commit_property_type_change(
  p_lodge_id uuid,
  p_target_type text,
  p_expected_property_type text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_target text := public._property_transition_normalize(p_target_type);
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_settings public.settings%rowtype;
  v_current text;
  v_payload_hash text;
  v_existing public.property_type_transitions%rowtype;
  v_filled jsonb;
  v_result jsonb;
begin
  select * into v_caller from public._property_transition_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;

  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED',
      'error', 'Sign in again and retry.');
  end if;
  -- Explicit wrong-lodge denial: fail closed before the row lock so a
  -- mismatched lodge id can never commit against the session lodge.
  if p_lodge_id is not null and v_lodge is distinct from p_lodge_id then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED',
      'error', 'Access denied for this lodge.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED',
      'error', 'Access denied for this lodge.');
  end if;
  if not public._property_transition_can_manage(v_lodge, v_user) then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED',
      'error', 'Only a lodge administrator can change the property type. Ask an administrator.');
  end if;

  if v_target not in ('guest_house', 'bnb', 'lodge', 'camp', 'motel') then
    return jsonb_build_object('success', false, 'code', 'cross_product_rejected',
      'error', 'Property type changes stay inside LodgingOS (guest house, B&B, lodge, camp, motel). Hotel, resort, restaurant, bar and POS-only belong to other products.');
  end if;

  if v_key = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED',
      'error', 'A stable idempotency key is required. Generate one UUID per operation and reuse it on retry.');
  end if;
  if v_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return jsonb_build_object('success', false, 'code', 'INVALID_IDEMPOTENCY_KEY',
      'error', 'The idempotency key must be a UUID. Generate one UUID per operation and reuse it on retry.');
  end if;

  -- Lock the company row so concurrent commits serialize deterministically.
  select * into v_settings from public.settings where lodge_id = v_lodge for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'SETTINGS_MISSING',
      'error', 'No company settings exist for this lodge yet. Complete setup first.');
  end if;
  if coalesce(v_settings.setup_complete, false) is not true then
    return jsonb_build_object('success', false, 'code', 'SETUP_INCOMPLETE',
      'error', 'Company setup is not complete for this lodge yet. Complete setup first.');
  end if;

  v_current := public._property_transition_normalize(v_settings.property_type);

  -- Expected-state guard: the caller previewed a concrete version; a changed
  -- type or timestamp underneath means another writer committed first.
  if p_expected_property_type is not null and btrim(coalesce(p_expected_property_type, '')) <> ''
     and public._property_transition_normalize(p_expected_property_type) <> v_current then
    return jsonb_build_object('success', false, 'code', 'expected_state_conflict',
      'error', 'The property type changed since the preview (now "' || v_current || '"). Reload and preview again.',
      'server_property_type', v_current,
      'server_updated_at', v_settings.updated_at);
  end if;
  if p_expected_updated_at is not null and v_settings.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('success', false, 'code', 'expected_state_conflict',
      'error', 'The company settings changed since the preview. Reload and preview again.',
      'server_property_type', v_current,
      'server_updated_at', v_settings.updated_at);
  end if;

  -- Payload-bound idempotency: the key is bound to this exact operation. The
  -- timestamp contributes as epoch seconds so text representations of the same
  -- instant hash identically across clients.
  v_payload_hash := md5(coalesce(v_lodge::text, '') || '|' || v_target || '|'
    || coalesce(public._property_transition_normalize(p_expected_property_type), '') || '|'
    || coalesce(extract(epoch from p_expected_updated_at)::bigint::text, '') || '|'
    || coalesce(btrim(p_reason), ''));

  select * into v_existing
    from public.property_type_transitions
   where lodge_id = v_lodge and idempotency_key = v_key;
  if found then
    if v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'Idempotency key % was already used for a different property-type operation on this lodge. Generate a new key for a new operation; reuse the original payload to replay.',
        v_key
        using errcode = '23505';
    end if;
    return jsonb_build_object('success', true, 'replayed', true, 'data', v_existing.result);
  end if;

  if v_target = v_current then
    -- Unchanged target: audited no-op, no settings write.
    v_result := jsonb_build_object(
      'previous_type', v_current,
      'target_type', v_target,
      'changed', false,
      'settings_updated_at', v_settings.updated_at
    );
    begin
      insert into public.property_type_transitions
        (lodge_id, idempotency_key, target_type, previous_type, payload_hash, result, actor, reason)
      values (v_lodge, v_key, v_target, v_current, v_payload_hash, v_result, v_user, nullif(btrim(coalesce(p_reason, '')), ''));
    exception when unique_violation then
      select * into v_existing
        from public.property_type_transitions
       where lodge_id = v_lodge and idempotency_key = v_key;
      if v_existing.payload_hash is distinct from v_payload_hash then
        raise exception 'Idempotency key % was already used for a different property-type operation on this lodge. Generate a new key for a new operation; reuse the original payload to replay.',
          v_key
          using errcode = '23505';
      end if;
      return jsonb_build_object('success', true, 'replayed', true, 'data', v_existing.result);
    end;
    return jsonb_build_object('success', true, 'replayed', false, 'data', v_result);
  end if;

  -- Narrow profile fill: configured choices survive; only unset presentation
  -- fields gain per-target defaults.
  v_filled := public._property_transition_fill_profile(v_target, coalesce(v_settings.operating_profile, '{}'::jsonb));

  -- The ONLY settings columns this contract may change. Lodge identity, unit
  -- rows, bookings, ledgers, rates, invoices and stock are never touched here.
  update public.settings
     set property_type = v_target,
         business_type = 'lodge',
         operating_profile = v_filled,
         updated_at = now()
   where lodge_id = v_lodge
  returning * into v_settings;

  v_result := jsonb_build_object(
    'previous_type', v_current,
    'target_type', v_target,
    'changed', true,
    'settings_updated_at', v_settings.updated_at,
    'operating_profile_preserved', true
  );

  begin
    insert into public.property_type_transitions
      (lodge_id, idempotency_key, target_type, previous_type, payload_hash, result, actor, reason)
    values (v_lodge, v_key, v_target, v_current, v_payload_hash, v_result, v_user, nullif(btrim(coalesce(p_reason, '')), ''));
  exception when unique_violation then
    -- A concurrent commit won the race: resolve deterministically.
    select * into v_existing
      from public.property_type_transitions
     where lodge_id = v_lodge and idempotency_key = v_key;
    if v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'Idempotency key % was already used for a different property-type operation on this lodge. Generate a new key for a new operation; reuse the original payload to replay.',
        v_key
        using errcode = '23505';
    end if;
    return jsonb_build_object('success', true, 'replayed', true, 'data', v_existing.result);
  end;

  return jsonb_build_object('success', true, 'replayed', false, 'data', v_result);
end;
$$;

revoke all on function public.commit_property_type_change(uuid, text, text, timestamptz, text, text) from public;
grant execute on function public.commit_property_type_change(uuid, text, text, timestamptz, text, text) to anon, authenticated, service_role;

comment on function public.commit_property_type_change(uuid, text, text, timestamptz, text, text) is
  'SECURITY DEFINER atomic LodgingOS property-type commit. Row lock, lodge scope, capability, same-product, expected-state and payload-bound idempotency enforced; audit row per operation key.';

-- ── Timeout recovery: authoritative stored result for one operation key ─────
create or replace function public.get_property_type_transition_status(
  p_lodge_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_existing public.property_type_transitions%rowtype;
begin
  select * into v_caller from public._property_transition_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;

  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED',
      'error', 'Sign in again and retry.');
  end if;
  -- Explicit wrong-lodge denial: a status check for another lodge must not
  -- disclose, or reconcile against, the session lodge outcome.
  if p_lodge_id is not null and v_lodge is distinct from p_lodge_id then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED',
      'error', 'Access denied for this lodge.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED',
      'error', 'Access denied for this lodge.');
  end if;
  if not public._property_transition_can_manage(v_lodge, v_user) then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED',
      'error', 'Only a lodge administrator can read transition status. Ask an administrator.');
  end if;

  if v_key = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED',
      'error', 'An idempotency key is required to look up a transition.');
  end if;

  select * into v_existing
    from public.property_type_transitions
   where lodge_id = v_lodge and idempotency_key = v_key;
  if not found then
    return jsonb_build_object('success', false, 'code', 'NOT_FOUND',
      'error', 'No property-type transition is recorded for that key on this lodge. It is safe to commit with it.');
  end if;

  return jsonb_build_object(
    'success', true,
    'lodge_id', v_lodge,
    'idempotency_key', v_key,
    'target_type', v_existing.target_type,
    'previous_type', v_existing.previous_type,
    'actor', v_existing.actor,
    'created_at', v_existing.created_at,
    'data', v_existing.result
  );
end;
$$;

revoke all on function public.get_property_type_transition_status(uuid, text) from public;
grant execute on function public.get_property_type_transition_status(uuid, text) to anon, authenticated, service_role;

comment on function public.get_property_type_transition_status(uuid, text) is
  'SECURITY DEFINER authoritative stored result for one property-type operation key (ambiguous-timeout recovery).';

notify pgrst, 'reload schema';

commit;
