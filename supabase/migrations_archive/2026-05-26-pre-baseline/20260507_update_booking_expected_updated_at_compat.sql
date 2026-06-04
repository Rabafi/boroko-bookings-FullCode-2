-- Expose the optimistic-concurrency update_booking signature used by desktop replay.
-- The canonical implementation stores expected_updated_at inside payload; this
-- overload preserves the app/RPC contract and delegates to the canonical path.

create or replace function public.update_booking(
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
begin
  return public.update_booking(
    p_id,
    p_lodge_id,
    case
      when p_expected_updated_at is null then coalesce(payload, '{}'::jsonb)
      else coalesce(payload, '{}'::jsonb) || jsonb_build_object('expected_updated_at', p_expected_updated_at)
    end
  );
end;
$function$;

grant execute on function public.update_booking(uuid, uuid, jsonb, timestamptz) to anon, authenticated, service_role;
