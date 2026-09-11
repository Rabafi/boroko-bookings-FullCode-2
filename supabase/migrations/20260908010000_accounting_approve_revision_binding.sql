-- Accounting approval binds the full reviewed revision atomically (G1).
--
-- LOCAL AUTHORING ONLY — NOT APPLIED. Deployment requires the exact-target
-- approval in docs/ACCOUNTING_SQL_ACCEPTANCE.md. This file never touches
-- already-deployed history beyond replacing the approval overload it
-- supersedes; every statement is additive and idempotent, and no grant is
-- widened (the no-ship grant lockdown stays in force until real-role SQL
-- acceptance and deployment approval).
--
-- Defect: prepare hashes lodge/date/opening_balances/operation_key, not the
-- source manifest or preparer. Re-preparation stores a new source hash and
-- preparer while a same-balances re-preparation keeps the opening hash.
-- Approval validated only the opening hash (nullable, bypassable) and
-- compared the CURRENT stored source hash against a fresh audit — so a
-- source-only change between the reviewer's preflight read and the approval
-- mutation could commit evidence never reviewed. A post-commit UI notice is
-- not prevention.
--
-- Fix: approval now requires the reviewed source identity and the reviewed
-- preparation identity and validates both under the batch row lock, in
-- addition to the mandatory opening hash. Null-safe comparison is used
-- throughout: a reviewed-absent source (real batches carry no source
-- manifest when no pre-cutover history exists) matches only a stored
-- absent source, and a null stored opening hash can never equal a nonempty
-- reviewed hash (plain SQL <> with a null side does not reject).
--
-- Contract change (single strong overload): the previous 4-argument
-- overload is dropped so no weaker entry point remains executable. The new
-- 6-argument form keeps the reviewed opening hash mandatory (22023 on
-- null/blank), adds p_expected_source_manifest_hash (null = reviewed
-- absent) and p_expected_prepared_by, and rejects any mismatch with 23505
-- before the existing audit gates run. All prior mutation-time validation
-- (prepared status, preparer≠approver, balance shape, audit completeness,
-- source-vs-audit drift) is preserved unchanged under the same FOR UPDATE
-- lock. The response additionally returns the committed opening hash so
-- callers can verify what was approved without a second read.

begin;

-- Remove the weaker overload first so it can never be called after this
-- migration, on fresh or already-migrated targets alike.
drop function if exists public.approve_restaurant_historical_cutover(uuid, uuid, text, text);

create or replace function public.approve_restaurant_historical_cutover(
  p_lodge_id uuid,
  p_batch_id uuid,
  p_review_notes text,
  p_expected_opening_payload_hash text,
  p_expected_source_manifest_hash text,
  p_expected_prepared_by uuid
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
  -- Null-safe revision binding: every reviewed identity must equal the
  -- locked row. IS DISTINCT FROM rejects on any difference including
  -- null-vs-value in either direction.
  v_opening_hash := v_batch.control_totals->>'opening_payload_hash';
  if p_expected_opening_payload_hash is distinct from v_opening_hash then
    raise exception 'Opening-balance payload hash does not match the prepared batch' using errcode = '23505';
  end if;
  if p_expected_source_manifest_hash is distinct from v_batch.source_manifest_hash then
    raise exception 'Source-manifest evidence does not match the reviewed batch; reload and review the current evidence' using errcode = '23505';
  end if;
  if p_expected_prepared_by is distinct from v_batch.prepared_by then
    raise exception 'Preparation identity does not match the reviewed batch; reload and review the current evidence' using errcode = '23505';
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
    'opening_payload_hash', v_opening_hash,
    'reviewed_by', v_actor
  ));
end
$$;

-- Least-privilege surface for the single strong overload: the authenticated
-- app role (capability enforced inside the function) plus service_role
-- (previous overload's grant died with the drop and is restored here, not
-- widened). No anon/public access.
revoke all on function public.approve_restaurant_historical_cutover(uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.approve_restaurant_historical_cutover(uuid, uuid, text, text, text, uuid) to authenticated, service_role;

commit;
