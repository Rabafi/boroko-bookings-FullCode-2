-- LodgingOS campsite-priced kinds: permanent tents join the campsite pricing contract (R7 server half).
--
-- Contract: CAMPSITE_PRICED_KINDS = ('campsite', 'tent'). This literal set
-- MUST equal Agent C's client-side CAMPSITE_PRICED_KINDS. Normalized
-- 'campsite' and 'tent' route through the campsite occupancy/pricing
-- contract; normalized 'room'/'unit' stay on the room rate-plan contract.
-- (_normalize_accommodation_kind already maps tent->tent, site/camp site->
-- campsite, cabin/chalet->unit, everything else->room; verified in
-- 20260711140000. This migration does not touch the normalizer.)
--
-- What changes: public._is_campsite_priced_kind(text) (immutable,
-- owner-only) plus surgical gate swaps in the exact functions that decide
-- campsite-vs-room handling. Each swap is a pg_get_functiondef string
-- replacement with asserted occurrence counts (repo-precedented pattern
-- from 20261014030000 Part A): the migration raises instead of silently
-- skipping if a target body drifted. Covered gates:
--   (1) accommodation_booking_expected_total — entry gate (tent rooms now
--       priced, capacity/rate/mode rules apply unchanged);
--   (2) create_campsite_booking_pre_intent_v1 — entry gate beneath the
--       durable create_campsite_booking envelope (renamed by 20261005050000);
--   (3) update_campsite_booking — entry gate;
--   (4) reschedule_accommodation_booking — v_campsite branch;
--   (5) create_multi_room_booking_pre_intent_v1 — both v_campsite branches
--       beneath the durable create_multi_room_booking envelope (renamed by
--       20261005050000; asserted x2);
--   (6) room_booking_expected_total — priced-kind delegation branch;
--   (7) convert_quotation_to_booking_pre_intent_v1 — single-line carry gate;
--   (8) compute_accommodation_stay_total — tent-default assumption for
--       tent/composite quotes.
-- quote_room_stay needs no direct change: it delegates to
-- room_booking_expected_total and inherits gate (6). Stamped labels are
-- intentionally UNCHANGED: tent-priced bookings stamp
-- accommodation_kind='campsite' on the booking row and the details row (the
-- priced-family label), so existing campsite reports, the booking/detail
-- agreement check (starter recovery 22023 validation) and replay
-- idempotency keep working; rooms.accommodation_kind keeps the truthful
-- 'tent' inventory kind. Only NEW computations are affected — no history is
-- repriced (no data UPDATEs in this migration).
--
-- Deliberately out of scope (noted follow-up, not a regression):
-- create_online_booking keeps its ='campsite' public gate (tent rooms fall
-- through to the room path exactly as before this migration); availability
-- screens (get_available_rooms*) and inventory CRUD normalization are
-- untouched. Agent C owns client estimate/validation/report alignment.
--
-- Grants match convention: helper revoked (owner-only, invoked from
-- SECURITY DEFINER RPCs); redefined-function grants are NOT re-issued
-- because this migration never CREATE OR REPLACEs a function — it EXECUTEs
-- patched definitions that retain their existing grant sets.
--
-- Idempotent toward re-apply ONLY in the forward sense: re-running after a
-- successful apply finds zero occurrences of each old fragment and raises
-- BY DESIGN (fail closed, like 20261014030000 Part A) instead of
-- double-patching. Normal deployment applies once via the manifest.

begin;

-- ── Priced-kind helper (owner-only) ─────────────────────────────────────────
-- R7-PRICED-KIND. CAMPSITE_PRICED_KINDS = ('campsite', 'tent').
create or replace function public._is_campsite_priced_kind(p_kind text)
returns boolean
language sql
immutable
security definer
set search_path to 'public'
as $$
  select public._normalize_accommodation_kind(p_kind) in ('campsite', 'tent');
$$;

revoke all on function public._is_campsite_priced_kind(text) from public, anon, authenticated;

comment on function public._is_campsite_priced_kind(text) is
  'R7 priced-family gate: true for normalized campsite AND tent kinds (CAMPSITE_PRICED_KINDS). Room/unit stay room-priced. Server half of the shared Agent-C set.';

-- ── (1) accommodation_booking_expected_total entry gate ──────────────────────
do $$
declare
  v_def text;
  v_old text := E'if public._normalize_accommodation_kind(v_room.accommodation_kind) <> ''campsite'' then';
  v_new text := E'if not public._is_campsite_priced_kind(v_room.accommodation_kind) then';
  v_occ integer;
begin
  select pg_get_functiondef(
    'public.accommodation_booking_expected_total(uuid,uuid,date,date,integer,integer,integer,integer,uuid)'::regprocedure
  ) into v_def;
  if v_def is null then raise exception 'accommodation_booking_expected_total(...) is missing; apply the campsite pricing migration first'; end if;
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'campsite-priced patch expects exactly one entry gate in accommodation_booking_expected_total, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (2) campsite create inner entry gate ────────────────────────────────────
do $$
declare
  v_def text;
  v_old text := E'if not found or public._normalize_accommodation_kind(v_room.accommodation_kind) <> ''campsite'' then';
  v_new text := E'if not found or not public._is_campsite_priced_kind(v_room.accommodation_kind) then';
  v_occ integer;
begin
  select pg_get_functiondef(
    'public.create_campsite_booking_pre_intent_v1(uuid,uuid,uuid,date,date,integer,integer,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text)'::regprocedure
  ) into v_def;
  if v_def is null then raise exception 'create_campsite_booking_pre_intent_v1(...) is missing; apply the durable booking-envelope migration first'; end if;
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'campsite-priced patch expects exactly one entry gate in create_campsite_booking_pre_intent_v1, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (3) update_campsite_booking entry gate ──────────────────────────────────
do $$
declare
  v_def text;
  v_old text := E'if not found or public._normalize_accommodation_kind(v_room.accommodation_kind) <> ''campsite'' then';
  v_new text := E'if not found or not public._is_campsite_priced_kind(v_room.accommodation_kind) then';
  v_occ integer;
begin
  select pg_get_functiondef(
    'public.update_campsite_booking(uuid,uuid,jsonb,timestamptz,text)'::regprocedure
  ) into v_def;
  if v_def is null then raise exception 'update_campsite_booking(...) is missing; apply the verified booking contracts migration first'; end if;
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'campsite-priced patch expects exactly one entry gate in update_campsite_booking, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (4) reschedule_accommodation_booking branch ─────────────────────────────
do $$
declare
  v_def text;
  v_old text := E'v_campsite := public._normalize_accommodation_kind(v_room.accommodation_kind) = ''campsite'';';
  v_new text := E'v_campsite := public._is_campsite_priced_kind(v_room.accommodation_kind);';
  v_occ integer;
begin
  select pg_get_functiondef(
    'public.reschedule_accommodation_booking(uuid,uuid,uuid,date,date,text,text,text,boolean,numeric,timestamptz,uuid)'::regprocedure
  ) into v_def;
  if v_def is null then raise exception 'reschedule_accommodation_booking(...) is missing; apply the verified booking contracts migration first'; end if;
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'campsite-priced patch expects exactly one branch gate in reschedule_accommodation_booking, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (5) multi-room create inner branches (exactly two) ──────────────────────
do $$
declare
  v_def text;
  v_old text := E'v_campsite := public._normalize_accommodation_kind(v_room.accommodation_kind) = ''campsite'';';
  v_new text := E'v_campsite := public._is_campsite_priced_kind(v_room.accommodation_kind);';
  v_occ integer;
begin
  select pg_get_functiondef(
    'public.create_multi_room_booking_pre_intent_v1(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text)'::regprocedure
  ) into v_def;
  if v_def is null then raise exception 'create_multi_room_booking_pre_intent_v1(...) is missing; apply the durable booking-envelope migration first'; end if;
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 2 then raise exception 'campsite-priced patch expects exactly two branch gates in create_multi_room_booking_pre_intent_v1, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (6) room_booking_expected_total delegation branch ───────────────────────
do $$
declare
  v_def text;
  v_old text := E'if public._normalize_accommodation_kind(v_room.accommodation_kind) = ''campsite'' then';
  v_new text := E'if public._is_campsite_priced_kind(v_room.accommodation_kind) then';
  v_occ integer;
begin
  select pg_get_functiondef(
    'public.room_booking_expected_total(uuid,uuid,date,date,uuid)'::regprocedure
  ) into v_def;
  if v_def is null then raise exception 'room_booking_expected_total(...) is missing; apply the campsite pricing migration first'; end if;
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'campsite-priced patch expects exactly one delegation branch in room_booking_expected_total, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (7) convert_quotation_to_booking_pre_intent_v1 carry gate ───────────────
do $$
declare
  v_def text;
  v_old text := E'and public._normalize_accommodation_kind(v_room.accommodation_kind) = ''campsite'' then';
  v_new text := E'and public._is_campsite_priced_kind(v_room.accommodation_kind) then';
  v_occ integer;
begin
  select pg_get_functiondef(
    'public.convert_quotation_to_booking_pre_intent_v1(uuid,uuid,numeric,text,uuid)'::regprocedure
  ) into v_def;
  if v_def is null then raise exception 'convert_quotation_to_booking_pre_intent_v1(...) is missing; apply 20261014030000 first'; end if;
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'campsite-priced patch expects exactly one carry gate in convert_quotation_to_booking_pre_intent_v1, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- ── (8) compute_accommodation_stay_total tent-default assumption ─────────────
do $$
declare
  v_def text;
  v_old text := E'lower(coalesce(p_room.accommodation_kind, ''room'')) = ''campsite''';
  v_new text := E'public._is_campsite_priced_kind(p_room.accommodation_kind)';
  v_occ integer;
  v_count integer;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'compute_accommodation_stay_total'
     and p.pronargs = 6;
  if v_count <> 1 then
    raise exception 'compute_accommodation_stay_total/6 overload is missing or ambiguous (found %); apply the campsite accommodation model first', v_count;
  end if;
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'compute_accommodation_stay_total'
     and p.pronargs = 6;
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then raise exception 'campsite-priced patch expects exactly one kind assumption in compute_accommodation_stay_total, found %', v_occ; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

notify pgrst, 'reload schema';

commit;
