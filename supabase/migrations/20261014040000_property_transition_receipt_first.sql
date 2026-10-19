-- LodgingOS property-type transitions: receipt-first replay + source-family enforcement (R1+R2).
--
-- Forward fix; 20261014010000 and 20261014020000 are never modified. This
-- migration redefines preview_property_type_change and
-- commit_property_type_change byte-identically EXCEPT for the changes below.
--
-- R1 (receipt before stale checks). The 02 commit compared caller
-- expected-state against the locked settings row BEFORE looking up the
-- recorded idempotency key, so an exact replay of a successful transition
-- returned expected_state_conflict instead of the saved receipt, and a later
-- unrelated settings update broke otherwise valid replays. New order inside
-- commit (after auth/scope/capability/target checks and after the FOR UPDATE
-- row lock): (a) compute the payload fingerprint; (b) R1-RECEIPT-LOOKUP for
-- the lodge+key row; (c) on a hit with a matching hash return the saved
-- {success:true,replayed:true} result with NO mutation and NO expected-state
-- checks; on a hash mismatch raise 23505 deterministically; (d) only for
-- genuinely new keys, R1-NEW-OP-EXPECTED-STATE: require non-empty
-- expectations, then run the expected-state guards, then no-op/commit as
-- before. Concurrency behavior is unchanged: the settings FOR UPDATE row
-- lock serializes committers and the unique_violation race handlers resolve
-- same-key races deterministically (now with dual-hash matching).
--
-- Fingerprint v2 (full precision). The 01/02 fingerprint hashed
-- extract(epoch from p_expected_updated_at)::bigint, which truncates
-- sub-second precision: two distinct instants inside one second collide, and
-- a replay carrying full precision could miss its receipt. v2 hashes
-- extract(epoch ...)::text (numeric, full microsecond precision).
-- extract(epoch) is timezone-independent (seconds since 1970-01-01 UTC), so
-- text representations of the same instant hash identically across clients.
-- R1-RECEIPT-LOOKUP dual-accepts: a stored hash matching v2 OR legacy v1
-- counts as the same operation; all rows written by this migration store v2.
-- Historical v1 receipts therefore keep replaying after upgrade.
--
-- R2 (source-family enforcement). 01/02 rejected non-LodgingOS TARGETS but
-- never inspected the CURRENT type, so a hotel/restaurant/bar property could
-- be reclassified toward lodge through this SECURITY DEFINER contract.
-- public._property_transition_family(text) maps a (normalized) type to
-- 'lodging' | 'hotel' | 'pos' | 'unknown': guest_house/bnb/lodge/camp/motel
-- -> lodging; hotel/resort -> hotel; restaurant/bar/pos_only -> pos (the
-- normalizer maps pos_only to restaurant first); anything else -> unknown.
-- Commit and preview reject non-'lodging' SOURCES (R2-SOURCE-CHECK) with
-- code unsupported_source plus repair text, as well as non-lodging targets
-- (existing cross_product_rejected, unchanged). Historical replay of an
-- existing key with a matching hash returns the stored result without
-- re-checking the source family and without mutation (auth/scope/capability
-- still enforced up front, fail closed).
--
-- Expectations on new operations (R2-EXPECTATIONS-REQUIRED). A genuinely new
-- commit key must carry caller preview state (expected type and/or expected
-- timestamp); a blind commit with both absent is rejected with code
-- VALIDATION_FAILED whose message carries the expectations_required marker
-- plus the server values to preview against. Preview is advisory but runs
-- inside the same contract: with both expectations absent it returns
-- success:false code expectations_required (dedicated advisory code) instead
-- of an unguided advisory shape, so callers always preview from a concrete
-- version. Target-family (cross_product_rejected) and auth/scope/capability
-- checks keep their earlier positions and codes.
--
-- Grants match the existing convention: revoke public; grant
-- anon/authenticated/service_role on the RPCs; the family helper is revoked
-- (owner-only, invoked from SECURITY DEFINER RPCs).
--
-- Idempotent: CREATE OR REPLACE functions, re-issued grants/comments.

begin;

-- ── Product-family helper (owner-only) ──────────────────────────────────────
create or replace function public._property_transition_family(p_type text)
returns text
language sql
immutable
security definer
set search_path to 'public'
as $$
  select case public._property_transition_normalize(p_type)
    when 'guest_house' then 'lodging'
    when 'bnb' then 'lodging'
    when 'lodge' then 'lodging'
    when 'camp' then 'lodging'
    when 'motel' then 'lodging'
    when 'hotel' then 'hotel'
    when 'resort' then 'hotel'
    when 'restaurant' then 'pos'
    when 'bar' then 'pos'
    else 'unknown'
  end;
$$;

revoke all on function public._property_transition_family(text) from public, anon, authenticated;

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
  v_current_type text;
  v_source_family text;
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

  -- R2-SOURCE-CHECK: the current classification must itself belong to the
  -- LodgingOS family. A hotel/resort/restaurant/bar/unknown source can never
  -- enter this contract, even toward a lodging target.
  v_current_type := public._property_transition_normalize(v_settings.property_type);
  v_source_family := public._property_transition_family(v_settings.property_type);
  if v_source_family <> 'lodging' then
    return jsonb_build_object('success', false, 'code', 'unsupported_source',
      'error', 'This property is currently classified as "' || coalesce(v_settings.property_type, '') || '" and cannot change type through the LodgingOS transition contract.',
      'repair', 'Contact support to review the product classification. LodgingOS transitions accept guest house, B&B, lodge, camp and motel sources only.',
      'server_property_type', v_current_type,
      'server_updated_at', v_settings.updated_at);
  end if;

  -- R2-EXPECTATIONS-REQUIRED: preview is advisory but version-bound. Without
  -- caller preview state there is no expected_match to report, so fail with
  -- an explicit code instead of an unguided shape.
  if (p_expected_property_type is null or btrim(coalesce(p_expected_property_type, '')) = '')
     and p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'code', 'expectations_required',
      'error', 'Preview needs the current property type and settings timestamp. Reload company settings and preview again.',
      'server_property_type', v_current_type,
      'server_updated_at', v_settings.updated_at);
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
  'SECURITY DEFINER advisory preview for LodgingOS same-product property-type changes. Never writes. Enforces lodge scope, capability, target family, source family (unsupported_source) and version-bound expectations (expectations_required).';

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
  v_source_family text;
  v_payload_hash_v1 text;
  v_payload_hash_v2 text;
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

  -- Payload-bound idempotency with full-precision fingerprint (v2).
  -- extract(epoch ...) is timezone-independent; ::text keeps the full
  -- numeric microsecond precision so distinct instants never collide. v1
  -- (epoch::bigint seconds) is accepted on lookup only, for receipts
  -- written before this migration; new rows always store v2.
  v_payload_hash_v2 := md5(coalesce(v_lodge::text, '') || '|' || v_target || '|'
    || coalesce(public._property_transition_normalize(p_expected_property_type), '') || '|'
    || coalesce(extract(epoch from p_expected_updated_at)::text, '') || '|'
    || coalesce(btrim(p_reason), ''));
  v_payload_hash_v1 := md5(coalesce(v_lodge::text, '') || '|' || v_target || '|'
    || coalesce(public._property_transition_normalize(p_expected_property_type), '') || '|'
    || coalesce(extract(epoch from p_expected_updated_at)::bigint::text, '') || '|'
    || coalesce(btrim(p_reason), ''));

  -- R1-RECEIPT-LOOKUP: resolve an existing key BEFORE applying new-operation
  -- expected-state checks. A matching hash returns the saved result with no
  -- mutation even when the settings row has since moved on; a different
  -- payload raises 23505 deterministically.
  select * into v_existing
    from public.property_type_transitions
   where lodge_id = v_lodge and idempotency_key = v_key;
  if found then
    if v_existing.payload_hash = v_payload_hash_v2
       or v_existing.payload_hash = v_payload_hash_v1 then
      return jsonb_build_object('success', true, 'replayed', true, 'data', v_existing.result);
    end if;
    raise exception 'Idempotency key % was already used for a different property-type operation on this lodge. Generate a new key for a new operation; reuse the original payload to replay.',
      v_key
      using errcode = '23505';
  end if;

  -- R2-SOURCE-CHECK (new operations only): the locked current classification
  -- must itself belong to the LodgingOS family. It runs AFTER the receipt
  -- lookup so an authorized historical replay still returns its saved result
  -- without re-checking the source family and without mutation. A
  -- hotel/resort/restaurant/bar/unknown source is rejected here even when the
  -- target is a valid lodging type.
  v_source_family := public._property_transition_family(v_settings.property_type);
  if v_source_family <> 'lodging' then
    return jsonb_build_object('success', false, 'code', 'unsupported_source',
      'error', 'This property is currently classified as "' || coalesce(v_settings.property_type, '') || '" and cannot change type through the LodgingOS transition contract.',
      'repair', 'Contact support to review the product classification. LodgingOS transitions accept guest house, B&B, lodge, camp and motel sources only.',
      'server_property_type', v_current,
      'server_updated_at', v_settings.updated_at);
  end if;

  -- R1-NEW-OP-EXPECTED-STATE: only genuinely new keys reach here. Blind
  -- commits without caller preview state are rejected first; then the
  -- caller preview is compared against the locked row.
  -- R2-EXPECTATIONS-REQUIRED
  if (p_expected_property_type is null or btrim(coalesce(p_expected_property_type, '')) = '')
     and p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED',
      'error', 'expectations_required: commit needs the previewed property type and settings timestamp. Reload company settings, preview again, and recommit with the same idempotency key.',
      'server_property_type', v_current,
      'server_updated_at', v_settings.updated_at);
  end if;
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
      values (v_lodge, v_key, v_target, v_current, v_payload_hash_v2, v_result, v_user, nullif(btrim(coalesce(p_reason, '')), ''));
    exception when unique_violation then
      select * into v_existing
        from public.property_type_transitions
       where lodge_id = v_lodge and idempotency_key = v_key;
      if v_existing.payload_hash = v_payload_hash_v2
         or v_existing.payload_hash = v_payload_hash_v1 then
        return jsonb_build_object('success', true, 'replayed', true, 'data', v_existing.result);
      end if;
      raise exception 'Idempotency key % was already used for a different property-type operation on this lodge. Generate a new key for a new operation; reuse the original payload to replay.',
        v_key
        using errcode = '23505';
    end;
    return jsonb_build_object('success', true, 'replayed', false, 'data', v_result);
  end if;

  -- Narrow profile fill: configured choices survive; only unset presentation
  -- fields gain per-target defaults.
  v_filled := public._property_transition_fill_profile(v_target, coalesce(v_settings.operating_profile, '{}'::jsonb));

  -- R3-WRITER-FLAG: the ONLY settings write this contract may perform runs
  -- under a transaction-local writer flag so the classification guard
  -- (20261014050000) can distinguish this audited transition from ordinary
  -- settings/profile upserts. Lodge identity, unit rows, bookings, ledgers,
  -- rates, invoices and stock are never touched here.
  perform set_config('app.property_transition_writer', '1', true);
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
    values (v_lodge, v_key, v_target, v_current, v_payload_hash_v2, v_result, v_user, nullif(btrim(coalesce(p_reason, '')), ''));
  exception when unique_violation then
    -- A concurrent commit won the race: resolve deterministically.
    select * into v_existing
      from public.property_type_transitions
     where lodge_id = v_lodge and idempotency_key = v_key;
    if v_existing.payload_hash = v_payload_hash_v2
       or v_existing.payload_hash = v_payload_hash_v1 then
      return jsonb_build_object('success', true, 'replayed', true, 'data', v_existing.result);
    end if;
    raise exception 'Idempotency key % was already used for a different property-type operation on this lodge. Generate a new key for a new operation; reuse the original payload to replay.',
      v_key
      using errcode = '23505';
  end;

  return jsonb_build_object('success', true, 'replayed', false, 'data', v_result);
end;
$$;

revoke all on function public.commit_property_type_change(uuid, text, text, timestamptz, text, text) from public;
grant execute on function public.commit_property_type_change(uuid, text, text, timestamptz, text, text) to anon, authenticated, service_role;

comment on function public.commit_property_type_change(uuid, text, text, timestamptz, text, text) is
  'SECURITY DEFINER atomic LodgingOS property-type commit. Row lock, lodge scope, capability, target+source family, payload-bound idempotency with receipt-first replay (v2 full-precision fingerprint, v1 dual-accept), version-bound expectations and audited ledger row per operation key.';

notify pgrst, 'reload schema';

commit;
