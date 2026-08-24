-- 2026-08-20 — Keep Open Tabs operationally visible when a row's amount is
-- not certifiable yet.
--
-- A held tab can legitimately contain only unit_price/quantity line data.
-- The server must continue to mark that row's financial_complete value false
-- so the UI withholds totals, but that row is still a valid server-confirmed
-- operational tab and must appear in Open Tabs. The previous function used
-- the per-row financial flag as the top-level read-complete flag, causing the
-- desktop to reject the entire server snapshot and fall back to a local cache.

begin;

create or replace function public.get_restaurant_pos_tabs_financial_truth_unscoped(
  p_lodge_id uuid,
  p_outlet_id uuid default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_financial_complete boolean;
begin
  if p_lodge_id is null or not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_outlet_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (
      select
        t.*,
        s.subtotal,
        s.discount_total,
        s.tax_total,
        s.tip_total,
        s.total,
        s.financial_complete,
        t.tab_version as version,
        (s.total - s.subtotal) as adjustment_total
      from public.pos_tabs t
      left join lateral (
        select
          case
            when count(*) > 0
              and count(*) = count(coalesce(nullif(value->>'line_subtotal', '')::numeric, nullif(value->>'subtotal', '')::numeric))
            then round(sum(coalesce(nullif(value->>'line_subtotal', '')::numeric, nullif(value->>'subtotal', '')::numeric)), 2)
            else null
          end subtotal,
          round(coalesce(sum(coalesce(nullif(value->>'discount', '')::numeric, 0)), 0), 2) discount_total,
          round(coalesce(sum(coalesce(nullif(value->>'tax', '')::numeric, nullif(value->>'tax_amount', '')::numeric, 0)), 0), 2) tax_total,
          round(coalesce(sum(coalesce(nullif(value->>'tip', '')::numeric, nullif(value->>'tip_amount', '')::numeric, 0)), 0), 2) tip_total,
          case
            when count(*) > 0
              and count(*) = count(coalesce(nullif(value->>'line_total', '')::numeric, nullif(value->>'total', '')::numeric))
            then round(sum(coalesce(nullif(value->>'line_total', '')::numeric, nullif(value->>'total', '')::numeric)), 2)
            else null
          end total,
          count(*) > 0
            and count(*) = count(coalesce(nullif(value->>'line_subtotal', '')::numeric, nullif(value->>'subtotal', '')::numeric))
            and count(*) = count(coalesce(nullif(value->>'line_total', '')::numeric, nullif(value->>'total', '')::numeric))
            financial_complete
        from jsonb_array_elements(coalesce(t.items, '[]'::jsonb))
      ) s on true
      where t.lodge_id = p_lodge_id
        and (p_outlet_id is null or t.outlet_id = p_outlet_id)
        and (
          nullif(btrim(p_status), '') is null
          or (lower(p_status) = 'active' and t.status in ('open', 'running', 'ready', 'delivered'))
          or (lower(p_status) <> 'active' and t.status = lower(p_status))
        )
    ) x;

  select coalesce(
    (select bool_and(coalesce((row->>'financial_complete')::boolean, false))
       from jsonb_array_elements(v_rows) row),
    true
  ) into v_financial_complete;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'source', 'server-authoritative-pos-tab-rpc',
    -- complete means the requested operational row set was read completely.
    -- Financial certification remains row-scoped and is surfaced separately.
    'complete', true,
    'financial_complete', v_financial_complete
  );
end;
$$;

revoke all on function public.get_restaurant_pos_tabs_financial_truth_unscoped(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_pos_tabs_financial_truth_unscoped(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
