-- Financial truth gate 7/9 follow-through: expose only the locked bank
-- allocation workflow to the operator workspace. The legacy proposal table
-- remains for historical compatibility, but it is not an active caller path.

begin;

-- Existing statement rows may predate the sign trigger. Backfill the derived
-- value before any allocation or review relies on it; the source debit/credit
-- columns remain the evidence of record.
update public.restaurant_bank_transactions
set signed_amount = round(coalesce(credit, 0) - coalesce(debit, 0), 2)
where signed_amount is null;

create table if not exists public.restaurant_bank_match_operations (
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  operation_id text not null,
  payload_hash text not null,
  allocation_ids jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  primary key (lodge_id, operation_id)
);
alter table public.restaurant_bank_match_operations enable row level security;
revoke all on table public.restaurant_bank_match_operations from public, anon, authenticated;
grant select, insert, update on table public.restaurant_bank_match_operations to service_role;

create or replace function public.propose_bank_match_allocations_v1(
  p_lodge_id uuid,
  p_bank_transaction_id uuid,
  p_allocations jsonb,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_tx public.restaurant_bank_transactions%rowtype;
  v_row jsonb;
  v_entry uuid;
  v_line uuid;
  v_amount numeric;
  v_available numeric;
  v_requested numeric := 0;
  v_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_operation_id text;
  v_hash text;
  v_existing public.restaurant_bank_match_operations%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.bank_approve');
  v_operation_id := nullif(btrim(coalesce(p_evidence->>'operation_id', '')), '');
  if v_operation_id is null then
    raise exception 'A stable bank allocation operation ID is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) = 0
     or nullif(btrim(p_reason), '') is null then
    raise exception 'Match allocations, reason and evidence are required' using errcode = '22023';
  end if;
  v_hash := encode(digest(jsonb_build_object(
    'bank_transaction_id', p_bank_transaction_id,
    'allocations', p_allocations,
    'reason', btrim(p_reason),
    'evidence', coalesce(p_evidence, '{}'::jsonb) - 'operation_id'
  )::text, 'sha256'), 'hex');
  insert into public.restaurant_bank_match_operations(lodge_id, operation_id, payload_hash, created_by)
  values(p_lodge_id, v_operation_id, v_hash, v_actor)
  on conflict (lodge_id, operation_id) do nothing;
  select * into v_existing
  from public.restaurant_bank_match_operations
  where lodge_id = p_lodge_id and operation_id = v_operation_id
  for update;
  if v_existing.payload_hash <> v_hash then
    raise exception 'Bank allocation operation ID conflicts with a different payload' using errcode = '23505';
  end if;
  if jsonb_array_length(coalesce(v_existing.allocation_ids, '[]'::jsonb)) > 0 then
    return jsonb_build_object('success', true, 'data', jsonb_build_object(
      'allocation_ids', v_existing.allocation_ids, 'status', 'proposed', 'replayed', true
    ));
  end if;

  select * into v_tx
  from public.restaurant_bank_transactions
  where id = p_bank_transaction_id and lodge_id = p_lodge_id
  for update;
  if not found then raise exception 'Bank transaction was not found' using errcode = 'P0002'; end if;
  if v_tx.is_reconciled then raise exception 'Completed bank reconciliation cannot be mutated' using errcode = '55000'; end if;

  for v_row in select value from jsonb_array_elements(p_allocations) loop
    v_entry := nullif(v_row->>'journal_entry_id', '')::uuid;
    v_line := nullif(v_row->>'journal_line_id', '')::uuid;
    v_amount := round(coalesce((v_row->>'allocated_amount')::numeric, 0), 2);
    if v_entry is null or v_amount <= 0 then raise exception 'Allocation journal evidence is invalid' using errcode = '23503'; end if;
    select e.id into v_entry
    from public.restaurant_journal_entries e
    where e.id = v_entry and e.lodge_id = p_lodge_id and e.is_posted
    for update;
    if not found then raise exception 'Allocation journal evidence is invalid' using errcode = '23503'; end if;
    if v_line is not null and not exists(
      select 1 from public.restaurant_journal_lines l where l.id = v_line and l.entry_id = v_entry
    ) then raise exception 'Allocation journal line does not belong to the journal entry' using errcode = '23503'; end if;
    select greatest(
      case when v_line is not null
        then abs(coalesce((select l.debit - l.credit from public.restaurant_journal_lines l where l.id = v_line), 0))
        else greatest(
          coalesce((select sum(l.debit) from public.restaurant_journal_lines l where l.entry_id = v_entry), 0),
          coalesce((select sum(l.credit) from public.restaurant_journal_lines l where l.entry_id = v_entry), 0)
        )
      end
      - coalesce((select sum(m.allocated_amount) from public.restaurant_bank_match_allocations m
        where m.journal_entry_id = v_entry and m.lodge_id = p_lodge_id and m.status in ('approved', 'proposed')), 0),
      0
    ) into v_available;
    if v_requested + v_amount > v_available then raise exception 'Journal amount is overallocated' using errcode = '23514'; end if;
    select greatest(
      abs(coalesce(v_tx.signed_amount, v_tx.credit - v_tx.debit))
      - coalesce((select sum(m.allocated_amount) from public.restaurant_bank_match_allocations m
        where m.bank_transaction_id = v_tx.id and m.status in ('approved', 'proposed')), 0),
      0
    ) into v_available;
    if v_requested + v_amount > v_available then raise exception 'Bank row is overallocated' using errcode = '23514'; end if;
    insert into public.restaurant_bank_match_allocations(
      lodge_id, bank_transaction_id, journal_entry_id, journal_line_id,
      allocated_amount, proposer_id, evidence, reason
    ) values(
      p_lodge_id, v_tx.id, v_entry, v_line, v_amount, v_actor,
      coalesce(p_evidence, '{}'::jsonb), btrim(p_reason)
    ) returning id into v_id;
    v_ids := v_ids || jsonb_build_array(v_id);
    v_requested := v_requested + v_amount;
  end loop;
  update public.restaurant_bank_match_operations
  set allocation_ids = v_ids
  where lodge_id = p_lodge_id and operation_id = v_operation_id;
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'allocation_ids', v_ids, 'status', 'proposed', 'replayed', false
  ));
end;
$$;

create or replace function public.get_bank_match_candidates_v1(
  p_lodge_id uuid,
  p_bank_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.restaurant_bank_transactions%rowtype;
  v_account_id uuid;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  select bt.* into v_tx
  from public.restaurant_bank_transactions bt
  join public.restaurant_bank_accounts ba
    on ba.id = bt.bank_account_id
   and ba.lodge_id = p_lodge_id
  where bt.id = p_bank_transaction_id
    and bt.lodge_id = p_lodge_id;

  select ba.account_id into v_account_id
  from public.restaurant_bank_accounts ba
  where ba.id = v_tx.bank_account_id
    and ba.lodge_id = p_lodge_id;

  if not found then
    raise exception 'Bank transaction was not found for this lodge' using errcode = '23503';
  end if;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'bank_transaction', to_jsonb(v_tx),
      'candidates', case
        when v_tx.is_reconciled then '[]'::jsonb
        else coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'journal_entry_id', e.id,
              'journal_line_id', l.id,
              'entry_date', e.entry_date,
              'description', e.description,
              'source_type', e.source_type,
              'source_id', e.source_id,
              'reference_number', e.reference_number,
              'debit', l.debit,
              'credit', l.credit,
              'amount', round(abs(l.debit - l.credit), 2),
              'allocated_amount', round(coalesce((
                select sum(m.allocated_amount)
                from public.restaurant_bank_match_allocations m
                where m.lodge_id = p_lodge_id
                  and m.journal_line_id = l.id
                  and m.status in ('proposed', 'approved')
              ), 0), 2),
              'available_amount', round(abs(l.debit - l.credit) - coalesce((
                select sum(m.allocated_amount)
                from public.restaurant_bank_match_allocations m
                where m.lodge_id = p_lodge_id
                  and m.journal_line_id = l.id
                  and m.status in ('proposed', 'approved')
              ), 0), 2),
              'exact_amount', round(abs(l.debit - l.credit), 2) = abs(coalesce(v_tx.signed_amount, 0))
            )
            order by
              (round(abs(l.debit - l.credit), 2) = abs(coalesce(v_tx.signed_amount, 0))) desc,
              abs(e.entry_date - v_tx.transaction_date),
              e.entry_date,
              e.id,
              l.id
          )
          from public.restaurant_journal_lines l
          join public.restaurant_journal_entries e on e.id = l.entry_id
          where l.account_id = v_account_id
            and e.lodge_id = p_lodge_id
            and e.is_posted
            and abs(l.debit - l.credit) > 0
            and (case when v_tx.signed_amount >= 0 then l.debit > 0 else l.credit > 0 end)
            and abs(e.entry_date - v_tx.transaction_date) <= 31
            and abs(l.debit - l.credit) > coalesce((
              select sum(m.allocated_amount)
              from public.restaurant_bank_match_allocations m
              where m.lodge_id = p_lodge_id
                and m.journal_line_id = l.id
                and m.status in ('proposed', 'approved')
            ), 0)
        ), '[]'::jsonb)
      end
    )
  );
end;
$$;

create or replace function public.get_restaurant_bank_workspace_v2(
  p_lodge_id uuid,
  p_bank_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  if p_bank_account_id is not null and not exists (
    select 1 from public.restaurant_bank_accounts
    where id = p_bank_account_id and lodge_id = p_lodge_id
  ) then
    raise exception 'Bank account belongs to another lodge or is missing' using errcode = '23503';
  end if;

  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'ledger_balance', coalesce((
          select round(sum(l.debit - l.credit), 2)
          from public.restaurant_journal_lines l
          join public.restaurant_journal_entries e on e.id = l.entry_id
          where l.account_id = a.account_id
            and e.lodge_id = p_lodge_id
            and e.is_posted
        ), 0)
      ) order by a.name)
      from public.restaurant_bank_accounts a
      where a.lodge_id = p_lodge_id
    ), '[]'::jsonb),
    'imports', coalesce((
      select jsonb_agg(to_jsonb(i) - 'raw_payload' order by i.period_end desc, i.imported_at desc)
      from public.restaurant_bank_statement_imports i
      where i.lodge_id = p_lodge_id
        and (p_bank_account_id is null or i.bank_account_id = p_bank_account_id)
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(
        to_jsonb(t) || jsonb_build_object(
          'allocations', coalesce((
            select jsonb_agg(to_jsonb(m) order by m.created_at desc)
            from public.restaurant_bank_match_allocations m
            where m.lodge_id = p_lodge_id
              and m.bank_transaction_id = t.id
          ), '[]'::jsonb)
        )
        order by t.transaction_date desc, t.imported_at desc
      )
      from public.restaurant_bank_transactions t
      where t.lodge_id = p_lodge_id
        and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id)
    ), '[]'::jsonb),
    'allocations', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at desc)
      from public.restaurant_bank_match_allocations m
      join public.restaurant_bank_transactions t on t.id = m.bank_transaction_id
      where m.lodge_id = p_lodge_id
        and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id)
    ), '[]'::jsonb),
    'reconciliations', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.reconciliation_date desc, r.created_at desc)
      from public.restaurant_bank_reconciliations r
      where r.lodge_id = p_lodge_id
        and (p_bank_account_id is null or r.bank_account_id = p_bank_account_id)
    ), '[]'::jsonb)
  ));
end;
$$;

revoke all on function public.get_bank_match_candidates_v1(uuid, uuid),
  public.get_restaurant_bank_workspace_v2(uuid, uuid),
  public.propose_bank_match_allocations_v1(uuid, uuid, jsonb, text, jsonb),
  public.review_bank_match_allocation_v1(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.get_bank_match_candidates_v1(uuid, uuid),
  public.get_restaurant_bank_workspace_v2(uuid, uuid),
  public.propose_bank_match_allocations_v1(uuid, uuid, jsonb, text, jsonb),
  public.review_bank_match_allocation_v1(uuid, uuid, boolean, text)
  to service_role;

commit;
