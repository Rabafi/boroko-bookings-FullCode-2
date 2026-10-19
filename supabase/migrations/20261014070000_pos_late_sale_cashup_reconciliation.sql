-- 20261014070000_pos_late_sale_cashup_reconciliation.sql
--
-- R6 (Codex review, CHANGES REQUIRED): a late Bar sale recorded after the
-- cashier's physical count was submitted must not silently invalidate the
-- cash-up certification. The previous draft only prepended free-text to
-- review_notes ("note-only"); there was no structured review state, no
-- atomically enforced gate, and no idempotent resolution path.
--
-- This migration adds:
--   1. pos_cashup_reconciliation_events — structured, auditable late-sale
--      events that preserve the original submitted counts/variance snapshot
--      captured when the late sale was recorded.
--   2. A finalisation gate patched in place on finalize_pos_shift_cashup_v2:
--      while any event for the shift is 'pending_review', the cash-up cannot
--      be finalised (code cashup_reconciliation_required). The shift row is
--      already locked FOR UPDATE there, so a concurrent late-order recording
--      and a finalisation serialise on the same row — there is no window
--      where a stale certification commits.
--   3. resolve_pos_cashup_reconciliation_v1 — manager-PIN-authorised,
--      atomic, idempotent resolution (accepted / returned_for_correction).
--      Same resolution replays; a different resolution fails closed. Counts,
--      expected amounts and variance are never rewritten — resolution only
--      records the review decision, and the normal review/finalise path then
--      recomputes the preview from the true order set.
--   4. Manager read RPC for the event queue and reconciliation flags on the
--      existing cash-up readers so the operator sees the late sale before
--      approving.
--
-- Nothing in this file is applied anywhere until Codex review approves
-- these exact bytes.

begin;

-- ── 1. Structured late-sale reconciliation events ───────────────────────────
create table if not exists public.pos_cashup_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  outlet_id uuid references public.outlets(id) on delete set null,
  shift_id uuid not null references public.pos_shifts(id) on delete restrict,
  submission_id uuid references public.pos_cashup_submissions(id) on delete set null,
  order_id uuid references public.pos_orders(id) on delete set null,
  operation_key text not null,
  kind text not null default 'late_order'
    check (kind in ('late_order')),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'accepted', 'returned_for_correction')),
  original_snapshot jsonb not null default '{}'::jsonb,
  resolution_note text,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pos_cashup_reconciliation_events_key_uidx
    unique (lodge_id, operation_key)
);

create index if not exists pos_cashup_reconciliation_events_pending_idx
  on public.pos_cashup_reconciliation_events (lodge_id, shift_id, status, created_at desc);

alter table public.pos_cashup_reconciliation_events enable row level security;
revoke all on public.pos_cashup_reconciliation_events from public, anon, authenticated;
grant select on public.pos_cashup_reconciliation_events to service_role;

comment on table public.pos_cashup_reconciliation_events is
  'Structured R6 late-sale review events. Created atomically with the order that was recorded against a shift whose cash-up was already submitted or approved; resolved by a manager PIN decision before the shift can be certified.';

-- ── 2. Finalisation gate (patched in place; no body copy) ───────────────────
do $do$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.finalize_pos_shift_cashup_v2(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'finalize_pos_shift_cashup_v2(jsonb) is not installed';
  end if;

  if position('pos_cashup_reconciliation_events' in v_definition) > 0 then
    raise notice 'finalize_pos_shift_cashup_v2 already carries the reconciliation gate; skipping';
  else
    v_old := $old$  if coalesce(v_claim->>'success', 'true') <> 'true' then
    return jsonb_build_object(
      'success', false,
      'error', coalesce(v_claim->>'error', 'Idempotency conflict'),
      'code', 'idempotency_conflict'
    );
  end if;

  select s.* into v_shift$old$;
    v_new := $new$  if coalesce(v_claim->>'success', 'true') <> 'true' then
    return jsonb_build_object(
      'success', false,
      'error', coalesce(v_claim->>'error', 'Idempotency conflict'),
      'code', 'idempotency_conflict'
    );
  end if;

  -- R6: a late sale recorded after the count was submitted must be reviewed
  -- before the shift can be certified. The claim lookup above already
  -- returned stored receipts for exact replays, so retries stay idempotent.
  if exists (
    select 1
      from public.pos_cashup_reconciliation_events e
     where e.lodge_id = v_lodge_id
       and e.shift_id = v_shift_id
       and e.status = 'pending_review'
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'Late Bar sales were recorded against this shift after cash-up. Reconcile them before finalising.',
      'code', 'cashup_reconciliation_required',
      'manual_review_required', true
    );
  end if;

  select s.* into v_shift$new$;
    v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
    if v_occurrences <> 1 then
      raise exception 'Finalise claim anchor is ambiguous or missing (% occurrences)', v_occurrences;
    end if;
    v_definition := replace(v_definition, v_old, v_new);

    if position('cashup_reconciliation_required' in v_definition) = 0 then
      raise exception 'Reconciliation gate did not install';
    end if;
    execute v_definition;
  end if;
end
$do$;

-- ── 3. Manager resolution (atomic, idempotent, PIN-authorised) ──────────────
create or replace function public.resolve_pos_cashup_reconciliation_v1(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $resolve$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_event_id uuid := nullif(payload->>'event_id', '')::uuid;
  v_resolution text := lower(nullif(btrim(coalesce(payload->>'resolution', '')), ''));
  v_note text := nullif(btrim(coalesce(payload->>'note', '')), '');
  v_pin text := payload->>'manager_pin';
  v_actor uuid := public.app_current_user_id();
  v_row public.pos_cashup_reconciliation_events%rowtype;
begin
  if v_lodge_id is null or v_event_id is null
     or v_resolution not in ('accepted', 'returned_for_correction') then
    return jsonb_build_object(
      'success', false,
      'error', 'lodge_id, event_id and a valid resolution (accepted or returned_for_correction) are required'
    );
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin']);
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your manager session could not be confirmed. Sign in again.');
  end if;
  if not public._restaurant_validate_manager_cashup_pin(
    v_lodge_id, v_actor, v_pin, coalesce(payload->>'device_id', 'shared-terminal')
  ) then
    return jsonb_build_object('success', false, 'error', 'Incorrect manager PIN.');
  end if;

  select * into v_row
    from public.pos_cashup_reconciliation_events
   where id = v_event_id and lodge_id = v_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Reconciliation event not found.');
  end if;
  if v_row.status <> 'pending_review' then
    if v_row.status = v_resolution then
      return jsonb_build_object(
        'success', true, 'event_id', v_row.id, 'status', v_row.status,
        'order_id', v_row.order_id, 'replayed', true
      );
    end if;
    return jsonb_build_object(
      'success', false,
      'error', 'This late-sale event was already resolved as ' || v_row.status || '.',
      'code', 'reconciliation_already_resolved'
    );
  end if;
  if v_resolution = 'returned_for_correction' and v_note is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Enter a note explaining what the operator must correct.'
    );
  end if;

  update public.pos_cashup_reconciliation_events
     set status = v_resolution,
         resolution_note = v_note,
         resolved_by = v_actor,
         resolved_at = now()
   where id = v_row.id;

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, actor_id, operator_id, action,
    entity_type, entity_id, staff_id, amount_delta, idempotency_key,
    after_snapshot, details
  ) values (
    v_lodge_id, v_row.outlet_id, v_row.shift_id, v_actor, v_actor,
    'cashup_late_sale_reconciled', 'pos_cashup_reconciliation_event', v_row.id,
    v_actor, 0, 'cashup-reconcile:' || v_row.id::text,
    jsonb_build_object('status', v_resolution),
    jsonb_build_object(
      'note', v_note,
      'order_id', v_row.order_id,
      'submission_id', v_row.submission_id,
      'manager_pin_verified', true,
      'previous_status', v_row.status
    )
  );

  return jsonb_build_object(
    'success', true,
    'event_id', v_row.id,
    'status', v_resolution,
    'order_id', v_row.order_id
  );
end;
$resolve$;

revoke all on function public.resolve_pos_cashup_reconciliation_v1(jsonb) from public;
grant execute on function public.resolve_pos_cashup_reconciliation_v1(jsonb)
  to authenticated, service_role;

comment on function public.resolve_pos_cashup_reconciliation_v1(jsonb) is
  'Manager-PIN-authorised, atomic, idempotent resolution of a structured late-sale reconciliation event (R6). Never rewrites submitted counts or variance; the normal finalisation recomputes from the true order set afterwards.';

-- ── 4. Manager read: event queue for a lodge/shift ──────────────────────────
create or replace function public.get_pos_cashup_reconciliation_events(
  p_lodge_id uuid,
  p_shift_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $reader$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin']);
  return jsonb_build_object(
    'success', true,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'shift_id', e.shift_id,
        'outlet_id', e.outlet_id,
        'submission_id', e.submission_id,
        'order_id', e.order_id,
        'kind', e.kind,
        'status', e.status,
        'original_snapshot', e.original_snapshot,
        'resolution_note', e.resolution_note,
        'resolved_by', e.resolved_by,
        'resolved_at', e.resolved_at,
        'created_at', e.created_at,
        'order_total', (select o.total from public.pos_orders o where o.id = e.order_id),
        'receipt_number', (select o.receipt_number from public.pos_orders o where o.id = e.order_id),
        'cashier_name', (select sh.cashier_name from public.pos_shifts sh where sh.id = e.shift_id)
      ) order by e.created_at desc)
      from public.pos_cashup_reconciliation_events e
     where e.lodge_id = p_lodge_id
       and (p_shift_id is null or e.shift_id = p_shift_id)
    ), '[]'::jsonb)
  );
end;
$reader$;

revoke all on function public.get_pos_cashup_reconciliation_events(uuid, uuid) from public;
grant execute on function public.get_pos_cashup_reconciliation_events(uuid, uuid)
  to authenticated, service_role;

-- ── 5. Surface reconciliation state on existing cash-up readers ─────────────
create or replace function public.get_my_pos_cashup_submission(p_lodge_id uuid, p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid := public.app_current_user_id(); v_shift public.pos_shifts%rowtype; v_row public.pos_cashup_submissions%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  select * into v_shift from public.pos_shifts where id = p_shift_id and lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Shift not found'); end if;
  if v_shift.cashier_id is distinct from v_actor then return jsonb_build_object('success', false, 'error', 'You can only view your own cash-up submission.'); end if;
  select * into v_row from public.pos_cashup_submissions where lodge_id = p_lodge_id and shift_id = p_shift_id;
  if not found then return jsonb_build_object('success', true, 'submission', null); end if;
  return jsonb_build_object('success', true, 'submission', jsonb_build_object(
    'id',v_row.id,'status',v_row.status,'counted_by_method',v_row.counted_by_method,
    'expected_cash_drawer',v_row.expected_cash_drawer,'submitted_at',v_row.submitted_at,
    'notes',v_row.notes,'review_notes',v_row.review_notes,
    'reconciliation_required', exists(
      select 1 from public.pos_cashup_reconciliation_events e
       where e.submission_id = v_row.id and e.status = 'pending_review'
    )
  ));
end;
$$;

create or replace function public.get_pending_pos_cashup_submissions(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['supervisor','manager','admin','super_admin']);
  return jsonb_build_object('success', true, 'submissions', coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'shift_id', s.shift_id, 'outlet_id', s.outlet_id, 'outlet_name', o.name, 'cashier_id', s.cashier_id,
    'cashier_name', coalesce(u.name, sh.cashier_name), 'expected_cash_drawer', s.expected_cash_drawer,
    'counted_by_method', s.counted_by_method, 'expected_by_method', s.expected_by_method, 'notes', s.notes, 'submitted_at', s.submitted_at,
    'reconciliation_required', exists(
      select 1 from public.pos_cashup_reconciliation_events e
       where e.submission_id = s.id and e.status = 'pending_review'
    )
  ) order by s.submitted_at asc) from public.pos_cashup_submissions s left join public.outlets o on o.id=s.outlet_id left join public.users u on u.id=s.cashier_id left join public.pos_shifts sh on sh.id=s.shift_id where s.lodge_id=p_lodge_id and s.status='submitted'), '[]'::jsonb));
end;
$$;

commit;
