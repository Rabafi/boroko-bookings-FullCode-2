-- LodgingOS controlled property-type transitions (same-product reclassification).
--
-- Same-product LodgingOS types (guest_house, bnb, lodge, camp, motel) may be
-- reclassified after setup through a dedicated atomic, audited, idempotent
-- server contract. Cross-product targets (hotel, resort, restaurant, bar,
-- pos_only) are rejected so classification can never become a licensing or
-- product-family loophole.
--
-- Contracts:
-- - preview_property_type_change(...) is advisory only; it never writes.
-- - commit_property_type_change(...) locks the settings row FOR UPDATE,
--   enforces lodge scope + settings.manage_general capability, same-product
--   compatibility and caller expected-state, then records exactly one
--   idempotent row in property_type_transitions and updates only
--   property_type / business_type / operating_profile / updated_at on the
--   settings row. Lodge/room/site IDs, bookings, ledgers, rates, invoices,
--   stock and financial history are never touched.
-- - get_property_type_transition_status(...) returns the stored authoritative
--   result so an ambiguous timeout can recover without issuing a new key.
--
-- Auth mirrors the F&B module-preference contract (20260904000000): caller
-- resolution from the desktop app session with a lodge-mismatch fail-closed
-- posture, role-family management check with explicit capability overrides,
-- and app_lodge_access lodge scoping. Transitions are online-only by design;
-- the desktop domain refuses to queue them.

begin;

-- ── Idempotency + audit ledger (append-mostly; one row per operation key) ──
create table if not exists public.property_type_transitions (
  lodge_id uuid not null,
  idempotency_key text not null,
  target_type text not null,
  previous_type text,
  payload_hash text not null,
  result jsonb not null default '{}'::jsonb,
  actor uuid,
  reason text,
  created_at timestamptz not null default now(),
  constraint property_type_transitions_pkey primary key (lodge_id, idempotency_key),
  constraint property_type_transitions_key_check check (btrim(coalesce(idempotency_key, '')) <> ''),
  constraint property_type_transitions_hash_check check (btrim(coalesce(payload_hash, '')) <> '')
);

create index if not exists property_type_transitions_lodge_idx
  on public.property_type_transitions (lodge_id);

create index if not exists property_type_transitions_lodge_created_idx
  on public.property_type_transitions (lodge_id, created_at desc);

alter table public.property_type_transitions enable row level security;

revoke all on table public.property_type_transitions from public, anon, authenticated;
grant select, insert, update on table public.property_type_transitions to service_role;

-- ── Internal helpers (owner-only; invoked from SECURITY DEFINER RPCs) ──────

create or replace function public._property_transition_normalize(p_type text)
returns text
language sql
immutable
security definer
set search_path to 'public'
as $$
  select case lower(btrim(coalesce(p_type, '')))
    when 'guesthouse' then 'guest_house'
    when 'guest house' then 'guest_house'
    when 'bed_and_breakfast' then 'bnb'
    when 'bed & breakfast' then 'bnb'
    when 'campsite' then 'camp'
    when 'camping' then 'camp'
    when 'pos_only' then 'restaurant'
    else lower(btrim(coalesce(p_type, '')))
  end;
$$;

revoke all on function public._property_transition_normalize(text) from public, anon, authenticated;

-- Resolve the caller's lodge + actor from the desktop app session or the
-- linked Supabase Auth identity. Lodge mismatch fails closed by returning the
-- session lodge so the caller comparison rejects. Never re-scopes silently.
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

-- settings.manage equivalence: manager/admin/owner family unless an explicit
-- capability override revokes settings.manage_general. Mirrors the desktop
-- role profile without trusting client JSON.
create or replace function public._property_transition_can_manage(p_lodge_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text := '';
  v_status text := '';
  v_overrides jsonb := '{}'::jsonb;
begin
  if p_user_id is null or p_lodge_id is null then
    return false;
  end if;
  select lower(coalesce(u.role, '')), lower(coalesce(u.status, 'active')),
         coalesce(u.capability_overrides, '{}'::jsonb)
    into v_role, v_status, v_overrides
    from public.users u
   where u.id = p_user_id
     and u.lodge_id = p_lodge_id
   limit 1;
  if not found then
    return false;
  end if;
  if v_status <> 'active' then
    return false;
  end if;
  if lower(coalesce(v_overrides->>'settings.manage_general', 'true')) in ('false', '0', 'no') then
    return false;
  end if;
  return v_role in ('manager', 'admin', 'owner', 'super_admin', 'administrator');
end;
$$;

revoke all on function public._property_transition_can_manage(uuid, uuid) from public, anon, authenticated;

-- Server-side presentation wording. Mirrors the shared accommodation
-- vocabulary so preview labels match the desktop shell.
create or replace function public._property_transition_wording(p_type text)
returns jsonb
language sql
immutable
security definer
set search_path to 'public'
as $$
  select case public._property_transition_normalize(p_type)
    when 'guest_house' then jsonb_build_object(
      'label', 'Guest House', 'unit_label', 'Rooms & units', 'exclusive_use', 'Full guest house')
    when 'bnb' then jsonb_build_object(
      'label', 'Bed & Breakfast', 'unit_label', 'Rooms & units', 'exclusive_use', 'Full B&B')
    when 'camp' then jsonb_build_object(
      'label', 'Camp / Campsite', 'unit_label', 'Sites, tents, cabins & rooms', 'exclusive_use', 'Full camp')
    when 'motel' then jsonb_build_object(
      'label', 'Motel', 'unit_label', 'Rooms & units', 'exclusive_use', 'Full motel')
    else jsonb_build_object(
      'label', 'Lodge', 'unit_label', 'Rooms, cabins & units', 'exclusive_use', 'Full Lodge')
  end;
$$;

revoke all on function public._property_transition_wording(text) from public, anon, authenticated;

-- Preserve every configured operating_profile choice; fill only unset
-- presentation fields (accommodation_mix / campsite_profile) with narrow
-- per-target defaults. Never wholesale-replaces the profile.
create or replace function public._property_transition_fill_profile(p_target text, p_existing jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path to 'public'
as $$
declare
  v_existing jsonb := '{}'::jsonb;
  v_mix jsonb := '{}'::jsonb;
  v_camp jsonb := '{}'::jsonb;
  v_target text := public._property_transition_normalize(p_target);
  v_campsites_default boolean := (v_target = 'camp');
begin
  if p_existing is not null and jsonb_typeof(p_existing) = 'object' then
    v_existing := p_existing;
  end if;
  if v_existing ? 'accommodation_mix' and jsonb_typeof(v_existing->'accommodation_mix') = 'object' then
    v_mix := v_existing->'accommodation_mix';
  end if;
  if v_existing ? 'campsite_profile' and jsonb_typeof(v_existing->'campsite_profile') = 'object' then
    v_camp := v_existing->'campsite_profile';
  end if;

  -- accommodation_mix: preserve configured values; default rooms_or_units to
  -- true, campsites to true only for camp targets, exclusive use to false.
  v_mix := jsonb_build_object(
    'rooms_or_units', coalesce((v_mix->>'rooms_or_units')::boolean, true),
    'campsites', coalesce((v_mix->>'campsites')::boolean, v_campsites_default),
    'whole_property_exclusive_use', coalesce((v_mix->>'whole_property_exclusive_use')::boolean, false)
  ) || (v_mix - '{rooms_or_units,campsites,whole_property_exclusive_use}');

  -- campsite_profile: preserve configured values; default every presentation
  -- flag to the target-implied default (true for camp, false otherwise).
  v_camp := jsonb_build_object(
    'enabled', coalesce((v_camp->>'enabled')::boolean, v_campsites_default),
    'has_numbered_sites', coalesce((v_camp->>'has_numbered_sites')::boolean, v_campsites_default),
    'has_powered_sites', coalesce((v_camp->>'has_powered_sites')::boolean, v_campsites_default),
    'has_unpowered_sites', coalesce((v_camp->>'has_unpowered_sites')::boolean, v_campsites_default),
    'supports_per_person_pricing', coalesce((v_camp->>'supports_per_person_pricing')::boolean, v_campsites_default),
    'supports_per_site_pricing', coalesce((v_camp->>'supports_per_site_pricing')::boolean, v_campsites_default),
    'supports_vehicle_or_tent_limits', coalesce((v_camp->>'supports_vehicle_or_tent_limits')::boolean, v_campsites_default)
  ) || (v_camp - '{enabled,has_numbered_sites,has_powered_sites,has_unpowered_sites,supports_per_person_pricing,supports_per_site_pricing,supports_vehicle_or_tent_limits}');

  return v_existing
    || jsonb_build_object(
      'property_type', v_target,
      'accommodation_mix', v_mix,
      'campsite_profile', v_camp
    );
end;
$$;

revoke all on function public._property_transition_fill_profile(text, jsonb) from public, anon, authenticated;

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
