begin;

create or replace function public.update_customer(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.customers
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    email = case when payload ? 'email' then coalesce(payload->>'email', '') else email end,
    phone = case when payload ? 'phone' then coalesce(payload->>'phone', '') else phone end,
    id_number = case when payload ? 'id_number' then coalesce(payload->>'id_number', '') else id_number end,
    nationality = case when payload ? 'nationality' then coalesce(payload->>'nationality', '') else nationality end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Customer not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_customer(uuid, uuid, jsonb, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
