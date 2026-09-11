-- Accounting cutover reads, timestamp repairs, and least-privilege client grants.
--
-- LOCAL AUTHORING ONLY — NOT APPLIED. Deployment requires the exact-target
-- approval in docs/ACCOUNTING_SQL_ACCEPTANCE.md. This file never touches
-- already-deployed history; every statement is additive and idempotent.
--
-- 1. Repairs two undefined-column failures found by inspection:
--    approve_restaurant_historical_cutover writes approved_at and
--    activate_restaurant_accounting (with a cutover batch) writes applied_at,
--    but no migration creates either column, so both raise 42703 at runtime.
-- 2. Adds tenant-scoped cutover batch list/detail reads so an independent
--    reviewer can load a prepared batch without preparing again.
--    Absent-or-foreign batches return identical null data (no oracle).
-- 3. Grants authenticated EXECUTE on the activation lifecycle surface only.
--    Every function enforces its capability internally
--    (_restaurant_require_capability) and scopes by p_lodge_id; anon/public
--    stay revoked; service_role is untouched.

begin;

alter table public.restaurant_historical_cutover_batches
  add column if not exists approved_at timestamptz,
  add column if not exists applied_at timestamptz;

create or replace function public.get_restaurant_historical_cutover_batches(
  p_lodge_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  return jsonb_build_object('success', true, 'data', coalesce((
    select jsonb_agg(row_to_json(batch) order by batch.cutover_date desc)
    from (
      select
        b.id,
        b.lodge_id,
        b.cutover_date,
        b.status,
        b.prepared_by,
        b.approved_by,
        b.control_totals->>'opening_payload_hash' as opening_payload_hash,
        b.source_manifest_hash,
        b.source_counts,
        b.evidence_manifest,
        b.created_at
      from public.restaurant_historical_cutover_batches b
      where b.lodge_id = p_lodge_id
      order by b.cutover_date desc
      limit v_limit
    ) batch
  ), '[]'::jsonb));
end
$$;

create or replace function public.get_restaurant_historical_cutover_batch(
  p_lodge_id uuid,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.restaurant_historical_cutover_batches%rowtype;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  select * into v_batch
  from public.restaurant_historical_cutover_batches
  where id = p_batch_id and lodge_id = p_lodge_id;
  if not found then
    -- Absent and foreign-tenant batches answer identically: no oracle.
    return jsonb_build_object('success', true, 'data', null);
  end if;
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'id', v_batch.id,
    'lodge_id', v_batch.lodge_id,
    'cutover_date', v_batch.cutover_date,
    'status', v_batch.status,
    'prepared_by', v_batch.prepared_by,
    'approved_by', v_batch.approved_by,
    'approved_at', v_batch.approved_at,
    'applied_at', v_batch.applied_at,
    'opening_balances', coalesce(v_batch.opening_balances, '[]'::jsonb),
    'opening_payload_hash', v_batch.control_totals->>'opening_payload_hash',
    'source_manifest_hash', v_batch.source_manifest_hash,
    'source_counts', coalesce(v_batch.source_counts, '{}'::jsonb),
    'control_totals', coalesce(v_batch.control_totals, '{}'::jsonb),
    'evidence_manifest', coalesce(v_batch.evidence_manifest, '{}'::jsonb),
    'opening_postings', coalesce(v_batch.opening_postings, '[]'::jsonb),
    'review_notes', v_batch.review_notes,
    'operation_key', v_batch.operation_key,
    'created_at', v_batch.created_at
  ));
end
$$;

-- Complete stored activation tuple for exact-match read-back after an
-- uncertain activation response. Read-only; absent rows return null data
-- (informative inactive state, not an error).
create or replace function public.get_restaurant_accounting_activation_state(
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activation public.restaurant_accounting_activation%rowtype;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  select * into v_activation
  from public.restaurant_accounting_activation
  where lodge_id = p_lodge_id;
  if not found then
    return jsonb_build_object('success', true, 'data', null);
  end if;
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'lodge_id', v_activation.lodge_id,
    'status', v_activation.status,
    'active', v_activation.status in ('active', 'cutover_complete')
      and v_activation.effective_from is not null
      and v_activation.effective_from <= public.get_lodge_business_date(p_lodge_id),
    'effective_from', v_activation.effective_from,
    'policy_version', v_activation.policy_version,
    'configuration_version', v_activation.configuration_version,
    'historical_cutover_batch_id', v_activation.historical_cutover_batch_id,
    'activated_at', v_activation.activated_at,
    'updated_at', v_activation.updated_at
  ));
end
$$;

-- Least-privilege client surface: revoke anon/public (idempotent), grant the
-- authenticated app role. Authorization stays inside each function via
-- _restaurant_require_capability; service_role grants are untouched.
revoke all on function public.get_restaurant_accounting_readiness(uuid) from anon, public;
grant execute on function public.get_restaurant_accounting_readiness(uuid) to authenticated;

revoke all on function public.get_restaurant_accounting_activation_state(uuid) from anon, public;
grant execute on function public.get_restaurant_accounting_activation_state(uuid) to authenticated;

revoke all on function public.get_restaurant_historical_cutover_batches(uuid, integer) from anon, public;
grant execute on function public.get_restaurant_historical_cutover_batches(uuid, integer) to authenticated;

revoke all on function public.get_restaurant_historical_cutover_batch(uuid, uuid) from anon, public;
grant execute on function public.get_restaurant_historical_cutover_batch(uuid, uuid) to authenticated;

revoke all on function public.prepare_restaurant_historical_cutover(uuid, date, jsonb, jsonb, text) from anon, public;
grant execute on function public.prepare_restaurant_historical_cutover(uuid, date, jsonb, jsonb, text) to authenticated;

revoke all on function public.approve_restaurant_historical_cutover(uuid, uuid, text, text) from anon, public;
grant execute on function public.approve_restaurant_historical_cutover(uuid, uuid, text, text) to authenticated;

revoke all on function public.apply_restaurant_historical_cutover(uuid, uuid) from anon, public;
grant execute on function public.apply_restaurant_historical_cutover(uuid, uuid) to authenticated;

revoke all on function public.activate_restaurant_accounting(uuid, date, text, text, uuid) from anon, public;
grant execute on function public.activate_restaurant_accounting(uuid, date, text, text, uuid) to authenticated;

revoke all on function public.suspend_restaurant_accounting(uuid, text) from anon, public;
grant execute on function public.suspend_restaurant_accounting(uuid, text) to authenticated;

commit;
