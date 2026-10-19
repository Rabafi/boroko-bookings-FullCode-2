-- ACC-05: atomically create and submit manual journals using a serialized operation UUID.
-- Existing draft, submit, independent approval, posting, and legacy retry RPCs remain available.
begin;

create or replace function public.create_and_submit_restaurant_manual_journal_v2(
  p_lodge_id uuid,
  p_entry_date date,
  p_description text,
  p_reference_number text,
  p_lines jsonb,
  p_evidence_ref text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_create_result jsonb;
  v_submit_result jsonb;
  v_row public.restaurant_manual_journal_drafts%rowtype;
  v_replayed boolean;
  v_payload_hash text;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if p_lodge_id is null or p_operation_id is null then
    raise exception 'Lodge and UUID operation key are required' using errcode = '22023';
  end if;

  -- Serialize the absent-row and existing-row cases. The unique constraint remains
  -- the final integrity guard; this lock ensures concurrent retries share one path.
  perform pg_advisory_xact_lock(hashtextextended(p_lodge_id::text || ':' || p_operation_id::text, 0));
  v_payload_hash := encode(digest(jsonb_build_object(
    'lodge_id', p_lodge_id, 'entry_date', p_entry_date, 'description', btrim(p_description),
    'reference_number', nullif(btrim(p_reference_number), ''), 'lines', p_lines,
    'evidence_ref', btrim(p_evidence_ref), 'operation_id', p_operation_id
  )::text, 'sha256'), 'hex');

  -- The original RPC performs the canonical payload hash, active-account ownership,
  -- evidence, balance, date and user checks. Any later denial rolls its insert back.
  v_create_result := public.create_restaurant_manual_journal_draft(
    p_lodge_id, p_entry_date, p_description, p_reference_number, p_lines, p_evidence_ref, p_operation_id
  );
  select * into v_row
    from public.restaurant_manual_journal_drafts
   where lodge_id = p_lodge_id and operation_id = p_operation_id
   for update;
  if not found then
    raise exception 'Manual journal operation did not produce a recoverable draft' using errcode = 'P0002';
  end if;
  if v_row.created_by is distinct from v_actor then
    raise exception 'Manual journal operation belongs to another actor' using errcode = '42501';
  end if;
  if v_row.payload_hash is distinct from v_payload_hash then
    raise exception 'Manual journal operation key conflicts with its original payload' using errcode = '23505';
  end if;
  v_replayed := coalesce((v_create_result->'data'->>'replayed')::boolean, false);

  if v_row.status = 'draft' then
    if public.restaurant_accounting_period_is_closed(p_lodge_id, v_row.entry_date) then
      raise exception 'Accounting period is closed; use the governed reopen workflow before submitting this journal' using errcode = '55000';
    end if;
    v_submit_result := public.submit_restaurant_manual_journal(p_lodge_id, v_row.id);
    v_row.status := coalesce(v_submit_result->'data'->>'status', 'submitted');
  elsif v_row.status not in ('submitted', 'approved', 'posted') then
    -- In particular, do not reopen a rejected journal under its old operation key.
    raise exception 'Manual journal operation is terminal with status % and cannot be resubmitted', v_row.status using errcode = '55000';
  end if;

  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'operation_id', p_operation_id,
    'replayed', v_replayed
  ));
end
$$;

create or replace function public.get_restaurant_manual_journal_submission_status_v2(
  p_lodge_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_row public.restaurant_manual_journal_drafts%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if p_lodge_id is null or p_operation_id is null then
    raise exception 'Lodge and UUID operation key are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_lodge_id::text || ':' || p_operation_id::text, 0));

  select * into v_row
    from public.restaurant_manual_journal_drafts
   where lodge_id = p_lodge_id and operation_id = p_operation_id;
  if not found or v_row.created_by is distinct from v_actor then
    return jsonb_build_object('success', true, 'data', jsonb_build_object('found', false, 'operation_id', p_operation_id));
  end if;
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'found', true,
    'id', v_row.id,
    'status', v_row.status,
    'operation_id', v_row.operation_id
  ));
end
$$;

revoke all on function public.create_and_submit_restaurant_manual_journal_v2(uuid,date,text,text,jsonb,text,uuid), public.get_restaurant_manual_journal_submission_status_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_and_submit_restaurant_manual_journal_v2(uuid,date,text,text,jsonb,text,uuid), public.get_restaurant_manual_journal_submission_status_v2(uuid,uuid) to authenticated,service_role;

commit;