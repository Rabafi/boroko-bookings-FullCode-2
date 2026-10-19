-- Immutable, idempotent validation report receipts.
-- Historical rows remain readable but are not retroactively assigned a report hash.

begin;

create table if not exists public.financial_reconciliation_reports (
  id uuid primary key,
  lodge_id uuid not null,
  actor_id uuid not null,
  report_hash text not null check (report_hash ~ '^[0-9a-f]{64}$'),
  report jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists financial_reconciliation_reports_lodge_created_idx
  on public.financial_reconciliation_reports (lodge_id, created_at desc);
alter table public.financial_reconciliation_reports enable row level security;
revoke all on table public.financial_reconciliation_reports from public, anon, authenticated;
grant select, insert on table public.financial_reconciliation_reports to service_role;
create table if not exists public.financial_validation_run_intents (
  id uuid primary key,
  lodge_id uuid not null,
  actor_id uuid not null,
  trigger_source text not null check (trigger_source in ('manual','scheduled','startup')),
  idempotency_key text not null,
  report_hash text not null check (report_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  summary jsonb not null,
  created_at timestamptz not null default now(),
  unique (lodge_id, idempotency_key)
);
alter table public.financial_validation_run_intents enable row level security;
revoke all on table public.financial_validation_run_intents from public, anon, authenticated;
grant select, insert on table public.financial_validation_run_intents to service_role;

create or replace function public._financial_validation_run_immutable_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Recorded financial validation runs are immutable.' using errcode='55000';
end;
$$;
revoke all on function public._financial_validation_run_immutable_v2() from public, anon, authenticated;
drop trigger if exists financial_validation_run_intents_immutable on public.financial_validation_run_intents;
create trigger financial_validation_run_intents_immutable
before update or delete on public.financial_validation_run_intents
for each row execute function public._financial_validation_run_immutable_v2();
drop trigger if exists financial_reconciliation_reports_immutable on public.financial_reconciliation_reports;
create trigger financial_reconciliation_reports_immutable
before update or delete on public.financial_reconciliation_reports
for each row execute function public._financial_validation_run_immutable_v2();

create or replace function public.prepare_financial_validation_report_v1(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_report_id uuid := gen_random_uuid();
  v_report jsonb;
  v_report_hash text;
begin
  perform public.app_require_lodge_role(p_lodge_id,array['finance','manager','admin','super_admin']);
  if v_actor is null then
    raise exception 'An authenticated lodge actor is required to prepare a validation report.' using errcode='42501';
  end if;

  v_report := public.get_financial_reconciliation_v1(p_lodge_id);
  if jsonb_typeof(v_report) <> 'object'
     or v_report->>'success' <> 'true'
     or v_report->>'complete' <> 'true'
     or v_report->>'lodge_id' <> p_lodge_id::text
     or v_report->>'calculation_version' <> 'financial-reconciliation-v1' then
    raise exception 'The server did not produce a complete reconciliation report.' using errcode='22023';
  end if;

  v_report_hash := encode(sha256(convert_to(v_report::text,'UTF8')),'hex');
  v_report := v_report || jsonb_build_object('report_id',v_report_id,'report_hash',v_report_hash);
  insert into public.financial_reconciliation_reports(id,lodge_id,actor_id,report_hash,report)
  values(v_report_id,p_lodge_id,v_actor,v_report_hash,v_report);
  return v_report;
end;
$$;

create or replace function public.record_financial_validation_run_v2(
  p_lodge_id uuid,
  p_run_id uuid,
  p_idempotency_key text,
  p_report_hash text,
  p_trigger_source text,
  p_triggered_by uuid,
  p_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_existing public.financial_validation_run_intents%rowtype;
  v_source public.financial_reconciliation_reports%rowtype;
  v_key text := p_idempotency_key;
  v_trigger text := p_trigger_source;
  v_request_hash text;
  v_field text;
  v_value jsonb;
  v_numeric numeric;
begin
  perform public.app_require_lodge_role(p_lodge_id,array['finance','manager','admin','super_admin']);
  if v_actor is null or p_triggered_by is distinct from v_actor then
    raise exception 'Validation actor must match the authenticated lodge session.' using errcode='42501';
  end if;
  if p_run_id is null or p_idempotency_key is distinct from p_run_id::text then
    raise exception 'Validation run ID and idempotency key must match.' using errcode='22023';
  end if;
  if coalesce(p_report_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'A SHA-256 report hash is required.' using errcode='22023';
  end if;
  if v_trigger not in ('manual','scheduled','startup') then
    raise exception 'Unsupported validation trigger source.' using errcode='22023';
  end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'object'
     or p_summary->>'schema_version' <> '1'
     or p_summary->>'calculation_version' <> 'financial-reconciliation-v1'
     or p_summary->>'complete' <> 'true'
     or p_summary->>'lodge_id' <> p_lodge_id::text
     or p_summary->>'sample_limit' <> '50'
     or coalesce(p_summary->>'samples_truncated','') not in ('true','false')
     or jsonb_typeof(p_summary->'examined_counts') <> 'object'
     or jsonb_typeof(p_summary->'mismatch_counts') <> 'object'
     or jsonb_typeof(p_summary->'totals') <> 'object'
     or jsonb_typeof(p_summary->'samples') <> 'object'
     or coalesce(p_summary->>'report_id','') !~ '^[0-9a-fA-F-]{36}$'
     or coalesce(p_summary->>'report_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'A complete versioned server reconciliation report is required.' using errcode='22023';
  end if;

  select * into v_source
    from public.financial_reconciliation_reports r
   where r.id = (p_summary->>'report_id')::uuid
   for share;
  if not found or v_source.lodge_id <> p_lodge_id or v_source.actor_id <> v_actor
     or v_source.report_hash <> p_summary->>'report_hash' or v_source.report_hash is distinct from p_report_hash or v_source.report <> p_summary then
    raise exception 'The validation summary does not match an immutable report prepared by this authenticated lodge actor.' using errcode='22023';
  end if;

  foreach v_field in array array['bookings','payments','charges','invoices','pos_orders','pos_returns','customer_credit_entries']
  loop
    v_value := p_summary->'examined_counts'->v_field;
    if jsonb_typeof(v_value) <> 'number' then raise exception 'Missing exact examined count: %',v_field using errcode='22023'; end if;
    v_numeric := (v_value #>> '{}')::numeric;
    if v_numeric < 0 or v_numeric <> trunc(v_numeric) then raise exception 'Invalid examined count: %',v_field using errcode='22023'; end if;
  end loop;

  foreach v_field in array array[
    'payment_mismatches','charge_mismatches','invoice_gaps','duplicate_invoices',
    'orphan_invoices','folio_pos_mismatches','pos_return_mismatches','credit_mismatches','pos_void_mismatches'
  ]
  loop
    v_value := p_summary->'mismatch_counts'->v_field;
    if jsonb_typeof(v_value) <> 'number' then raise exception 'Missing exact mismatch count: %',v_field using errcode='22023'; end if;
    v_numeric := (v_value #>> '{}')::numeric;
    if v_numeric < 0 or v_numeric <> trunc(v_numeric) then raise exception 'Invalid mismatch count: %',v_field using errcode='22023'; end if;
    v_value := p_summary->'samples'->v_field;
    if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) > 50 then
      raise exception 'Invalid bounded sample: %',v_field using errcode='22023';
    end if;
  end loop;

  foreach v_field in array array[
    'booking_total_amount','booking_amount_paid','payment_ledger_net',
    'booking_charges_total','active_booking_charge_net','pos_net_total','customer_credit_net'
  ]
  loop
    v_value := p_summary->'totals'->v_field;
    if jsonb_typeof(v_value) <> 'string' or (v_value #>> '{}') !~ '^-?(0|[1-9][0-9]*)([.][0-9]{1,4})?$' then
      raise exception 'Missing exact monetary total: %',v_field using errcode='22023';
    end if;
  end loop;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'lodge_id',p_lodge_id,
    'run_id',p_run_id,
    'idempotency_key',v_key,
    'report_hash',p_report_hash,
    'trigger_source',v_trigger,
    'actor_id',v_actor,
    'summary',p_summary
  )::text,'UTF8')),'hex');

  perform pg_advisory_xact_lock(hashtextextended('financial-validation-run:'||p_run_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('financial-validation-key:'||p_lodge_id::text||':'||v_key,0));
  select * into v_existing
    from public.financial_validation_run_intents r
   where r.id = p_run_id
      or (r.lodge_id = p_lodge_id and r.idempotency_key = v_key)
   for update;

  if found then
    if v_existing.lodge_id <> p_lodge_id or v_existing.actor_id <> v_actor
       or v_existing.idempotency_key <> v_key
       or v_existing.report_hash <> p_report_hash
       or v_existing.request_hash <> v_request_hash
       or v_existing.summary <> p_summary then
      return jsonb_build_object('success',false,'recorded',false,'code','idempotency_conflict',
        'error','This validation run ID is already bound to a different report or scope.');
    end if;
    return jsonb_build_object('success',true,'recorded',true,'idempotent',true,
      'run_id',v_existing.id,'report_hash',v_existing.report_hash,'recorded_at',v_existing.created_at);
  end if;

  insert into public.financial_validation_run_intents(
    id,lodge_id,actor_id,trigger_source,idempotency_key,report_hash,request_hash,summary
  ) values (
    p_run_id,p_lodge_id,v_actor,v_trigger,v_key,p_report_hash,v_request_hash,p_summary
  ) returning * into v_existing;

  return jsonb_build_object('success',true,'recorded',true,'idempotent',false,
    'run_id',v_existing.id,'report_hash',v_existing.report_hash,'recorded_at',v_existing.created_at);
end;
$$;

create or replace function public.get_financial_validation_runs_v2(
  p_lodge_id uuid,
  p_limit integer default 30
)
returns table (
  id uuid,
  lodge_id uuid,
  triggered_by uuid,
  triggered_by_name text,
  trigger_source text,
  summary jsonb,
  report_hash text,
  idempotency_key text,
  persistence_state text,
  server_confirmed boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id,array['finance','manager','admin','super_admin']);
  return query
    select q.id,q.lodge_id,q.triggered_by,q.triggered_by_name,q.trigger_source,q.summary,
           q.report_hash,q.idempotency_key,q.persistence_state,q.server_confirmed,q.created_at
      from (
        select old.id,old.lodge_id,old.triggered_by,u.name as triggered_by_name,
               old.trigger_source,old.summary,null::text as report_hash,null::text as idempotency_key,
               'historical'::text as persistence_state,true as server_confirmed,old.created_at
          from public.financial_validation_runs old
          left join public.users u on u.id=old.triggered_by
         where old.lodge_id=p_lodge_id
        union all
        select current.id,current.lodge_id,current.actor_id,u.name,current.trigger_source,
               current.summary,current.report_hash,current.idempotency_key,
               'confirmed'::text,true,current.created_at
          from public.financial_validation_run_intents current
          left join public.users u on u.id=current.actor_id
         where current.lodge_id=p_lodge_id
      ) q
     order by q.created_at desc
     limit greatest(1,least(coalesce(p_limit,30),100));
end;
$$;

revoke all on function public.prepare_financial_validation_report_v1(uuid) from public,anon;
revoke all on function public.record_financial_validation_run(uuid,text,uuid,jsonb) from public,anon,authenticated;
revoke all on table public.financial_validation_runs from public,anon;
revoke insert,update,delete,truncate on table public.financial_validation_runs from authenticated;
revoke all on function public.record_financial_validation_run_v2(uuid,uuid,text,text,text,uuid,jsonb) from public,anon;
revoke all on function public.get_financial_validation_runs_v2(uuid,integer) from public,anon;
grant execute on function public.prepare_financial_validation_report_v1(uuid) to anon,authenticated,service_role;
grant execute on function public.record_financial_validation_run(uuid,text,uuid,jsonb) to service_role;
grant execute on function public.record_financial_validation_run_v2(uuid,uuid,text,text,text,uuid,jsonb) to anon,authenticated,service_role;
grant execute on function public.get_financial_validation_runs_v2(uuid,integer) to anon,authenticated,service_role;

commit;