-- Financial-truth gap closure: complete ledger reads, manual journal lifecycle,
-- explicit tax allocations, bank evidence packets, and statement disclosure.
-- Forward-only. Operator clients receive RPC contracts, never table DML.

begin;

-- ---------------------------------------------------------------------------
-- General ledger: deterministic screen paging and a separate complete export.
-- ---------------------------------------------------------------------------

create or replace function public.get_restaurant_ledger_workspace_page_v2(
  p_lodge_id uuid,
  p_start_date date default null,
  p_end_date date default null,
  p_account_id uuid default null,
  p_before_entry_date date default null,
  p_before_created_at timestamptz default null,
  p_before_entry_id uuid default null,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_size integer := greatest(1, least(coalesce(p_page_size, 100), 500));
  v_total bigint;
  v_has_more boolean := false;
  v_entries jsonb := '[]'::jsonb;
  v_next jsonb := null;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  if p_before_entry_id is not null and (p_before_entry_date is null or p_before_created_at is null) then
    raise exception 'Ledger cursor requires entry date, created timestamp, and entry id' using errcode = '22023';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.restaurant_accounts
     where id = p_account_id and lodge_id = p_lodge_id
  ) then
    raise exception 'Ledger account belongs to another lodge or is missing' using errcode = '23503';
  end if;

  select count(*) into v_total
    from public.restaurant_journal_entries e
   where e.lodge_id = p_lodge_id
     and e.is_posted
     and (p_start_date is null or e.entry_date >= p_start_date)
     and (p_end_date is null or e.entry_date <= p_end_date)
     and (p_account_id is null or exists (
       select 1 from public.restaurant_journal_lines fl
        where fl.entry_id = e.id and fl.account_id = p_account_id
     ));

  select exists(
    select 1
      from public.restaurant_journal_entries e
     where e.lodge_id = p_lodge_id
       and e.is_posted
       and (p_start_date is null or e.entry_date >= p_start_date)
       and (p_end_date is null or e.entry_date <= p_end_date)
       and (p_account_id is null or exists (
         select 1 from public.restaurant_journal_lines fl
          where fl.entry_id = e.id and fl.account_id = p_account_id
       ))
       and (p_before_entry_id is null or (e.entry_date, e.created_at, e.id) <
         (p_before_entry_date, p_before_created_at, p_before_entry_id))
     order by e.entry_date desc, e.created_at desc, e.id desc
     offset v_size limit 1
  ) into v_has_more;

  select coalesce(jsonb_agg(to_jsonb(x) - 'sort_date' - 'sort_created_at' - 'sort_id'
                            order by x.sort_date desc, x.sort_created_at desc, x.sort_id desc), '[]'::jsonb)
    into v_entries
    from (
      select e.id, e.entry_date, e.description, e.source_type, e.source_id,
             e.reference_number, e.posting_key, e.reversal_of, e.created_at,
             e.source_version, e.source_business_date, e.outlet_id, e.operation_id,
             e.entry_date as sort_date, e.created_at as sort_created_at, e.id as sort_id,
             coalesce((select jsonb_agg(jsonb_build_object(
               'id', l.id, 'account_id', l.account_id, 'account_code', a.code,
               'account_name', a.name, 'debit', l.debit, 'credit', l.credit, 'memo', l.memo
             ) order by l.id)
             from public.restaurant_journal_lines l
             join public.restaurant_accounts a on a.id = l.account_id
             where l.entry_id = e.id), '[]'::jsonb) as lines
        from public.restaurant_journal_entries e
       where e.lodge_id = p_lodge_id
         and e.is_posted
         and (p_start_date is null or e.entry_date >= p_start_date)
         and (p_end_date is null or e.entry_date <= p_end_date)
         and (p_account_id is null or exists (
           select 1 from public.restaurant_journal_lines fl
            where fl.entry_id = e.id and fl.account_id = p_account_id
         ))
         and (p_before_entry_id is null or (e.entry_date, e.created_at, e.id) <
           (p_before_entry_date, p_before_created_at, p_before_entry_id))
       order by e.entry_date desc, e.created_at desc, e.id desc
       limit v_size
    ) x;

  if v_has_more and jsonb_array_length(v_entries) > 0 then
    v_next := jsonb_build_object(
      'entry_date', v_entries->(jsonb_array_length(v_entries) - 1)->>'entry_date',
      'created_at', v_entries->(jsonb_array_length(v_entries) - 1)->>'created_at',
      'entry_id', v_entries->(jsonb_array_length(v_entries) - 1)->>'id'
    );
  end if;

  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'entries', v_entries,
    'total_count', v_total,
    'returned_count', jsonb_array_length(v_entries),
    'page_size', v_size,
    'has_more', v_has_more,
    'next_cursor', v_next,
    'complete', not v_has_more,
    'ordering', 'entry_date desc, created_at desc, entry_id desc',
    'screen_page', true,
    'export_required_for_complete_population', true
  ));
end
$$;

create or replace function public.get_restaurant_ledger_export_v2(
  p_lodge_id uuid,
  p_start_date date default null,
  p_end_date date default null,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base jsonb;
  v_data jsonb;
  v_entries jsonb;
  v_hash text;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_base := public.get_restaurant_ledger_workspace_v2(p_lodge_id, p_start_date, p_end_date, p_account_id);
  v_data := coalesce(v_base->'data', '{}'::jsonb);
  v_entries := coalesce(v_data->'entries', '[]'::jsonb);
  v_hash := encode(digest(v_entries::text, 'sha256'), 'hex');
  return jsonb_build_object('success', true, 'data', v_data || jsonb_build_object(
    'export_version', 'restaurant-ledger-v2-complete',
    'returned_count', jsonb_array_length(v_entries),
    'complete', true,
    'data_hash', v_hash,
    'generated_at', now(),
    'filters', jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date, 'account_id', p_account_id),
    'source_watermark', jsonb_build_object(
      'max_created_at', (select max(created_at) from public.restaurant_journal_entries where lodge_id = p_lodge_id and is_posted),
      'max_entry_id', (select id from public.restaurant_journal_entries where lodge_id = p_lodge_id and is_posted order by created_at desc, id desc limit 1)
    )
  ));
end
$$;

-- ---------------------------------------------------------------------------
-- Manual journal maker-checker lifecycle.
-- ---------------------------------------------------------------------------

create table if not exists public.restaurant_manual_journal_drafts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  entry_date date not null,
  description text not null,
  reference_number text,
  source_type text not null default 'manual',
  lines jsonb not null,
  evidence_ref text not null,
  operation_id uuid not null,
  payload_hash text not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','posted','rejected')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  posted_by uuid references public.users(id),
  posted_at timestamptz,
  journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique(lodge_id, operation_id)
);
alter table public.restaurant_manual_journal_drafts enable row level security;
revoke all on table public.restaurant_manual_journal_drafts from public, anon, authenticated;
grant select on table public.restaurant_manual_journal_drafts to service_role;

create or replace function public.create_restaurant_manual_journal_draft(
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
  v_hash text;
  v_id uuid;
  v_existing public.restaurant_manual_journal_drafts%rowtype;
  v_line jsonb;
  v_debit numeric := 0;
  v_credit numeric := 0;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if p_entry_date is null or nullif(btrim(p_description), '') is null or
     nullif(btrim(p_evidence_ref), '') is null or p_operation_id is null or
     jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'Manual journal date, description, evidence, operation key, and lines are required' using errcode = '22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if coalesce((v_line->>'debit')::numeric, 0) < 0 or coalesce((v_line->>'credit')::numeric, 0) < 0 or
       not ((coalesce((v_line->>'debit')::numeric, 0) > 0 and coalesce((v_line->>'credit')::numeric, 0) = 0) or
            (coalesce((v_line->>'credit')::numeric, 0) > 0 and coalesce((v_line->>'debit')::numeric, 0) = 0)) then
      raise exception 'Each manual journal line must contain one positive debit or credit' using errcode = '22023';
    end if;
    if not exists (select 1 from public.restaurant_accounts a where a.id = (v_line->>'account_id')::uuid and a.lodge_id = p_lodge_id and a.is_active) then
      raise exception 'Manual journal account is invalid, inactive, or belongs to another lodge' using errcode = '23503';
    end if;
    v_debit := v_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_credit := v_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;
  if round(v_debit, 2) <= 0 or round(v_debit, 2) <> round(v_credit, 2) then
    raise exception 'Manual journal must balance to a non-zero amount' using errcode = '23514';
  end if;
  v_hash := encode(digest(jsonb_build_object(
    'lodge_id', p_lodge_id, 'entry_date', p_entry_date, 'description', btrim(p_description),
    'reference_number', nullif(btrim(p_reference_number), ''), 'lines', p_lines,
    'evidence_ref', btrim(p_evidence_ref), 'operation_id', p_operation_id
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.restaurant_manual_journal_drafts
   where lodge_id = p_lodge_id and operation_id = p_operation_id for update;
  if found then
    if v_existing.payload_hash <> v_hash then raise exception 'Manual journal operation key conflicts with its original payload' using errcode = '23505'; end if;
    return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'replayed', true));
  end if;
  insert into public.restaurant_manual_journal_drafts(
    lodge_id, entry_date, description, reference_number, source_type, lines,
    evidence_ref, operation_id, payload_hash, created_by
  ) values (
    p_lodge_id, p_entry_date, btrim(p_description), nullif(btrim(p_reference_number), ''), 'manual', p_lines,
    btrim(p_evidence_ref), p_operation_id, v_hash, v_actor
  ) returning id into v_id;
  perform public.log_restaurant_financial_action(p_lodge_id, 'manual_journal.drafted', 'manual_journal', v_id, null,
    jsonb_build_object('payload_hash', v_hash, 'evidence_ref', btrim(p_evidence_ref)), null);
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_id, 'status', 'draft', 'replayed', false));
end
$$;

create or replace function public.submit_restaurant_manual_journal(
  p_lodge_id uuid, p_draft_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid; v_row public.restaurant_manual_journal_drafts%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select * into v_row from public.restaurant_manual_journal_drafts where id = p_draft_id and lodge_id = p_lodge_id for update;
  if not found or v_row.status <> 'draft' then raise exception 'Manual journal draft is not available for submission' using errcode = '55000'; end if;
  update public.restaurant_manual_journal_drafts set status = 'submitted', submitted_at = now(), updated_at = now() where id = p_draft_id;
  perform public.log_restaurant_financial_action(p_lodge_id, 'manual_journal.submitted', 'manual_journal', p_draft_id, null, jsonb_build_object('actor_id', v_actor), null);
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_draft_id, 'status', 'submitted'));
end
$$;

create or replace function public.approve_restaurant_manual_journal(
  p_lodge_id uuid, p_draft_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid; v_row public.restaurant_manual_journal_drafts%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select * into v_row from public.restaurant_manual_journal_drafts where id = p_draft_id and lodge_id = p_lodge_id for update;
  if not found or v_row.status <> 'submitted' then raise exception 'Submitted manual journal is required for approval' using errcode = '55000'; end if;
  if v_row.created_by = v_actor then raise exception 'Manual journal maker cannot approve the same journal' using errcode = '42501'; end if;
  update public.restaurant_manual_journal_drafts set status = 'approved', approved_by = v_actor, approved_at = now(), updated_at = now() where id = p_draft_id;
  perform public.log_restaurant_financial_action(p_lodge_id, 'manual_journal.approved', 'manual_journal', p_draft_id, null, jsonb_build_object('actor_id', v_actor), null);
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_draft_id, 'status', 'approved'));
end
$$;

create or replace function public.post_restaurant_manual_journal(
  p_lodge_id uuid, p_draft_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid; v_row public.restaurant_manual_journal_drafts%rowtype; v_result jsonb; v_entry uuid;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select * into v_row from public.restaurant_manual_journal_drafts where id = p_draft_id and lodge_id = p_lodge_id for update;
  if not found or v_row.status <> 'approved' then raise exception 'Approved manual journal is required before posting' using errcode = '55000'; end if;
  v_result := public._restaurant_post_journal(
    p_lodge_id, v_row.entry_date, v_row.description, 'manual', p_draft_id, v_row.reference_number,
    'manual-journal:' || p_draft_id::text, v_row.lines, v_actor, null
  );
  v_entry := nullif(v_result->'data'->>'entry_id', '')::uuid;
  update public.restaurant_manual_journal_drafts
     set status = 'posted', posted_by = v_actor, posted_at = now(), journal_entry_id = v_entry, updated_at = now()
   where id = p_draft_id;
  perform public.log_restaurant_financial_action(p_lodge_id, 'manual_journal.posted', 'manual_journal', p_draft_id, null,
    jsonb_build_object('journal_entry_id', v_entry, 'replayed', coalesce((v_result->'data'->>'replayed')::boolean, false)), null);
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_draft_id, 'status', 'posted', 'journal_entry_id', v_entry, 'replayed', coalesce((v_result->'data'->>'replayed')::boolean, false)));
end
$$;

-- ---------------------------------------------------------------------------
-- Statement disclosure and comparative metadata.
-- ---------------------------------------------------------------------------

create or replace function public.get_restaurant_financial_statements_v3(
  p_lodge_id uuid, p_start_date date, p_end_date date
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_base jsonb; v_data jsonb; v_days integer; v_prior_start date; v_prior_end date;
  v_prior jsonb; v_close jsonb; v_coverage jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Valid statement period is required' using errcode = '22023';
  end if;
  v_base := public.get_restaurant_financial_statements_v2(p_lodge_id, p_start_date, p_end_date);
  v_data := coalesce(v_base->'data', '{}'::jsonb);
  v_days := (p_end_date - p_start_date) + 1;
  v_prior_end := p_start_date - 1;
  v_prior_start := v_prior_end - v_days + 1;
  v_prior := public.get_restaurant_financial_statements_v2(p_lodge_id, v_prior_start, v_prior_end)->'data';
  select coalesce(to_jsonb(c), '{}'::jsonb) into v_close
    from public.restaurant_accounting_period_closes c
   where c.lodge_id = p_lodge_id and c.period_start = p_start_date and c.period_end = p_end_date;
  v_coverage := public.get_restaurant_financial_source_coverage(p_lodge_id, p_start_date, p_end_date)->'data';
  return jsonb_build_object('success', true, 'data', v_data || jsonb_build_object(
    'comparatives', jsonb_build_object(
      'period_start', v_prior_start, 'period_end', v_prior_end,
      'income_statement', coalesce(v_prior->'income_statement', '{}'::jsonb),
      'balance_sheet', coalesce(v_prior->'balance_sheet', '{}'::jsonb),
      'cash_flow', coalesce(v_prior->'cash_flow', '{}'::jsonb)
    ),
    'trial_balance', coalesce(v_data->'balance_sheet'->'accounts', '[]'::jsonb),
    'accounting_basis', 'accrual; posted double-entry journals only',
    'effective_from', (select effective_from from public.restaurant_accounting_activation where lodge_id = p_lodge_id),
    'period_status', coalesce(v_close->>'status', 'unclosed'),
    'close_record', v_close,
    'source_cutoff', now(),
    'source_coverage', coalesce(v_coverage, '{}'::jsonb),
    'drillthrough', jsonb_build_object('ledger_rpc', 'get_restaurant_ledger_export_v2', 'source_coverage_rpc', 'get_restaurant_financial_source_coverage'),
    'complete', coalesce((v_coverage->>'complete')::boolean, false) and coalesce((v_data->'cash_flow'->>'complete')::boolean, false),
    'unresolved_exceptions', coalesce(v_coverage->'missing', '[]'::jsonb) || coalesce(v_coverage->'posting_exceptions', '[]'::jsonb)
  ));
end
$$;

revoke all on function public.get_restaurant_ledger_workspace_page_v2(uuid,date,date,uuid,date,timestamptz,uuid,integer) from public,anon,authenticated;
revoke all on function public.get_restaurant_ledger_export_v2(uuid,date,date,uuid) from public,anon,authenticated;
revoke all on function public.create_restaurant_manual_journal_draft(uuid,date,text,text,jsonb,text,uuid),public.submit_restaurant_manual_journal(uuid,uuid),public.approve_restaurant_manual_journal(uuid,uuid),public.post_restaurant_manual_journal(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_restaurant_financial_statements_v3(uuid,date,date) from public,anon,authenticated;
grant execute on function public.get_restaurant_ledger_workspace_page_v2(uuid,date,date,uuid,date,timestamptz,uuid,integer) to authenticated,service_role;
grant execute on function public.get_restaurant_ledger_export_v2(uuid,date,date,uuid) to authenticated,service_role;
grant execute on function public.create_restaurant_manual_journal_draft(uuid,date,text,text,jsonb,text,uuid),public.submit_restaurant_manual_journal(uuid,uuid),public.approve_restaurant_manual_journal(uuid,uuid),public.post_restaurant_manual_journal(uuid,uuid) to authenticated,service_role;
grant execute on function public.get_restaurant_financial_statements_v3(uuid,date,date) to authenticated,service_role;

commit;
