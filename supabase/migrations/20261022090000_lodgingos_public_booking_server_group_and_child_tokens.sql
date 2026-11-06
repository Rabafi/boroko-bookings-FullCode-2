-- Public multi-unit booking corrections.
-- Keep the public request-envelope wrapper and staff invoice-group RPC intact.
-- The legacy implementation is server-only and calls the private helper only
-- while the matching public idempotency envelope is pending in this transaction.

begin;

create or replace function public._create_public_booking_invoice_group(
  p_lodge_id uuid,
  p_group_key text,
  p_customer_id uuid,
  p_booking_ids uuid[],
  p_operation_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_envelope public.public_booking_idempotency%rowtype;
  v_payload jsonb;
  v_expected_ids uuid[];
  v_expected_count integer;
  v_invoice_number text;
  v_group_id uuid;
begin
  if p_lodge_id is null or p_customer_id is null or nullif(btrim(coalesce(p_operation_key, '')), '') is null
     or nullif(btrim(coalesce(p_group_key, '')), '') is null
     or p_group_key !~ '^online-[0-9a-f]{32}$'
     or p_group_key is distinct from 'online-' || substring(encode(sha256(convert_to(
       'public-invoice-group:' || p_lodge_id::text || ':' || p_operation_key, 'UTF8')), 'hex') from 1 for 32)
     or coalesce(array_length(p_booking_ids, 1), 0) < 2
     or (select count(distinct x.booking_id) from unnest(p_booking_ids) x(booking_id)) <> array_length(p_booking_ids, 1) then
    raise exception 'Invalid public invoice group request' using errcode = 'P0001';
  end if;

  select * into v_envelope
    from public.public_booking_idempotency i
   where i.lodge_id = p_lodge_id and i.idempotency_key = p_operation_key
   for update;
  if not found or v_envelope.result is not null or v_envelope.original_request is null
     or v_envelope.original_request->>'lodge_id' is distinct from p_lodge_id::text then
    raise exception 'Public invoice group has no matching pending request envelope' using errcode = 'P0001';
  end if;

  v_payload := v_envelope.original_request->'payload';
  if jsonb_typeof(v_payload->'rooms') is distinct from 'array' then
    raise exception 'Public invoice group requires the original ordered room lines' using errcode = 'P0001';
  end if;
  v_expected_count := jsonb_array_length(v_payload->'rooms');
  if v_expected_count <> array_length(p_booking_ids, 1) then
    raise exception 'Public invoice group does not match the original room-line count' using errcode = 'P0001';
  end if;

  select array_agg(b.id order by r.ordinality)
    into v_expected_ids
    from jsonb_array_elements(v_payload->'rooms') with ordinality as r(value, ordinality)
    join public.bookings b
      on b.id = p_booking_ids[r.ordinality]
     and b.lodge_id = p_lodge_id
     and b.room_id = nullif(r.value->>'room_id', '')::uuid
     and b.create_idempotency_key is not distinct from case
       when r.ordinality = 1 then p_operation_key
       else p_operation_key || ':' || b.room_id::text
     end
     and b.customer_id is not distinct from p_customer_id
     and b.check_in is not distinct from nullif(v_payload->>'check_in', '')::date
     and b.check_out is not distinct from nullif(v_payload->>'check_out', '')::date
     and coalesce(b.source, '') = 'online'
     and coalesce(b.status, '') = 'pending'
     and b.adults is not distinct from greatest(1, coalesce(nullif(r.value->>'adults', '')::integer, 1))
     and b.children is not distinct from greatest(0, coalesce(nullif(r.value->>'children', '')::integer, 0))
     and b.tents_count is not distinct from greatest(0, coalesce(nullif(r.value->>'tents', '')::integer, 0))
     and b.vehicles_count is not distinct from greatest(0, coalesce(nullif(r.value->>'vehicles', '')::integer, 0))
     and exists (
       select 1 from public.booking_accommodation_details d
       where d.booking_id = b.id and d.lodge_id = p_lodge_id
         and d.adults = b.adults and d.children = b.children
         and d.tents = b.tents_count and d.vehicles = b.vehicles_count
     );

  if v_expected_ids is distinct from p_booking_ids
     or not exists (
       select 1 from public.customers c
       where c.id = p_customer_id and c.lodge_id = p_lodge_id
         and lower(btrim(coalesce(c.email, ''))) = lower(btrim(coalesce(v_payload->>'guest_email', '')))
     )
     or exists (select 1 from public.booking_invoice_group_lines l where l.booking_id = any(p_booking_ids))
     or exists (select 1 from public.booking_invoice_groups g where g.lodge_id = p_lodge_id and g.group_key = p_group_key) then
    raise exception 'Public invoice group contains unrelated, substituted, or previously grouped bookings' using errcode = 'P0001';
  end if;

  v_invoice_number := public.get_next_invoice_number(p_lodge_id);
  insert into public.booking_invoice_groups (
    lodge_id, group_key, customer_id, invoice_number, due_date, notes, created_by
  ) values (
    p_lodge_id, p_group_key, p_customer_id, v_invoice_number,
    (select min(b.check_in) from public.bookings b where b.id = any(p_booking_ids) and b.lodge_id = p_lodge_id),
    'Online multi-room booking request', null
  ) returning id into v_group_id;

  insert into public.booking_invoice_group_lines (group_id, booking_id, lodge_id, line_order)
  select v_group_id, u.booking_id, p_lodge_id, u.ordinality::integer
    from unnest(p_booking_ids) with ordinality as u(booking_id, ordinality);

  return jsonb_build_object('success', true, 'group_id', v_group_id,
    'group_key', p_group_key, 'invoice_number', v_invoice_number,
    'booking_ids', to_jsonb(p_booking_ids));
end;
$$;

revoke all on function public._create_public_booking_invoice_group(uuid, text, uuid, uuid[], text)
  from public, anon, authenticated;

-- Each child's token is generated independently at insert time. The first
-- child keeps v_confirmation_token, which is also the response token; later
-- children receive fresh UUID-derived tokens without changing that receipt.
do $$
declare
  v_def text;
  v_old text := E'      v_confirmation_token\n    );';
  v_new text := E'      case when array_length(v_booking_ids, 1) is null then v_confirmation_token\n           else replace(gen_random_uuid()::text, ''-'', '''') || replace(gen_random_uuid()::text, ''-'', '''') end\n    );';
  v_old_group text := E'    select public.create_booking_invoice_group(\n      v_lodge_id,\n      v_group_key,\n      v_customer_id,\n      v_booking_ids,\n      null,\n      ''Online multi-room booking request'',\n      null\n    ) into v_group_result;';
  v_new_group text := E'    select public._create_public_booking_invoice_group(\n      v_lodge_id, v_group_key, v_customer_id, v_booking_ids, v_idem_key\n    ) into v_group_result;';
  v_old_key text := E'    v_group_key := ''online-'' || replace(gen_random_uuid()::text, ''-'', '''');';
  v_new_key text := E'    v_group_key := ''online-'' || substring(encode(sha256(convert_to(''public-invoice-group:'' || v_lodge_id::text || '':'' || v_idem_key, ''UTF8'')), ''hex'') from 1 for 32);';
  v_occ integer;
begin
  if to_regprocedure('public.create_online_booking_legacy(text,jsonb)') is null then
    raise exception 'create_online_booking_legacy(text,jsonb) is missing; apply the public booking envelope migration first';
  end if;
  select pg_get_functiondef('public.create_online_booking_legacy(text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then
    raise exception 'Child-token patch expected one booking insert token, found %', v_occ;
  end if;
  v_def := replace(v_def, v_old, v_new);
  v_occ := (length(v_def) - length(replace(v_def, v_old_group, ''))) / length(v_old_group);
  if v_occ <> 1 then
    raise exception 'Public invoice helper patch expected one legacy group call, found %', v_occ;
  end if;
  v_def := replace(v_def, v_old_group, v_new_group);
  v_occ := (length(v_def) - length(replace(v_def, v_old_key, ''))) / length(v_old_key);
  if v_occ <> 1 then
    raise exception 'Public invoice group key patch expected one legacy key expression, found %', v_occ;
  end if;
  v_def := replace(v_def, v_old_key, v_new_key);
  execute v_def;
end $$;

-- Desktop staff use the anon API key with a signed x-boroko-session header.
-- Preserve that transport: the function body still requires a valid app
-- session, lodge role and rejects PWA sessions. Anonymous callers without a
-- staff session cannot perform the mutation.
revoke all on function public.create_booking_invoice_group(uuid, text, uuid, uuid[], text, text, uuid)
  from public;
grant execute on function public.create_booking_invoice_group(uuid, text, uuid, uuid[], text, text, uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
