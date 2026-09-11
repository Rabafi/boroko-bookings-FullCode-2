-- Accounting approval must bind to evidence actually reviewed (F1).
--
-- LOCAL AUTHORING ONLY — NOT APPLIED. Deployment requires the exact-target
-- approval in docs/ACCOUNTING_SQL_ACCEPTANCE.md. This file never touches
-- already-deployed history; every statement is additive and idempotent, and
-- it grants nothing (the no-ship grant lockdown stays in force until
-- real-role SQL acceptance and deployment approval).
--
-- Defect: approve_restaurant_historical_cutover accepted a null
-- p_expected_opening_payload_hash, silently skipping the expected-evidence
-- check, so a reviewer could approve balances they never saw and a
-- concurrent re-preparation between the reviewer's read and the approval
-- mutation went undetected client-side.
--
-- Fix: the expected opening hash is now REQUIRED (22023 on null/blank).
-- The signature keeps its default so the change is backward compatible at
-- the call level, but a null no longer bypasses review: the single
-- application caller (approveRestaurantHistoricalCutoverV2, fed by the
-- reviewer's immutable reviewed-evidence snapshot) always sends the
-- nonempty reviewed hash. All existing mutation-time validation is
-- preserved unchanged and still runs under the batch row lock (FOR UPDATE):
-- prepared-status gate (55000), preparer≠approver (42501), expected-hash
-- equality (23505), notes requirement (22023), balance-shape checks
-- (22023/23505), and the source-manifest drift revalidation that recomputes
-- the audit under the same lock and rejects post-preparation source
-- changes (55000). Together the client snapshot, the mandatory expected
-- hash, and the under-lock revalidation close the preflight-to-mutation
-- race on both the server and the operator path.

begin;

create or replace function public.approve_restaurant_historical_cutover(
  p_lodge_id uuid,
  p_batch_id uuid,
  p_review_notes text,
  p_expected_opening_payload_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_batch public.restaurant_historical_cutover_batches%rowtype;
  v_audit jsonb;
  v_opening_hash text;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if nullif(btrim(coalesce(p_expected_opening_payload_hash, '')), '') is null then
    raise exception 'Reviewed opening-balance evidence is required: approval must name the exact hash the reviewer confirmed' using errcode = '22023';
  end if;
  select * into v_batch
  from public.restaurant_historical_cutover_batches
  where id = p_batch_id and lodge_id = p_lodge_id
  for update;
  if not found or v_batch.status <> 'prepared' then
    raise exception 'A prepared historical cutover batch is required' using errcode = '55000';
  end if;
  if v_batch.prepared_by = v_actor then
    raise exception 'The cutover preparer cannot approve the same batch' using errcode = '42501';
  end if;
  v_opening_hash := v_batch.control_totals->>'opening_payload_hash';
  if p_expected_opening_payload_hash <> v_opening_hash then
    raise exception 'Opening-balance payload hash does not match the prepared batch' using errcode = '23505';
  end if;
  if nullif(btrim(coalesce(p_review_notes, '')), '') is null then
    raise exception 'Independent cutover review notes are required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(v_batch.opening_balances, '[]'::jsonb)) as opening(
      account_id uuid, equity_account_id uuid, entry_date date, amount numeric
    )
    where opening.account_id is null or opening.equity_account_id is null
      or opening.entry_date is null or coalesce(opening.amount, 0) = 0
  ) then
    raise exception 'Opening balances require active account, equity account, date, and non-zero amount' using errcode = '22023';
  end if;
  if exists (
    select opening.account_id
    from jsonb_to_recordset(coalesce(v_batch.opening_balances, '[]'::jsonb)) as opening(
      account_id uuid, equity_account_id uuid, entry_date date, amount numeric
    )
    group by opening.account_id
    having count(*) > 1
  ) then
    raise exception 'Opening balances may contain only one deterministic posting per account in a cutover batch' using errcode = '23505';
  end if;

  v_audit := public.get_restaurant_historical_cutover_audit(p_lodge_id, v_batch.cutover_date)->'data';
  if not coalesce((v_audit->>'complete')::boolean, false) then
    raise exception 'Historical cutover audit has blockers: %', v_audit->'blocking_reasons' using errcode = '55000';
  end if;
  if v_batch.source_manifest_hash is distinct from v_audit->>'source_manifest_hash' then
    raise exception 'Historical source manifest changed after preparation; prepare a new batch' using errcode = '55000';
  end if;

  update public.restaurant_historical_cutover_batches
  set status = 'approved',
      source_counts = v_audit->'source_counts',
      control_totals = v_audit->'control_totals' || jsonb_build_object('opening_payload_hash', v_opening_hash),
      source_manifest = v_audit->'source_manifest',
      source_manifest_hash = v_audit->>'source_manifest_hash',
      review_notes = btrim(p_review_notes),
      approved_by = v_actor,
      approved_at = now()
  where id = p_batch_id and lodge_id = p_lodge_id;
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'accounting_cutover.approved', 'restaurant_historical_cutover_batches',
    p_batch_id, null, jsonb_build_object(
      'source_manifest_hash', v_audit->>'source_manifest_hash',
      'opening_payload_hash', v_opening_hash,
      'reviewed_by', v_actor
    ), null
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'id', p_batch_id, 'status', 'approved',
    'source_manifest_hash', v_audit->>'source_manifest_hash',
    'reviewed_by', v_actor
  ));
end
$$;

-- create or replace preserves existing grants; assert the lockdown posture
-- explicitly: no new grant is introduced by this repair.
revoke all on function public.approve_restaurant_historical_cutover(uuid, uuid, text, text) from public, anon;

commit;
