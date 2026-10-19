-- F1 public permanent-tent parity: extend the priced family to the public booking path.
--
-- Parent-verified context: the shared contract CAMPSITE_PRICED_KINDS =
-- ('campsite', 'tent') lives in src/shared/accommodation.js (isCampsitePriced)
-- and the server helper public._is_campsite_priced_kind(text) treats tents as
-- campsite-priced (20261014060000). Desktop + server quote/create/edit/group
-- paths route tents through the campsite occupancy/pricing contract. But the
-- public path was explicitly left behind: create_online_booking_legacy keeps a
-- ='campsite' total branch, drops tents/vehicles on single-room and
-- full-lodge lines, rejects valid priced stays with a room-style
-- max_occupancy gate, and stamps the inventory kind instead of the
-- priced-family label. The public React page (BookingPage.jsx) used
-- isCampsiteUnit (campsite-only) for the same decisions, so tents never
-- carried counts end to end. The earlier "booking-site unaffected" claim was
-- wrong: changing the shared pricing dependency without updating the public
-- consumer is an integration gap (F1).
--
-- Live-object map (verified against the migration chain; later migrations
-- wrap/rename, never edit history):
-- - public.create_online_booking(text,jsonb) — LIVE object is the
--   20261005050000 exact-envelope wrapper (replaced the 20260904090000
--   wrapper). Grants: anon, authenticated, service_role. It binds the stable
--   browser key, delegates to create_online_booking_legacy, then verifies
--   room/adult/child binding, invoice rows and the multi-room invoice group.
-- - public.create_online_booking_legacy(text,jsonb) — inner implementation:
--   20260703153000 body + 20260711200000 in-place patch (per-line tents/
--   vehicles reads for multi-room `rooms[]` lines, ='campsite' expected-total
--   branch, tents_count/vehicles_count/accommodation_kind columns, details
--   rows). Revoked from anon/authenticated: server-only, entered only via
--   the wrapper after schema-cache refresh.
-- - Availability readers need NO change: get_available_rooms lists tent rooms
--   in its rooms leg (`<> 'campsite'` includes normalized 'tent') with the
--   full campsite metadata columns (capacity_adults/children, max_tents/
--   vehicles, rate_mode + all four rates) and a truthful 'tent'
--   accommodation_kind; the display total comes from
--   compute_accommodation_stay_total whose tent-default assumption was
--   already extended to the priced family by 20261014060000 (8). Moving tents
--   into the campsites leg would mislabel them ('campsite'::text is
--   hardcoded there), so the rooms-leg placement is INTENTIONAL and kept.
-- - get_public_booking_offers needs NO change: a tents-only property still
--   reports offers.rooms=true (`<> 'campsite'` counts tents as rooms), so
--   tents stay bookable through the rooms offer; offers.campsites stays a
--   strict campsite flag.
-- - quote_room_stay needs NO change: it delegates to
--   room_booking_expected_total, which inherits priced-tent handling via
--   20261014060000 (6). The booking site does not call it (client estimates
--   come from the shared computeStayTotal helper); desktop quotes pass
--   through the patched delegation.
--
-- What this migration changes (forward CREATE/EXECUTE patches only; history
-- is never rewritten; existing grants are preserved because patched
-- definitions are EXECUTEd, not re-CREATEd — same precedent as
-- 20261014060000):
--   (1) legacy single-room lines carry top-level tents/vehicles
--       (previously only multi-room `rooms[]` lines carried them, so a tent
--       single always persisted 0/0);
--   (2) legacy full-lodge lines carry top-level tents/vehicles (the exclusive
--       booking keeps its whole-property total; counts are still recorded);
--   (3) per-line capacity gate becomes priced-family aware: priced kinds
--       enforce independent capacity_adults / capacity_children / max_tents /
--       max_vehicles caps plus tent/vehicle rate-mode minimums (mirroring
--       accommodation_booking_expected_total) with NO earlier generic
--       max_occupancy gate, so a valid 2-adult + 1-child tent stay passes;
--       room/unit kinds keep the exact existing max_occupancy gate;
--   (4) per-line expected-total branch routes priced kinds (campsite + tent)
--       to accommodation_booking_expected_total with the line counts;
--       full_lodge keeps its whole-property total; room/unit lines keep the
--       room rate-plan total. Tent lines NEVER fall through to the
--       GUC-default room delegation with wrong counts;
--   (5) bookings + booking_accommodation_details stamp the priced-family
--       label 'campsite' for priced kinds (desktop parity: tent-priced rows
--       share the campsite reports/agreement checks; rooms inventory keeps
--       the truthful 'tent' kind);
--   (6) the live wrapper additionally binds per-line tents_count/
--       vehicles_count and requires a matching occupancy details row for
--       multi-room lines, and verifies single-room occupancy + details
--       against the top-level payload. Mismatches raise P0001 and roll the
--       whole envelope back (fail closed, like the existing binding checks).
--
-- Each patch asserts its occurrence count and raises instead of silently
-- skipping on drift. Only NEW computations are affected — no history is
-- repriced (no data UPDATEs). Stable idempotency keys, envelope immutability
-- and the legacy-server-only revocation are untouched.
--
-- Intentionally unsupported: NONE of the public permanent-tent paths remain
-- unsupported after this migration — single, multi-room and full-lodge tent
-- bookings are all priced, capped, persisted and bound. (Availability keeps
-- tents in the rooms leg by design, documented above — that is placement,
-- not an unsupported path.)

begin;

-- ── Prerequisite guard ──────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public._is_campsite_priced_kind(text)') is null then
    raise exception 'public._is_campsite_priced_kind(text) is missing; apply 20261014060000_campsite_priced_tent_kind.sql first';
  end if;
  if to_regprocedure('public.create_online_booking_legacy(text,jsonb)') is null then
    raise exception 'public.create_online_booking_legacy(text,jsonb) is missing; apply the verified booking contracts migration first';
  end if;
  if to_regprocedure('public.create_online_booking(text,jsonb)') is null then
    raise exception 'public.create_online_booking(text,jsonb) is missing; apply the public envelope migrations first';
  end if;
end $$;

-- ── (1) legacy full-lodge lines: carry top-level tents/vehicles ─────────────
do $$
declare
  v_def text;
  v_old text := E'        ''room_id'', r.id,\n        ''adults'', coalesce((payload->>''adults'')::int, 1),\n        ''children'', coalesce((payload->>''children'')::int, 0)\n      ) order by r.room_number), ''[]''::jsonb)';
  v_new text := E'        ''room_id'', r.id,\n        ''adults'', coalesce((payload->>''adults'')::int, 1),\n        ''children'', coalesce((payload->>''children'')::int, 0),\n        ''tents'', coalesce((payload->>''tents'')::int, 0),\n        ''vehicles'', coalesce((payload->>''vehicles'')::int, 0)\n      ) order by r.room_number), ''[]''::jsonb)';
  v_occ integer;
begin
  select pg_get_functiondef('public.create_online_booking_legacy(text,jsonb)'::regprocedure) into v_def;
  -- Normalize: the live wrapper file (20261005050000) is CRLF-encoded, so a
  -- deployed prosrc may carry \r\n. Normalize before LF-fragment matching.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'F1 patch expects exactly one full-lodge line builder in create_online_booking_legacy, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (2) legacy single-room lines: carry top-level tents/vehicles ────────────
do $$
declare
  v_def text;
  v_old text := E'      ''room_id'', payload->>''room_id'',\n      ''adults'', coalesce((payload->>''adults'')::int, 1),\n      ''children'', coalesce((payload->>''children'')::int, 0)\n    ));';
  v_new text := E'      ''room_id'', payload->>''room_id'',\n      ''adults'', coalesce((payload->>''adults'')::int, 1),\n      ''children'', coalesce((payload->>''children'')::int, 0),\n      ''tents'', coalesce((payload->>''tents'')::int, 0),\n      ''vehicles'', coalesce((payload->>''vehicles'')::int, 0)\n    ));';
  v_occ integer;
begin
  select pg_get_functiondef('public.create_online_booking_legacy(text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'F1 patch expects exactly one single-room line builder in create_online_booking_legacy, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (3) legacy per-line capacity gate: priced-family independent caps ───────
do $$
declare
  v_def text;
  v_old text := E'    if v_total_guests > coalesce(v_room.max_occupancy, 0) then\n      return jsonb_build_object(''success'', false, ''error'', ''Room '' || coalesce(v_room.room_number, '''') || '' supports up to '' || coalesce(v_room.max_occupancy, 0) || '' guests'');\n    end if;';
  v_new text := E'    if public._is_campsite_priced_kind(v_room.accommodation_kind) then\n      if v_room.capacity_adults is not null and v_adults > v_room.capacity_adults then\n        return jsonb_build_object(''success'', false, ''error'', ''Site '' || coalesce(v_room.room_number, '''') || '' supports up to '' || v_room.capacity_adults || '' adults'');\n      end if;\n      if v_room.capacity_children is not null and v_children > v_room.capacity_children then\n        return jsonb_build_object(''success'', false, ''error'', ''Site '' || coalesce(v_room.room_number, '''') || '' supports up to '' || v_room.capacity_children || '' children'');\n      end if;\n      if v_room.max_tents is not null and v_tents > v_room.max_tents then\n        return jsonb_build_object(''success'', false, ''error'', ''Site '' || coalesce(v_room.room_number, '''') || '' supports up to '' || v_room.max_tents || '' tents'');\n      end if;\n      if v_room.max_vehicles is not null and v_vehicles > v_room.max_vehicles then\n        return jsonb_build_object(''success'', false, ''error'', ''Site '' || coalesce(v_room.room_number, '''') || '' supports up to '' || v_room.max_vehicles || '' vehicles'');\n      end if;\n      if public._normalize_rate_mode(v_room.rate_mode) = ''tent'' and v_tents < 1 then\n        return jsonb_build_object(''success'', false, ''error'', ''At least one tent is required for per-tent pricing'');\n      end if;\n      if public._normalize_rate_mode(v_room.rate_mode) = ''vehicle'' and v_vehicles < 1 then\n        return jsonb_build_object(''success'', false, ''error'', ''At least one vehicle is required for per-vehicle pricing'');\n      end if;\n    elsif v_total_guests > coalesce(v_room.max_occupancy, 0) then\n      return jsonb_build_object(''success'', false, ''error'', ''Room '' || coalesce(v_room.room_number, '''') || '' supports up to '' || coalesce(v_room.max_occupancy, 0) || '' guests'');\n    end if;';
  v_occ integer;
begin
  select pg_get_functiondef('public.create_online_booking_legacy(text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'F1 patch expects exactly one guest-capacity gate in create_online_booking_legacy, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (4) legacy per-line total: priced family uses the occupancy-aware total ─
do $$
declare
  v_def text;
  v_old text := E'case when public._normalize_accommodation_kind(v_room.accommodation_kind) = ''campsite'' then public.accommodation_booking_expected_total';
  v_new text := E'case when public._is_campsite_priced_kind(v_room.accommodation_kind) then public.accommodation_booking_expected_total';
  v_occ integer;
begin
  select pg_get_functiondef('public.create_online_booking_legacy(text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'F1 patch expects exactly one priced-total branch in create_online_booking_legacy, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (5a) legacy bookings row: stamp the priced-family label ────────────────
do $$
declare
  v_def text;
  v_old text := E'v_booking_id, v_lodge_id, v_customer_id, v_room_id, v_check_in, v_check_out, v_adults, v_children, v_tents, v_vehicles, public._normalize_accommodation_kind(v_room.accommodation_kind),';
  v_new text := E'v_booking_id, v_lodge_id, v_customer_id, v_room_id, v_check_in, v_check_out, v_adults, v_children, v_tents, v_vehicles, case when public._is_campsite_priced_kind(v_room.accommodation_kind) then ''campsite'' else public._normalize_accommodation_kind(v_room.accommodation_kind) end,';
  v_occ integer;
begin
  select pg_get_functiondef('public.create_online_booking_legacy(text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'F1 patch expects exactly one bookings-row kind label in create_online_booking_legacy, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (5b) legacy details row: stamp the priced-family label ─────────────────
do $$
declare
  v_def text;
  v_old text := E'values (v_booking_id, v_lodge_id, public._normalize_accommodation_kind(v_room.accommodation_kind), v_adults, v_children, v_tents, v_vehicles, public._normalize_rate_mode';
  v_new text := E'values (v_booking_id, v_lodge_id, case when public._is_campsite_priced_kind(v_room.accommodation_kind) then ''campsite'' else public._normalize_accommodation_kind(v_room.accommodation_kind) end, v_adults, v_children, v_tents, v_vehicles, public._normalize_rate_mode';
  v_occ integer;
begin
  select pg_get_functiondef('public.create_online_booking_legacy(text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'F1 patch expects exactly one details-row kind label in create_online_booking_legacy, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (6a) live wrapper: bind per-line tents/vehicles + require details ──────
do $$
declare
  v_def text;
  v_old text := $fragment$          or b.adults is distinct from greatest(1,coalesce(nullif(r.value->>'adults','')::integer,1))
          or b.children is distinct from greatest(0,coalesce(nullif(r.value->>'children','')::integer,0)))) then$fragment$;
  v_new text := $fragment$          or b.adults is distinct from greatest(1,coalesce(nullif(r.value->>'adults','')::integer,1))
          or b.children is distinct from greatest(0,coalesce(nullif(r.value->>'children','')::integer,0))
          or b.tents_count is distinct from greatest(0,coalesce(nullif(r.value->>'tents','')::integer,0))
          or b.vehicles_count is distinct from greatest(0,coalesce(nullif(r.value->>'vehicles','')::integer,0))
          or not exists(select 1 from public.booking_accommodation_details d where d.booking_id=u.booking_id and d.lodge_id=v_lodge_id
            and d.adults=b.adults and d.children=b.children and d.tents=b.tents_count and d.vehicles=b.vehicles_count))) then$fragment$;
  v_occ integer;
begin
  select pg_get_functiondef('public.create_online_booking(text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'F1 patch expects exactly one multi-room binding check in create_online_booking, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (6b) live wrapper: verify single-room occupancy + details ──────────────
do $$
declare
  v_def text;
  v_old text := $fragment$  v_result:=v_result||jsonb_build_object(
    'operation_id',v_key,'operation_type','public_booking_create_v1','payload_hash',v_hash,$fragment$;
  v_new text := $fragment$  if jsonb_typeof(v_payload->'rooms')<>'array' and lower(coalesce(v_payload->>'booking_type','room'))<>'full_lodge' then
    if exists(select 1 from unnest(v_booking_ids) as u(booking_id) join public.bookings b on b.id=u.booking_id and b.lodge_id=v_lodge_id
        where b.tents_count is distinct from greatest(0,coalesce(nullif(v_payload->>'tents','')::integer,0))
           or b.vehicles_count is distinct from greatest(0,coalesce(nullif(v_payload->>'vehicles','')::integer,0))) then
      raise exception 'Public booking response does not match committed occupancy counts' using errcode='P0001';
    end if;
    if exists(select 1 from unnest(v_booking_ids) as u(booking_id) left join public.booking_accommodation_details d
        on d.booking_id=u.booking_id and d.lodge_id=v_lodge_id
       where d.booking_id is null
          or d.adults is distinct from greatest(1,coalesce(nullif(v_payload->>'adults','')::integer,1))
          or d.children is distinct from greatest(0,coalesce(nullif(v_payload->>'children','')::integer,0))
          or d.tents is distinct from greatest(0,coalesce(nullif(v_payload->>'tents','')::integer,0))
          or d.vehicles is distinct from greatest(0,coalesce(nullif(v_payload->>'vehicles','')::integer,0))) then
      raise exception 'Public booking did not persist its occupancy details' using errcode='P0001';
    end if;
  end if;
  v_result:=v_result||jsonb_build_object(
    'operation_id',v_key,'operation_type','public_booking_create_v1','payload_hash',v_hash,$fragment$;
  v_occ integer;
begin
  select pg_get_functiondef('public.create_online_booking(text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'F1 patch expects exactly one receipt anchor in create_online_booking, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- Grants are intentionally NOT re-issued: EXECUTEd patch definitions retain
-- their existing sets (legacy stays revoked from anon/authenticated and
-- server-only; the live wrapper stays granted to
-- anon/authenticated/service_role, same precedent as 20261014060000).
-- Fail-closed reapply behavior matches 20261014030000/20261014060000: a
-- second apply finds zero occurrences and raises instead of double-patching.

notify pgrst, 'reload schema';

commit;
