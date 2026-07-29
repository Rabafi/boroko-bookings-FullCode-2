-- Restaurant Accounting financial-grade foundation.
-- This migration intentionally restores no operator grants.

begin;

alter table public.restaurant_journal_entries
  add column if not exists posting_key text,
  add column if not exists payload_hash text,
  add column if not exists reversal_of uuid references public.restaurant_journal_entries(id) on delete restrict,
  add column if not exists posted_at timestamptz not null default now();

create unique index if not exists restaurant_journal_entries_posting_key_uidx
  on public.restaurant_journal_entries(lodge_id, posting_key)
  where posting_key is not null;

create unique index if not exists restaurant_journal_entries_reversal_uidx
  on public.restaurant_journal_entries(reversal_of)
  where reversal_of is not null;

alter table public.restaurant_journal_lines
  drop constraint if exists restaurant_journal_lines_one_side_chk;
alter table public.restaurant_journal_lines
  add constraint restaurant_journal_lines_one_side_chk
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0));

create or replace function public._restaurant_actor_has_capability(
  p_lodge_id uuid,
  p_capability text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_get_actor_user_id();
  v_role text;
  v_overrides jsonb;
  v_override jsonb;
  v_default boolean := false;
begin
  if auth.role() = 'service_role' then
    return true;
  end if;

  select lower(coalesce(u.role, '')), coalesce(u.capability_overrides, '{}'::jsonb)
    into v_role, v_overrides
  from public.users u
  where u.id = v_actor
    and u.lodge_id = p_lodge_id
    and coalesce(u.status, 'active') = 'active';

  if not found then
    return false;
  end if;

  v_default := case p_capability
    when 'accounting.read' then v_role in ('finance', 'manager', 'admin', 'super_admin')
    when 'accounting.manage' then v_role in ('finance', 'admin', 'super_admin')
    when 'accounting.ap_pay' then v_role in ('finance', 'admin', 'super_admin')
    when 'accounting.bank_approve' then v_role in ('finance', 'admin', 'super_admin')
    when 'accounting.tax_file' then v_role in ('finance', 'admin', 'super_admin')
    when 'accounting.payroll_view' then v_role in ('admin', 'super_admin')
    when 'accounting.payroll_manage' then v_role in ('admin', 'super_admin')
    else false
  end;

  v_override := v_overrides -> p_capability;
  if v_override is not null and jsonb_typeof(v_override) = 'boolean' then
    return (v_override::text)::boolean;
  end if;

  return v_default;
end;
$$;

revoke all on function public._restaurant_actor_has_capability(uuid, text)
  from public, anon, authenticated;
grant execute on function public._restaurant_actor_has_capability(uuid, text)
  to service_role;

create or replace function public._restaurant_require_capability(
  p_lodge_id uuid,
  p_capability text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_get_actor_user_id();
begin
  perform public.app_require_feature(
    p_lodge_id,
    'restaurant_accounting',
    array['finance', 'manager', 'admin', 'super_admin']
  );

  if not public._restaurant_actor_has_capability(p_lodge_id, p_capability) then
    raise exception 'Accounting capability % is required', p_capability
      using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

revoke all on function public._restaurant_require_capability(uuid, text)
  from public, anon, authenticated;
grant execute on function public._restaurant_require_capability(uuid, text)
  to service_role;

create or replace function public._restaurant_block_posted_journal_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Posted journals are immutable; create a reversal journal'
    using errcode = '55000';
end;
$$;

revoke all on function public._restaurant_block_posted_journal_mutation()
  from public, anon, authenticated;

drop trigger if exists restaurant_journal_entries_immutable on public.restaurant_journal_entries;
create trigger restaurant_journal_entries_immutable
before update or delete on public.restaurant_journal_entries
for each row execute function public._restaurant_block_posted_journal_mutation();

drop trigger if exists restaurant_journal_lines_immutable on public.restaurant_journal_lines;
create trigger restaurant_journal_lines_immutable
before update or delete on public.restaurant_journal_lines
for each row execute function public._restaurant_block_posted_journal_mutation();

create or replace function public._restaurant_post_journal(
  p_lodge_id uuid,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_reference_number text,
  p_posting_key text,
  p_lines jsonb,
  p_actor_id uuid,
  p_reversal_of uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_existing record;
  v_line jsonb;
  v_debit numeric(18,2) := 0;
  v_credit numeric(18,2) := 0;
  v_hash text;
  v_count integer := 0;
begin
  if p_entry_date is null or nullif(btrim(p_description), '') is null
     or nullif(btrim(p_source_type), '') is null
     or nullif(btrim(p_posting_key), '') is null then
    raise exception 'Journal date, description, source type and posting key are required'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal requires at least two lines' using errcode = '22023';
  end if;

  v_hash := encode(digest(
    jsonb_build_object(
      'lodge_id', p_lodge_id,
      'entry_date', p_entry_date,
      'description', btrim(p_description),
      'source_type', btrim(p_source_type),
      'source_id', p_source_id,
      'reference_number', nullif(btrim(p_reference_number), ''),
      'lines', p_lines,
      'reversal_of', p_reversal_of
    )::text,
    'sha256'
  ), 'hex');

  select id, payload_hash into v_existing
  from public.restaurant_journal_entries
  where lodge_id = p_lodge_id and posting_key = p_posting_key;

  if found then
    if v_existing.payload_hash is distinct from v_hash then
      raise exception 'Posting key was already used for a different journal'
        using errcode = '23505';
    end if;
    return jsonb_build_object('success', true, 'data',
      jsonb_build_object('entry_id', v_existing.id, 'replayed', true));
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if coalesce((v_line->>'debit')::numeric, 0) < 0
       or coalesce((v_line->>'credit')::numeric, 0) < 0
       or not (
         (coalesce((v_line->>'debit')::numeric, 0) > 0 and coalesce((v_line->>'credit')::numeric, 0) = 0)
         or
         (coalesce((v_line->>'credit')::numeric, 0) > 0 and coalesce((v_line->>'debit')::numeric, 0) = 0)
       ) then
      raise exception 'Each journal line must contain one positive debit or credit'
        using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.restaurant_accounts a
      where a.id = (v_line->>'account_id')::uuid
        and a.lodge_id = p_lodge_id
        and a.is_active
    ) then
      raise exception 'Journal account is invalid, inactive, or belongs to another lodge'
        using errcode = '23503';
    end if;

    v_debit := v_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_credit := v_credit + coalesce((v_line->>'credit')::numeric, 0);
    v_count := v_count + 1;
  end loop;

  if round(v_debit, 2) = 0 or round(v_debit, 2) <> round(v_credit, 2) then
    raise exception 'Journal must balance to a non-zero amount'
      using errcode = '23514';
  end if;

  insert into public.restaurant_journal_entries (
    lodge_id, entry_date, description, source_type, source_id,
    reference_number, is_posted, created_by, posting_key,
    payload_hash, reversal_of, posted_at
  ) values (
    p_lodge_id, p_entry_date, btrim(p_description), btrim(p_source_type), p_source_id,
    nullif(btrim(p_reference_number), ''), true, p_actor_id, p_posting_key,
    v_hash, p_reversal_of, now()
  ) returning id into v_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    insert into public.restaurant_journal_lines(entry_id, account_id, debit, credit, memo)
    values (
      v_entry_id,
      (v_line->>'account_id')::uuid,
      round(coalesce((v_line->>'debit')::numeric, 0), 2),
      round(coalesce((v_line->>'credit')::numeric, 0), 2),
      nullif(btrim(v_line->>'memo'), '')
    );
  end loop;

  insert into public.restaurant_financial_audit_log(
    lodge_id, action, entity_type, entity_id, actor_user_id, new_data, metadata
  ) values (
    p_lodge_id, 'journal_posted', 'journal_entry', v_entry_id, p_actor_id,
    jsonb_build_object('debit', v_debit, 'credit', v_credit),
    jsonb_build_object('posting_key', p_posting_key, 'payload_hash', v_hash)
  );

  return jsonb_build_object('success', true, 'data',
    jsonb_build_object('entry_id', v_entry_id, 'replayed', false,
      'total_debit', v_debit, 'total_credit', v_credit));
end;
$$;

revoke all on function public._restaurant_post_journal(
  uuid, date, text, text, uuid, text, text, jsonb, uuid, uuid
) from public, anon, authenticated;
grant execute on function public._restaurant_post_journal(
  uuid, date, text, text, uuid, text, text, jsonb, uuid, uuid
) to service_role;

create or replace function public.create_restaurant_journal_entry(
  p_lodge_id uuid,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid default null,
  p_reference_number text default null,
  p_lines jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  return public._restaurant_post_journal(
    p_lodge_id, p_entry_date, p_description, p_source_type, p_source_id,
    p_reference_number, p_idempotency_key, p_lines, v_actor, null
  );
end;
$$;

revoke all on function public.create_restaurant_journal_entry(
  uuid, date, text, text, uuid, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.create_restaurant_journal_entry(
  uuid, date, text, text, uuid, text, jsonb, text
) to service_role;

create or replace function public.reverse_restaurant_journal_entry(
  p_lodge_id uuid,
  p_entry_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_original public.restaurant_journal_entries%rowtype;
  v_lines jsonb;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reversal reason is required' using errcode = '22023';
  end if;

  select * into v_original from public.restaurant_journal_entries
  where id = p_entry_id and lodge_id = p_lodge_id
  for share;
  if not found then
    raise exception 'Journal entry not found' using errcode = 'P0002';
  end if;
  if v_original.reversal_of is not null then
    raise exception 'A reversal journal cannot itself be reversed';
  end if;

  select jsonb_agg(jsonb_build_object(
    'account_id', l.account_id,
    'debit', l.credit,
    'credit', l.debit,
    'memo', concat('Reversal: ', p_reason)
  ) order by l.id) into v_lines
  from public.restaurant_journal_lines l where l.entry_id = p_entry_id;

  return public._restaurant_post_journal(
    p_lodge_id, public.get_lodge_business_date(p_lodge_id),
    concat('Reversal of ', v_original.description, ': ', btrim(p_reason)),
    'journal_reversal', p_entry_id, v_original.reference_number,
    p_idempotency_key, v_lines, v_actor, p_entry_id
  );
end;
$$;

revoke all on function public.reverse_restaurant_journal_entry(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reverse_restaurant_journal_entry(uuid, uuid, text, text)
  to service_role;

commit;
