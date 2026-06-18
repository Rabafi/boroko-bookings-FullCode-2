-- Fix auth_rls_initplan on admin_notifications:
-- Wrap auth.uid() in (SELECT ...) so it's evaluated once, not per-row.
DROP POLICY IF EXISTS "Super admins can manage notifications" ON public.admin_notifications;
CREATE POLICY "Super admins can manage notifications"
  ON public.admin_notifications FOR ALL
  USING (
    public.app_is_service_role()
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = (SELECT auth.uid()) AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    public.app_is_service_role()
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = (SELECT auth.uid()) AND u.role = 'super_admin'
    )
  );

-- Fix duplicate_index on pos_tabs:
-- Drop the duplicate index (pos_tabs_one_open_table_uidx is identical to
-- pos_tabs_one_active_table_per_outlet).
DROP INDEX IF EXISTS public.pos_tabs_one_open_table_uidx;
