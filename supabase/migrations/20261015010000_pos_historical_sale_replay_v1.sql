-- 20261015010000_pos_historical_sale_replay_v1.sql   (REVISION 2)
--
-- The previous draft of this file was reviewed and NOT approved (Codex
-- review, CHANGES REQUIRED R2/R3/R4). It copied an obsolete September 5
-- copy of the whole order function as a replacement body. This revision
-- keeps the same public contract but composes the change against the LIVE
-- create_pos_order_v3 definition:
--
--   * R2 — no body copy. The live function is patched in place with
--     pg_get_functiondef + exact, exactly-once anchors and fail-closed
--     drift checks. Claim-first ordering, duplicate-settlement, tab-version,
--     waiter-attribution and pool-cash guards are preserved by construction.
--   * R3 — receipt-first. replay_pos_order_v3_historical_v1 performs the
--     authoritative idempotency claim (same operation key, same request
--     hash the live function uses: rotating proof + replay key stripped)
--     and returns the stored receipt BEFORE any shift, tab, catalogue or
--     entitlement state is read.
--   * R4 — real admission. pos_historical_replay_admissions is a bounded,
--     audited, consumable server-side record armed only after Bar-only
--     scope, lodge/role/outlet authorization, shift open/close evidence,
--     client-time window and actor/operator binding are validated.
--     'hist-replay:' is a correlation key, never evidence.
--
-- Resulting create_pos_order_v3 order (historical branch in brackets):
--   lodge/role/outlet checks, proof + replay-key strip, request hash, claim,
--   replay return, entitlement guards, [admission lookup], tab lock +
--   validation + [historical ownership], pool guard, snapshot/window,
--   shift resolution (closed shift accepted only with a matching armed
--   admission), operator binding, pricing, record, [admission consume +
--   historical audit + cash-up reconciliation event], atomic close.
--
-- Age policy follows the lodge's configured pos_offline_trading_hours
-- (Bar-only lodges are set to 87600h by 20260923000002; other products stay
-- at their configured floor). No invented 56-day ceiling.
--
-- Nothing in this file is applied anywhere until Codex review approves
-- these exact bytes. Requires 20260820180000 (owner helper + bar scope),
-- 20260905230000..20260905234000 (tab settlement chain) and 20260922000001
-- (pool guard) to be present, as recorded in the deployment packet.

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
  if position('v_tab_owner_error text;' in v_definition) = 0 then
    raise exception 'Tab ownership contract is missing; apply 20260820180000 first';
  end if;
  if position('pos_tab_settled' in v_definition) = 0 then
    raise exception 'Atomic tab settlement is missing; apply 20260905230000 first';
  end if;
  if position('tab_version_conflict' in v_definition) = 0 then
    raise exception 'Tab version guard is missing; apply chains 20260905232000/05234000 first';
  end if;
  if position('tab_already_settled' in v_definition) = 0 then
    raise exception 'Duplicate settlement guard is missing; apply 20260905231000 first';
  end if;
  if position('pos_pool_cash_only_error' in v_definition) = 0 then
    raise exception 'Pool cash-only guard is missing; apply 20260922000001 first';
  end if;
  if position('_pos_tab_settlement_owner_error' in v_definition) = 0 then
    raise exception 'Tab settlement ownership helper call is missing; apply 20260905233000 first';
  end if;
end
$pre$;

-- ── 1. Bounded historical replay admissions (R4) ────────────────────────────
-- Armed by replay_pos_order_v3_historical_v1 after full validation, consumed
-- by create_pos_order_v3 inside the same transaction that records the order.
create table if not exists public.pos_historical_replay_admissions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  outlet_id uuid references public.outlets(id) on delete set null,
  shift_id uuid not null references public.pos_shifts(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  actor_id uuid references public.users(id) on delete set null,
  operator_id uuid references public.users(id) on delete set null,
  device_id text,
  client_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_order_id uuid references public.pos_orders(id) on delete set null,
  constraint pos_historical_replay_admissions_key_uidx
    unique (lodge_id, idempotency_key)
);

create index if not exists pos_historical_replay_admissions_shift_idx
  on public.pos_historical_replay_admissions (lodge_id, shift_id, consumed_at);

alter table public.pos_historical_replay_admissions enable row level security;
revoke all on public.pos_historical_replay_admissions from public, anon, authenticated;
grant select on public.pos_historical_replay_admissions to service_role;

comment on table public.pos_historical_replay_admissions is
  'Server-armed, bounded, audited admissions for recording never-synced Bar offline sales against an already-closed Till shift. Consumed exactly once inside the recording transaction; expiring, unconsumed rows are reusable retries only for the identical payload hash.';

-- ── 2. Historical ownership helper (R3/R4) ──────────────────────────────────
-- Mirrors _pos_tab_settlement_owner_error, but validates against the admitted
-- historical shift binding recorded at arm time instead of requiring an
-- active payment shift (the originating shift is closed by definition).
create or replace function public._pos_tab_settlement_owner_error_historical(
  p_admission_id uuid,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $owner$
declare
  v_tab_id uuid := nullif(p_payload->>'tab_id', '')::uuid;
  v_lodge uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_outlet uuid := nullif(p_payload->>'outlet_id', '')::uuid;
  v_payment_shift uuid := nullif(p_payload->>'shift_id', '')::uuid;
  v_admission public.pos_historical_replay_admissions%rowtype;
  v_tab public.pos_tabs%rowtype;
begin
  if v_tab_id is null then
    return null;
  end if;
  if p_admission_id is null then
    return 'The historical sale admission is missing. Manager review is required before this sale can be recorded.';
  end if;

  select * into v_admission
    from public.pos_historical_replay_admissions
   where id = p_admission_id
     and consumed_at is null
     and expires_at > now()
   for update;
  if not found then
    return 'The historical sale admission is missing, already used or expired. Manager review is required before this sale can be recorded.';
  end if;
  if v_admission.lodge_id is distinct from v_lodge
     or v_admission.shift_id is distinct from v_payment_shift then
    return 'The historical sale admission does not match this shift. Manager review is required before this sale can be recorded.';
  end if;

  select * into v_tab
    from public.pos_tabs
   where id = v_tab_id and lodge_id = v_lodge
   for update;
  if not found then
    return 'The selected open tab is missing or belongs to another lodge.';
  end if;
  if not public._pos_tab_is_bar_scope(v_tab.lodge_id) then
    return null;
  end if;

  -- Ownership evidence is the operator/actor binding the server recorded
  -- when it armed the admission from the closed shift (R4): rotating Till
  -- proofs from the original shift can no longer be re-validated.
  if v_tab.waiter_id is null
     or (v_tab.waiter_id is distinct from v_admission.operator_id
         and v_tab.waiter_id is distinct from v_admission.actor_id) then
    return 'Only the assigned waiter can settle this tab. Ask that waiter to transfer it first.';
  end if;
  if v_tab.outlet_id is distinct from v_outlet then
    return 'The selected tab belongs to another outlet. Refresh open tabs before settling it.';
  end if;

  return null;
end;
$owner$;

revoke all on function public._pos_tab_settlement_owner_error_historical(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public._pos_tab_settlement_owner_error_historical(uuid, jsonb)
  to service_role;

-- ── 3. Patch create_pos_order_v3 in place (R2: no body copy) ────────────────
do $do$
declare
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;

  -- Idempotence guard: never double-apply this patch chain.
  if position('pos_historical_replay_admissions' in v_definition) > 0 then
    raise notice 'create_pos_order_v3 already carries the historical admission patch; skipping';
  else

  -- A. Declarations: replay correlation key + admission id.
  v_old := $a1$  v_tab_owner_error text;$a1$;
  v_new := $a2$  v_tab_owner_error text;
  v_historical_replay_key text := nullif(payload->>'_historical_replay_key', '');
  v_historical_admission_id uuid;$a2$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Declaration anchor is ambiguous or missing (% occurrences)', v_occurrences;
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- B1. Strip the replay correlation key at the same pre-hash point as the
  -- rotating Till proof, so retries hash identically and the key never
  -- reaches entitlement, pricing, audit or snapshot validation.
  v_old := $b1$  payload := payload - '_operator_proof';$b1$;
  v_new := $b2$  payload := payload - '_operator_proof';
  if v_historical_replay_key is not null then
    payload := payload - '_historical_replay_key';
  end if;$b2$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Proof-strip anchor is ambiguous or missing (% occurrences)', v_occurrences;
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- B2. Resolve the armed admission (post-claim, pre-tab). A committed sale
  -- never reaches this point; it already returned its receipt above.
  v_old := $b3$  -- Tab lock, status/version validation, and ownership run AFTER$b3$;
  v_new := $b4$  if v_historical_replay_key is not null then
    select a.id
      into v_historical_admission_id
      from public.pos_historical_replay_admissions a
     where a.lodge_id = v_lodge_id
       and a.idempotency_key = v_historical_replay_key
       and a.shift_id = v_shift_id
       and a.actor_id is not distinct from v_actor_id
       and a.consumed_at is null
       and a.expires_at > now()
     for update;
    if v_historical_admission_id is null then
      return jsonb_build_object(
        'success', false,
        'error', 'The historical sale admission is missing, already used or expired. Manager review is required before this sale can be recorded.',
        'code', 'historical_admission_missing',
        'manual_review_required', true
      );
    end if;
  end if;

  -- Tab lock, status/version validation, and ownership run AFTER$b4$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Tab preamble anchor is ambiguous or missing (% occurrences)', v_occurrences;
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- C. Ownership decision: historical admissions validate against the
  -- recorded closed-shift binding; everything else keeps the live rule.
  v_old := $c1$    v_tab_owner_error := public._pos_tab_settlement_owner_error(payload || jsonb_build_object('_operator_proof', v_tab_operator_proof));$c1$;
  v_new := $c2$    v_tab_owner_error := case
      when v_historical_admission_id is not null
        then public._pos_tab_settlement_owner_error_historical(v_historical_admission_id, payload || jsonb_build_object('_operator_proof', v_tab_operator_proof))
      else public._pos_tab_settlement_owner_error(payload || jsonb_build_object('_operator_proof', v_tab_operator_proof))
    end;$c2$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Ownership call anchor is ambiguous or missing (% occurrences)', v_occurrences;
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- D. Shift resolution: a closed shift is accepted only when this exact
  -- order carries a matching, armed, unconsumed admission.
  v_old := $d1$  if not found or lower(v_shift.status) <> 'open' then
    return jsonb_build_object(
      'success', false,
      'error', 'A valid open shift is required',
      'code', 'shift_not_open'
    );
  end if;$d1$;
  v_new := $d2$  if not found or lower(v_shift.status) <> 'open' then
    -- Historical admission (R3/R4): a committed sale never reaches this
    -- branch because the idempotency claim above already returned its
    -- stored receipt. A never-recorded offline sale is admitted only when
    -- the wrapper armed a bounded, audited admission for this exact
    -- originating shift, actor and payload hash; otherwise fail closed.
    if v_historical_admission_id is null
       or not found
       or (select a.shift_id
             from public.pos_historical_replay_admissions a
            where a.id = v_historical_admission_id
              and a.consumed_at is null
              and a.expires_at > now()) is distinct from v_shift_id then
      return jsonb_build_object(
        'success', false,
        'error', 'A valid open shift is required',
        'code', 'shift_not_open'
      );
    end if;
  end if;$d2$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Shift guard anchor is ambiguous or missing (% occurrences)', v_occurrences;
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- E. Record, then consume the admission, write the historical marker audit
  -- and open a structured cash-up reconciliation event (R6) in one atomic
  -- transaction with the order itself.
  v_old := $e1$  perform public._record_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3',
    v_order_id, v_request_hash, v_result
  );

  return v_result;$e1$;
  v_new := $e2$  perform public._record_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3',
    v_order_id, v_request_hash, v_result
  );

  if v_historical_admission_id is not null then
    update public.pos_historical_replay_admissions
       set consumed_at = now(),
           consumed_order_id = v_order_id
     where id = v_historical_admission_id
       and consumed_at is null;
    if not found then
      raise exception 'The historical sale admission was already consumed; nothing was committed.'
        using errcode = 'P0001';
    end if;

    insert into public.pos_audit_log (
      lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
      device_id, action, entity_type, entity_id, staff_id, amount_delta,
      idempotency_key, client_at, after_snapshot, details
    ) values (
      v_lodge_id, v_outlet_id, v_shift_id, v_order_id, v_actor_id, v_operator_id,
      v_device_id, 'pos_order_historical_replay', 'pos_order', v_order_id, v_operator_id,
      v_total, v_idempotency_key, v_client_at,
      jsonb_build_object('total', v_total, 'shift_id', v_shift_id, 'client_created_at', v_client_at),
      jsonb_build_object(
        'historical_replay', true,
        'shift_status', v_shift.status,
        'recorded_at', now(),
        'source_device_id', v_device_id,
        'admission_id', v_historical_admission_id
      )
    );

    insert into public.pos_cashup_reconciliation_events (
      lodge_id, outlet_id, shift_id, submission_id, order_id, operation_key,
      kind, status, original_snapshot, created_at
    )
    select v_lodge_id, v_outlet_id, v_shift_id, sub.id, v_order_id,
           'late-order:' || v_idempotency_key,
           'late_order', 'pending_review',
           jsonb_build_object(
             'submission_status', sub.status,
             'submitted_at', sub.submitted_at,
             'reviewed_at', sub.reviewed_at,
             'expected_cash_drawer', sub.expected_cash_drawer,
             'expected_by_method', sub.expected_by_method,
             'counted_by_method', sub.counted_by_method,
             'review_notes', sub.review_notes
           ),
           now()
      from public.pos_cashup_submissions sub
     where sub.lodge_id = v_lodge_id
       and sub.shift_id = v_shift_id
       and sub.status in ('submitted', 'approved')
    on conflict (lodge_id, operation_key) do nothing;
  end if;

  return v_result;$e2$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Record/return anchor is ambiguous or missing (% occurrences)', v_occurrences;
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  if position('v_historical_admission_id' in v_definition) = 0
     or position('_pos_tab_settlement_owner_error_historical' in v_definition) = 0 then
    raise exception 'Historical admission patch did not install';
  end if;
  execute v_definition;

  end if;
end
$do$;

-- ── 4. Historical replay entry point (client: syncShared.POS_HISTORICAL_REPLAY_RPC) ─
-- A structured refusal for a null probe payload proves deployment without
-- recording anything; the client probes with {payload:null,p_replay_key:null}.
create or replace function public.replay_pos_order_v3_historical_v1(payload jsonb, p_replay_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $hist$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'id', '')::uuid;
  v_idempotency_key text := nullif(btrim(coalesce(payload->>'create_idempotency_key', '')), '');
  v_replay_key text := nullif(btrim(coalesce(p_replay_key, '')), '');
  v_client_at timestamptz := nullif(payload->>'client_created_at', '')::timestamptz;
  v_device_id text := nullif(btrim(coalesce(payload->>'source_device_id', '')), '');
  v_actor_id uuid := public.app_current_user_id();
  v_request_hash text;
  v_claim jsonb;
  v_shift public.pos_shifts%rowtype;
  v_admission_id uuid;
  v_admission_created boolean := false;
  v_expires_at timestamptz;
  v_offline_hours integer;
  v_result jsonb;
begin
  -- Capability probe contract: structured refusal, never a SQL error.
  if payload is null or jsonb_typeof(payload) <> 'object'
     or v_idempotency_key is null or v_replay_key is null or v_lodge_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'replay_key_required',
      'error', 'A sale payload and its original operation key are required.'
    );
  end if;
  if v_replay_key <> 'hist-replay:' || v_idempotency_key then
    return jsonb_build_object(
      'success', false,
      'code', 'replay_key_mismatch',
      'error', 'The historical replay key does not match the original sale operation.'
    );
  end if;
  if v_order_id is null or v_shift_id is null or v_client_at is null then
    return jsonb_build_object(
      'success', false,
      'code', 'historical_evidence_incomplete',
      'error', 'The queued sale is missing its order id, shift or client timestamp. Manager review is required.',
      'manual_review_required', true
    );
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );
  if v_outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
  end if;

  -- R3 receipt-first: exact committed replays return their stored receipt
  -- before any mutable state is read. Hash contract matches the live
  -- function exactly (rotating proof and replay key stripped).
  v_request_hash := encode(sha256(convert_to((payload - '_operator_proof' - '_historical_replay_key')::text, 'UTF8')), 'hex');
  v_claim := public._claim_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3', v_order_id, v_request_hash
  );
  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('replayed', true);
  end if;
  if coalesce(v_claim->>'success', 'true') <> 'true' then
    return jsonb_build_object(
      'success', false,
      'error', coalesce(v_claim->>'error', 'Idempotency conflict'),
      'code', 'idempotency_conflict'
    );
  end if;

  select s.*
    into v_shift
    from public.pos_shifts s
   where s.id = v_shift_id
     and s.lodge_id = v_lodge_id
   for update;
  if not found then
    return jsonb_build_object(
      'success', false,
      'code', 'historical_shift_unresolved',
      'error', 'The originating shift was not found on the server. Manager review is required.',
      'manual_review_required', true
    );
  end if;

  -- R5: local-open/server-open (or a stale local cache claiming closed)
  -- replays through the normal authoritative path, which re-validates
  -- everything including the live shift.
  if lower(v_shift.status) = 'open' then
    v_result := public.create_pos_order_v3(payload);
    return v_result;
  end if;

  -- R4 product/mode scope: historical admission is a Bar-only capability.
  if not public._pos_tab_is_bar_scope(v_lodge_id) then
    return jsonb_build_object(
      'success', false,
      'code', 'historical_replay_out_of_scope',
      'error', 'Historical sale replay is only available for Bar-only deployments.',
      'manual_review_required', true
    );
  end if;
  if v_outlet_id is not null and v_shift.outlet_id is distinct from v_outlet_id then
    return jsonb_build_object(
      'success', false,
      'code', 'historical_shift_unresolved',
      'error', 'The originating shift belongs to another outlet. Manager review is required.',
      'manual_review_required', true
    );
  end if;

  -- R4 shift evidence: recorded, sane open/close times; client time inside
  -- the shift window; never in the future; inside the lodge's configured
  -- offline trading window (87600h for Bar-only).
  if v_shift.opened_at is null or v_shift.closed_at is null then
    return jsonb_build_object(
      'success', false,
      'code', 'historical_shift_unresolved',
      'error', 'The originating shift has no recorded open/close times. Manager review is required.',
      'manual_review_required', true
    );
  end if;
  if v_shift.closed_at < v_shift.opened_at then
    return jsonb_build_object(
      'success', false,
      'code', 'historical_shift_unresolved',
      'error', 'The originating shift has an invalid close time. Manager review is required.',
      'manual_review_required', true
    );
  end if;
  if v_client_at > now() + interval '5 minutes' then
    return jsonb_build_object(
      'success', false,
      'code', 'historical_time_mismatch',
      'error', 'The sale timestamp is in the future. Manager review is required.',
      'manual_review_required', true
    );
  end if;
  if v_client_at < v_shift.opened_at - interval '5 minutes'
     or v_client_at > v_shift.closed_at + interval '5 minutes' then
    return jsonb_build_object(
      'success', false,
      'code', 'historical_time_mismatch',
      'error', 'The sale time falls outside the originating shift window. Manager review is required before this sale can be recorded.',
      'manual_review_required', true
    );
  end if;
  select coalesce(s.pos_offline_trading_hours, 72)
    into v_offline_hours
    from public.settings s
   where s.lodge_id = v_lodge_id
   limit 1;
  if now() - v_client_at > make_interval(hours => greatest(1, v_offline_hours)) then
    return jsonb_build_object(
      'success', false,
      'code', 'historical_window_expired',
      'error', 'The originating shift is older than this lodge''s offline trading window. Manager review is required.',
      'manual_review_required', true
    );
  end if;

  -- Arm (or reuse) the bounded admission. Same key + same shift + same
  -- payload hash + same actor may retry for 24h; anything else fails closed.
  v_expires_at := now() + interval '24 hours';
  insert into public.pos_historical_replay_admissions (
    lodge_id, outlet_id, shift_id, idempotency_key, request_hash,
    actor_id, operator_id, device_id, client_at, expires_at
  ) values (
    v_lodge_id, v_shift.outlet_id, v_shift_id, v_replay_key, v_request_hash,
    v_actor_id, coalesce(v_shift.cashier_id, v_actor_id), v_device_id, v_client_at, v_expires_at
  )
  on conflict (lodge_id, idempotency_key) do update
     set expires_at = greatest(public.pos_historical_replay_admissions.expires_at, excluded.expires_at)
   where public.pos_historical_replay_admissions.consumed_at is null
     and public.pos_historical_replay_admissions.request_hash = excluded.request_hash
     and public.pos_historical_replay_admissions.shift_id = excluded.shift_id
     and public.pos_historical_replay_admissions.actor_id is not distinct from excluded.actor_id
  returning id, (xmax = 0) into v_admission_id, v_admission_created;
  if v_admission_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'idempotency_conflict',
      'error', 'This historical replay key was already used for a different operation'
    );
  end if;

  if v_admission_created then
    insert into public.pos_audit_log (
      lodge_id, outlet_id, shift_id, actor_id, operator_id, device_id,
      action, entity_type, entity_id, staff_id, amount_delta,
      idempotency_key, client_at, after_snapshot, details
    ) values (
      v_lodge_id, v_shift.outlet_id, v_shift_id, v_actor_id,
      coalesce(v_shift.cashier_id, v_actor_id), v_device_id,
      'pos_order_historical_replay_admission', 'pos_historical_replay_admission', v_admission_id,
      coalesce(v_shift.cashier_id, v_actor_id), 0, v_replay_key, v_client_at,
      jsonb_build_object(
        'admission_id', v_admission_id,
        'shift_id', v_shift_id,
        'client_at', v_client_at,
        'expires_at', v_expires_at
      ),
      jsonb_build_object(
        'shift_status', v_shift.status,
        'shift_opened_at', v_shift.opened_at,
        'shift_closed_at', v_shift.closed_at,
        'device_id', v_device_id,
        'request_hash', v_request_hash
      )
    );
  end if;

  v_result := public.create_pos_order_v3(
    payload || jsonb_build_object('_historical_replay_key', v_replay_key)
  );
  return v_result;
end;
$hist$;

revoke all on function public.replay_pos_order_v3_historical_v1(jsonb, text) from public;
grant execute on function public.replay_pos_order_v3_historical_v1(jsonb, text)
  to anon, authenticated, service_role;

comment on function public.replay_pos_order_v3_historical_v1(jsonb, text) is
  'Reviewed historical Bar sale replay: authoritative original-key receipt reconciliation first, then bounded server-side admission of never-recorded closed-shift sales into the originating shift, with consume-once admission, historical audit marker and structured cash-up reconciliation event.';

commit;
