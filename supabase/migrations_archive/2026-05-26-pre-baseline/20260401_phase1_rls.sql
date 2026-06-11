begin;

do $$
declare
  v_table text;
  v_policy_prefix text;
  v_has_lodge_id boolean;
  v_target_tables text[] := array[
    'users',
    'settings',
    'rooms',
    'customers',
    'bookings',
    'payments',
    'invoices',
    'booking_charges',
    'quotations',
    'expenses',
    'maintenance_tickets',
    'lodge_features',
    'inventory_items',
    'conference_bookings',
    'pool_day_use',
    'push_subscriptions',
    'pos_orders'
  ];
begin
  foreach v_table in array v_target_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', v_table);

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table
        and column_name = 'lodge_id'
    )
    into v_has_lodge_id;

    if not v_has_lodge_id then
      continue;
    end if;

    v_policy_prefix := format('%s_lodge_scope', v_table);

    execute format('drop policy if exists %I_select on public.%I', v_policy_prefix, v_table);
    execute format(
      'create policy %I_select on public.%I for select using (public.app_lodge_access(lodge_id))',
      v_policy_prefix,
      v_table
    );

    if v_table in ('settings', 'push_subscriptions') then
      execute format('drop policy if exists %I_insert on public.%I', v_policy_prefix, v_table);
      execute format(
        'create policy %I_insert on public.%I for insert with check (public.app_lodge_access(lodge_id))',
        v_policy_prefix,
        v_table
      );
    end if;

    if v_table = 'settings' then
      execute format('drop policy if exists %I_update on public.%I', v_policy_prefix, v_table);
      execute format(
        'create policy %I_update on public.%I for update using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id))',
        v_policy_prefix,
        v_table
      );
    end if;

    if v_table = 'push_subscriptions' then
      execute format('drop policy if exists %I_update on public.%I', v_policy_prefix, v_table);
      execute format(
        'create policy %I_update on public.%I for update using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id))',
        v_policy_prefix,
        v_table
      );

      execute format('drop policy if exists %I_delete on public.%I', v_policy_prefix, v_table);
      execute format(
        'create policy %I_delete on public.%I for delete using (public.app_lodge_access(lodge_id))',
        v_policy_prefix,
        v_table
      );
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
