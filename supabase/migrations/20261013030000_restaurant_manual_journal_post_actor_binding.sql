-- Bind governed manual journal posting evidence to the same actor on the
-- immutable draft and posted journal. This is forward-only after ledger v4.
begin;

create or replace function public.restaurant_manual_journal_actor_match_v5(
  p_draft_poster uuid,
  p_journal_creator uuid
)
returns boolean
language sql
immutable
set search_path=public
as $$
  select p_draft_poster is not null
     and p_journal_creator is not null
     and p_draft_poster=p_journal_creator;
$$;
revoke all on function public.restaurant_manual_journal_actor_match_v5(uuid,uuid) from public,anon,authenticated;
grant execute on function public.restaurant_manual_journal_actor_match_v5(uuid,uuid) to service_role;

-- Keep the existing v4 signature consumed by Statements/close callers. The
-- original immutable inputs and checker remain unchanged; this adds the
-- producer-supported posted_by = journal.created_by relationship.
create or replace function public.restaurant_manual_journal_evidence_v4(p_lodge_id uuid,p_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d public.restaurant_manual_journal_drafts%rowtype; expected jsonb; actual jsonb;
  canonical_hash text; journal_hash text; journal_creator uuid; result jsonb; actor_match boolean;
begin
  select * into d from public.restaurant_manual_journal_drafts
   where lodge_id=p_lodge_id and id=p_source_id and status='posted';
  if not found then
    return jsonb_build_object('complete',false,'reasons',jsonb_build_array('legacy_manual_journal_without_governed_draft'));
  end if;

  canonical_hash:=encode(digest(jsonb_build_object(
    'lodge_id',d.lodge_id,'entry_date',d.entry_date,'description',btrim(d.description),
    'reference_number',nullif(btrim(d.reference_number),''),'lines',d.lines,
    'evidence_ref',btrim(d.evidence_ref),'operation_id',d.operation_id
  )::text,'sha256'),'hex');
  journal_hash:=encode(digest(jsonb_build_object(
    'lodge_id',d.lodge_id,'entry_date',d.entry_date,'description',btrim(d.description),
    'source_type','manual'::text,'source_id',d.id,'reference_number',nullif(btrim(d.reference_number),''),
    'lines',d.lines,'reversal_of',null
  )::text,'sha256'),'hex');
  expected:=jsonb_build_object('lodge_id',d.lodge_id,'source_id',d.id,'business_date',d.entry_date,
    'journal_entry_id',d.journal_entry_id,'source_version',1,
    'source_payload_hash',canonical_hash,'journal_payload_hash',journal_hash,
    'journal_source_type','manual','posting_key','manual-journal:'||d.id::text,'lines',d.lines,
    'posted_by',d.posted_by,
    'provenance_verified',d.payload_hash=canonical_hash and d.operation_id is not null and d.journal_entry_id is not null
      and nullif(btrim(d.evidence_ref),'') is not null and d.posted_by is not null and d.posted_at is not null
      and not exists(select 1 from jsonb_array_elements(d.lines) l left join public.restaurant_accounts a
        on a.id=(l->>'account_id')::uuid and a.lodge_id=d.lodge_id where a.id is null),
    'approved',d.created_by is not null and d.approved_by is not null and d.approved_by<>d.created_by and d.approved_at is not null);

  select j.created_by into journal_creator
    from public.restaurant_journal_entries j
   where j.id=d.journal_entry_id and j.lodge_id=p_lodge_id;
  actor_match:=public.restaurant_manual_journal_actor_match_v5(d.posted_by,journal_creator);

  select coalesce(jsonb_agg(jsonb_build_object(
    'lodge_id',d.lodge_id,'source_id',d.id,'business_date',d.entry_date,'source_version',1,
    'source_payload_hash',d.payload_hash,'posted_by',d.posted_by,
    'journal_lodge_id',j.lodge_id,'journal_source_id',j.source_id,'journal_date',j.entry_date,
    'journal_entry_id',j.id,'journal_created_by',j.created_by,
    'journal_payload_hash',j.payload_hash,'journal_source_type',j.source_type,'posting_key',j.posting_key,
    'is_posted',j.is_posted,'status',case when j.is_posted then 'posted' else 'pending' end,
    'shared_journal_count',(select count(*) from public.restaurant_manual_journal_drafts x where x.journal_entry_id=j.id)
      +(select count(*) from public.restaurant_financial_source_postings s where s.journal_entry_id=j.id),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('account_id',l.account_id,'debit',l.debit,'credit',l.credit,'memo',l.memo)),'[]'::jsonb)
      from public.restaurant_journal_lines l where l.entry_id=j.id)
  )),'[]'::jsonb) into actual
    from public.restaurant_journal_entries j
   where j.id=d.journal_entry_id or (j.source_id=d.id and j.source_type in ('manual','manual_journal'));

  result:=public.restaurant_financial_evidence_check_v4(expected,actual)||jsonb_build_object(
    'source_id',d.id,'business_date',d.entry_date,'contract','governed_manual_draft_v1',
    'control_total',(select sum(round(coalesce((l->>'debit')::numeric,0),2)) from jsonb_array_elements(d.lines) l));
  if not actor_match then
    return result||jsonb_build_object('complete',false,
      'reasons',coalesce(result->'reasons','[]'::jsonb)||jsonb_build_array('posted_actor_journal_creator_mismatch'));
  end if;
  return result;
end
$$;
revoke all on function public.restaurant_manual_journal_evidence_v4(uuid,uuid) from public,anon,authenticated;
grant execute on function public.restaurant_manual_journal_evidence_v4(uuid,uuid) to service_role;

commit;
