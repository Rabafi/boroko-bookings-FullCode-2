-- Claim-first tab settlement ordering for create_pos_order_v3 (P0).
--
-- The atomic-settlement rewrite validated and locked the tab before the
-- idempotency claim. A committed payment whose response was lost therefore
-- retried into a closed tab and came back tab_already_settled instead of
-- replaying its stored receipt. This migration reorders the function so an
-- exact replay returns before any tab lock, status/version validation,
-- ownership validation, upsert, or business write:
--
--   lodge/role/outlet checks, proof strip, request hash, claim, replay
--   return, entitlement guard, snapshot/shift/operator resolution, pricing,
--   tab lock + validation + ownership, tab resolve, duplicate-settlement
--   check, record, atomic close.
--
-- The proof strip stays pre-claim (rotating proofs must hash identically);
-- only its validation moves. Tab resolve-or-create is additionally gated on
-- an explicit resolve_tab caller flag so legacy and non-tab flows never
-- mint tabs. A settlement close that affects no row raises (rolling back
-- the order with it) instead of returning success with a warning.

begin;

-- ── Preconditions: refuse to install on a drifted contract ──────────────────
do $pre$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'create_pos_order_v3(jsonb) is not installed';
  end if;
  if position('pos_tab_settled' in v_definition) = 0 then
    raise exception 'Atomic tab settlement is missing; apply 20260905230000 first';
  end if;
  if position('tab_version_conflict' in v_definition) = 0 then
    raise exception 'Tab version guard is missing; apply 20260905232000 first';
  end if;
  if position('tab_already_settled' in v_definition) = 0 then
    raise exception 'Duplicate settlement guard is missing; apply 20260905231000 first';
  end if;
end
$pre$;

do $do$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;

  -- 1. Remove the pre-claim tab lock block (re-added post-claim below).
  v_old := $old$  if v_tab_id is not null then
    select t.status, t.tab_version
      into v_tab_status, v_tab_version
      from public.pos_tabs t
     where t.id = v_tab_id
       and t.lodge_id = v_lodge_id
       and t.outlet_id is not distinct from v_outlet_id
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'The selected open tab is missing or belongs to another lodge/outlet.');
    end if;
    if v_tab_status not in ('open', 'running', 'ready', 'delivered') then
      return jsonb_build_object('success', false, 'code', 'tab_already_settled', 'error', 'This tab is already closed. Refresh open tabs before taking payment.');
    end if;
    if nullif(payload->>'expected_tab_version', '') is not null then
      if nullif(payload->>'expected_tab_version', '') !~ '^[0-9]+$' then
        return jsonb_build_object('success', false, 'code', 'tab_version_conflict', 'error', 'This tab changed on another terminal. Refresh it before taking payment.');
      end if;
      v_expected_tab_version := (payload->>'expected_tab_version')::integer;
      if v_expected_tab_version <> v_tab_version then
        return jsonb_build_object('success', false, 'code', 'tab_version_conflict', 'error', 'This tab changed on another terminal. Refresh it before taking payment.', 'tab_version', v_tab_version);
      end if;
    end if;
  end if;$old$;
  v_new := $new$  -- Tab lock and validation run after idempotent replay (see below), so an
  -- exact retry returns its stored receipt instead of failing on its own
  -- already-closed tab.$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Pre-claim tab lock block is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- 2. Keep the proof strip pre-claim (stable retry hashes); move only the
  -- ownership validation post-claim.
  v_old := $old$  v_tab_owner_error := public._pos_tab_settlement_owner_error(payload);
  IF v_tab_owner_error IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'tab_not_owned', 'error', v_tab_owner_error);
  END IF;
  payload := payload - '_operator_proof';$old$;
  v_new := $new$  -- The rotating Till proof is stripped before hashing so retries hash
  -- identically; ownership itself is validated after idempotent replay below.
  payload := payload - '_operator_proof';$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Pre-claim ownership guard is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- 3. Insert the post-claim tab preamble (lock, status, version, ownership)
  -- ahead of the snapshot load.
  v_old := $old$  select s.*
    into v_snapshot$old$;
  v_new := $new$  -- Tab lock, status/version validation, and ownership run AFTER
  -- idempotent replay: an exact retry returns its stored receipt above and
  -- never reaches here, so a settled tab cannot turn a valid retry into a
  -- rejection. Proof was stripped pre-claim for hash stability and is
  -- reattached here from the entry-time copy for ownership validation.
  if v_tab_id is not null then
    select t.status, t.tab_version
      into v_tab_status, v_tab_version
      from public.pos_tabs t
     where t.id = v_tab_id
       and t.lodge_id = v_lodge_id
       and t.outlet_id is not distinct from v_outlet_id
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'The selected open tab is missing or belongs to another lodge/outlet.');
    end if;
    if v_tab_status not in ('open', 'running', 'ready', 'delivered') then
      return jsonb_build_object('success', false, 'code', 'tab_already_settled', 'error', 'This tab is already closed. Refresh open tabs before taking payment.');
    end if;
    if nullif(payload->>'expected_tab_version', '') is not null then
      if nullif(payload->>'expected_tab_version', '') !~ '^[0-9]+$' then
        return jsonb_build_object('success', false, 'code', 'tab_version_conflict', 'error', 'This tab changed on another terminal. Refresh it before taking payment.');
      end if;
      v_expected_tab_version := (payload->>'expected_tab_version')::integer;
      if v_expected_tab_version <> v_tab_version then
        return jsonb_build_object('success', false, 'code', 'tab_version_conflict', 'error', 'This tab changed on another terminal. Refresh it before taking payment.', 'tab_version', v_tab_version);
      end if;
    end if;
    v_tab_owner_error := public._pos_tab_settlement_owner_error(payload || jsonb_build_object('_operator_proof', v_tab_operator_proof));
    IF v_tab_owner_error IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'tab_not_owned', 'error', v_tab_owner_error);
    END IF;
  end if;

  select s.*
    into v_snapshot$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Snapshot select anchor is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- 4. Gate tab resolve-or-create on an explicit caller flag so legacy and
  -- non-tab flows can never mint tabs as a side effect.
  v_old := $old$  if v_tab_id is null
     and nullif(btrim(coalesce(payload->>'tab_name', '')), '') is not null then$old$;
  v_new := $new$  if v_tab_id is null
     and coalesce(lower(payload->>'resolve_tab'), '') = 'true'
     and nullif(btrim(coalesce(payload->>'tab_name', '')), '') is not null then$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Tab resolve-or-create anchor is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- 5. A settlement close that affects no row must roll everything back,
  -- never commit a payment with a warning.
  v_old := $old$    if not found or v_settle_tab.status not in ('open', 'running', 'ready', 'delivered') then
      v_tab_close_warning := 'The linked tab changed before settlement completed; the payment was recorded.';$old$;
  v_new := $new$    if not found or v_settle_tab.status not in ('open', 'running', 'ready', 'delivered') then
      raise exception using errcode = 'P0001',
        message = 'Tab settlement failed after the payment was recorded; nothing was committed. Retry with the same operation key.';$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Settlement close anchor is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end
$do$;

commit;
