begin;

alter table public.maintenance_tickets
  add column if not exists labour_cost numeric not null default 0,
  add column if not exists parts_cost numeric not null default 0,
  add column if not exists total_cost numeric not null default 0,
  add column if not exists vendor_name text null,
  add column if not exists cost_notes text null;

create or replace function public.create_maintenance_ticket(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  has_title boolean;
  has_issue boolean;
  has_description boolean;
  has_notes boolean;
  has_status boolean;
  has_priority boolean;
  has_reported_date boolean;
  has_labour_cost boolean;
  has_parts_cost boolean;
  has_total_cost boolean;
  has_vendor_name boolean;
  has_cost_notes boolean;
  cols text[] := array[]::text[];
  vals text[] := array[]::text[];
  v_id text;
begin
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'title') into has_title;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'issue') into has_issue;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'description') into has_description;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'notes') into has_notes;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'status') into has_status;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'priority') into has_priority;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'reported_date') into has_reported_date;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'labour_cost') into has_labour_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'parts_cost') into has_parts_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'total_cost') into has_total_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'vendor_name') into has_vendor_name;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'cost_notes') into has_cost_notes;

  cols := array_append(cols, 'lodge_id');
  vals := array_append(vals, format('%L', payload->>'lodge_id'));

  if coalesce(payload->>'room_id', '') <> '' then
    cols := array_append(cols, 'room_id');
    vals := array_append(vals, format('%L', payload->>'room_id'));
  end if;

  if has_title then
    cols := array_append(cols, 'title');
    vals := array_append(vals, format('%L', coalesce(payload->>'title', payload->>'issue', '')));
  end if;
  if has_issue then
    cols := array_append(cols, 'issue');
    vals := array_append(vals, format('%L', coalesce(payload->>'issue', payload->>'title', '')));
  end if;
  if has_description then
    cols := array_append(cols, 'description');
    vals := array_append(vals, format('%L', coalesce(payload->>'description', '')));
  end if;
  if has_notes then
    cols := array_append(cols, 'notes');
    vals := array_append(vals, format('%L', coalesce(payload->>'notes', payload->>'description', '')));
  end if;
  if has_status then
    cols := array_append(cols, 'status');
    vals := array_append(vals, format('%L', coalesce(payload->>'status', 'open')));
  end if;
  if has_priority then
    cols := array_append(cols, 'priority');
    vals := array_append(vals, format('%L', coalesce(payload->>'priority', 'medium')));
  end if;
  if has_reported_date and coalesce(payload->>'reported_date', '') <> '' then
    cols := array_append(cols, 'reported_date');
    vals := array_append(vals, format('%L', payload->>'reported_date'));
  end if;
  if has_labour_cost then
    cols := array_append(cols, 'labour_cost');
    vals := array_append(vals, coalesce(nullif(payload->>'labour_cost', ''), '0'));
  end if;
  if has_parts_cost then
    cols := array_append(cols, 'parts_cost');
    vals := array_append(vals, coalesce(nullif(payload->>'parts_cost', ''), '0'));
  end if;
  if has_total_cost then
    cols := array_append(cols, 'total_cost');
    vals := array_append(vals, coalesce(nullif(payload->>'total_cost', ''), '0'));
  end if;
  if has_vendor_name and coalesce(payload->>'vendor_name', '') <> '' then
    cols := array_append(cols, 'vendor_name');
    vals := array_append(vals, format('%L', payload->>'vendor_name'));
  end if;
  if has_cost_notes and coalesce(payload->>'cost_notes', '') <> '' then
    cols := array_append(cols, 'cost_notes');
    vals := array_append(vals, format('%L', payload->>'cost_notes'));
  end if;

  execute format(
    'insert into public.maintenance_tickets (%s) values (%s) returning id::text',
    array_to_string(cols, ', '),
    array_to_string(vals, ', ')
  )
  into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_maintenance_ticket(jsonb) to anon, authenticated;

create or replace function public.update_maintenance_ticket(
  p_id text,
  p_lodge_id text,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  has_title boolean;
  has_issue boolean;
  has_description boolean;
  has_notes boolean;
  has_status boolean;
  has_priority boolean;
  has_reported_date boolean;
  has_resolved_at boolean;
  has_labour_cost boolean;
  has_parts_cost boolean;
  has_total_cost boolean;
  has_vendor_name boolean;
  has_cost_notes boolean;
  assignments text[] := array[]::text[];
  v_updated text;
begin
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'title') into has_title;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'issue') into has_issue;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'description') into has_description;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'notes') into has_notes;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'status') into has_status;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'priority') into has_priority;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'reported_date') into has_reported_date;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'resolved_at') into has_resolved_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'labour_cost') into has_labour_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'parts_cost') into has_parts_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'total_cost') into has_total_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'vendor_name') into has_vendor_name;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'cost_notes') into has_cost_notes;

  if has_title and payload ? 'title' then assignments := array_append(assignments, format('title = %L', payload->>'title')); end if;
  if has_issue and payload ? 'issue' then assignments := array_append(assignments, format('issue = %L', payload->>'issue')); end if;
  if has_description and payload ? 'description' then assignments := array_append(assignments, format('description = %L', payload->>'description')); end if;
  if has_notes and payload ? 'notes' then assignments := array_append(assignments, format('notes = %L', payload->>'notes')); end if;
  if has_status and payload ? 'status' then assignments := array_append(assignments, format('status = %L', payload->>'status')); end if;
  if has_priority and payload ? 'priority' then assignments := array_append(assignments, format('priority = %L', payload->>'priority')); end if;
  if has_reported_date and payload ? 'reported_date' and coalesce(payload->>'reported_date', '') <> '' then assignments := array_append(assignments, format('reported_date = %L', payload->>'reported_date')); end if;
  if has_resolved_at and payload ? 'resolved_at' then assignments := array_append(assignments, format('resolved_at = %L', payload->>'resolved_at')); end if;
  if has_labour_cost and payload ? 'labour_cost' then assignments := array_append(assignments, format('labour_cost = %s', coalesce(nullif(payload->>'labour_cost', ''), '0'))); end if;
  if has_parts_cost and payload ? 'parts_cost' then assignments := array_append(assignments, format('parts_cost = %s', coalesce(nullif(payload->>'parts_cost', ''), '0'))); end if;
  if has_total_cost and payload ? 'total_cost' then assignments := array_append(assignments, format('total_cost = %s', coalesce(nullif(payload->>'total_cost', ''), '0'))); end if;
  if has_vendor_name and payload ? 'vendor_name' then assignments := array_append(assignments, format('vendor_name = %L', nullif(payload->>'vendor_name', ''))); end if;
  if has_cost_notes and payload ? 'cost_notes' then assignments := array_append(assignments, format('cost_notes = %L', nullif(payload->>'cost_notes', ''))); end if;

  if coalesce(array_length(assignments, 1), 0) = 0 then
    return jsonb_build_object('success', true, 'id', p_id);
  end if;

  execute format(
    'update public.maintenance_tickets set %s where id::text = %L and lodge_id::text = %L returning id::text',
    array_to_string(assignments, ', '),
    p_id,
    p_lodge_id
  )
  into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Maintenance ticket not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_maintenance_ticket(text, text, jsonb) to anon, authenticated;

commit;
