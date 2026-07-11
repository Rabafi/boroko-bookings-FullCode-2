-- Channel sync must not be marked completed until a real OTA provider confirms delivery.
-- This replaces the foundation queue processor with a fail-closed manual-review boundary.

create or replace function public.process_channel_sync_queue(
  p_lodge_id uuid,
  p_channel_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_required int := 0;
  v_item record;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  for v_item in
    select *
    from public.enterprise_channel_sync_items
    where lodge_id = p_lodge_id
      and status = 'queued'
      and (p_channel_key is null or channel_key = p_channel_key)
    order by created_at asc
    limit 50
  loop
    update public.enterprise_channel_sync_items
    set status = 'manual_review_required',
        error = 'Live OTA provider adapter is not connected. This sync item was not sent and must remain in manual review until provider confirmation exists.',
        updated_at = now()
    where id = v_item.id;

    v_review_required := v_review_required + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'processed', 0,
    'failed', 0,
    'manual_review_required', v_review_required,
    'provider_connected', false,
    'message', 'No live OTA provider adapter is connected; queued sync items were moved to manual review, not completed.'
  );
end;
$$;

grant execute on function public.process_channel_sync_queue(uuid, text) to authenticated;
