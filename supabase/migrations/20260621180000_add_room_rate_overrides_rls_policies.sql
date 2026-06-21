-- Add missing RLS policies for room_rate_overrides table.
-- The table has RLS enabled but zero policies defined.
-- Other lodge-scoped tables follow this pattern:
--   FOR SELECT/INSERT/UPDATE/DELETE USING (public.app_lodge_access(lodge_id))

DROP POLICY IF EXISTS room_rate_overrides_lodge_scope_select ON public.room_rate_overrides;
CREATE POLICY room_rate_overrides_lodge_scope_select ON public.room_rate_overrides
  FOR SELECT USING (public.app_lodge_access(lodge_id));

DROP POLICY IF EXISTS room_rate_overrides_lodge_scope_insert ON public.room_rate_overrides;
CREATE POLICY room_rate_overrides_lodge_scope_insert ON public.room_rate_overrides
  FOR INSERT WITH CHECK (public.app_lodge_access(lodge_id));

DROP POLICY IF EXISTS room_rate_overrides_lodge_scope_update ON public.room_rate_overrides;
CREATE POLICY room_rate_overrides_lodge_scope_update ON public.room_rate_overrides
  FOR UPDATE USING (public.app_lodge_access(lodge_id))
  WITH CHECK (public.app_lodge_access(lodge_id));

DROP POLICY IF EXISTS room_rate_overrides_lodge_scope_delete ON public.room_rate_overrides;
CREATE POLICY room_rate_overrides_lodge_scope_delete ON public.room_rate_overrides
  FOR DELETE USING (public.app_lodge_access(lodge_id));
