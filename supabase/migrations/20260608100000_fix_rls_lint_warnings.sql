-- Fix auth_rls_initplan: wrap auth.uid() in (SELECT ...) to force initplan
-- This prevents per-row re-evaluation of auth.uid()
DROP POLICY IF EXISTS "lodge members can manage device health" ON public.device_health_reports;
CREATE POLICY "lodge members can manage device health" ON public.device_health_reports
  FOR ALL
  USING ((SELECT auth.uid() IS NOT NULL))
  WITH CHECK ((SELECT auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS lodge_read_rejected_bookings ON public.rejected_online_bookings;
CREATE POLICY lodge_read_rejected_bookings ON public.rejected_online_bookings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (SELECT auth.uid())
        AND u.lodge_id = rejected_online_bookings.lodge_id
    )
  );

-- Fix multiple_permissive_policies: drop blanket "Allow all" policies
-- and replace with explicit lodge-scoped DML policies

-- Bookings
DROP POLICY IF EXISTS "Allow all" ON public.bookings;
DROP POLICY IF EXISTS bookings_lodge_scope_insert ON public.bookings;
CREATE POLICY bookings_lodge_scope_insert ON public.bookings
  FOR INSERT WITH CHECK (public.app_lodge_access(lodge_id));
DROP POLICY IF EXISTS bookings_lodge_scope_update ON public.bookings;
CREATE POLICY bookings_lodge_scope_update ON public.bookings
  FOR UPDATE USING (public.app_lodge_access(lodge_id))
  WITH CHECK (public.app_lodge_access(lodge_id));
DROP POLICY IF EXISTS bookings_lodge_scope_delete ON public.bookings;
CREATE POLICY bookings_lodge_scope_delete ON public.bookings
  FOR DELETE USING (public.app_lodge_access(lodge_id));

-- Customers
DROP POLICY IF EXISTS "Allow all" ON public.customers;
DROP POLICY IF EXISTS customers_lodge_scope_insert ON public.customers;
CREATE POLICY customers_lodge_scope_insert ON public.customers
  FOR INSERT WITH CHECK (public.app_lodge_access(lodge_id));
DROP POLICY IF EXISTS customers_lodge_scope_update ON public.customers;
CREATE POLICY customers_lodge_scope_update ON public.customers
  FOR UPDATE USING (public.app_lodge_access(lodge_id))
  WITH CHECK (public.app_lodge_access(lodge_id));
DROP POLICY IF EXISTS customers_lodge_scope_delete ON public.customers;
CREATE POLICY customers_lodge_scope_delete ON public.customers
  FOR DELETE USING (public.app_lodge_access(lodge_id));

-- Rooms
DROP POLICY IF EXISTS "Allow all" ON public.rooms;
DROP POLICY IF EXISTS rooms_lodge_scope_insert ON public.rooms;
CREATE POLICY rooms_lodge_scope_insert ON public.rooms
  FOR INSERT WITH CHECK (public.app_lodge_access(lodge_id));
DROP POLICY IF EXISTS rooms_lodge_scope_update ON public.rooms;
CREATE POLICY rooms_lodge_scope_update ON public.rooms
  FOR UPDATE USING (public.app_lodge_access(lodge_id))
  WITH CHECK (public.app_lodge_access(lodge_id));
DROP POLICY IF EXISTS rooms_lodge_scope_delete ON public.rooms;
CREATE POLICY rooms_lodge_scope_delete ON public.rooms
  FOR DELETE USING (public.app_lodge_access(lodge_id));

-- Settings (already has INSERT/SELECT/UPDATE policies)
DROP POLICY IF EXISTS "Allow all" ON public.settings;

-- Users
DROP POLICY IF EXISTS "Allow all" ON public.users;
DROP POLICY IF EXISTS users_lodge_scope_insert ON public.users;
CREATE POLICY users_lodge_scope_insert ON public.users
  FOR INSERT WITH CHECK (public.app_lodge_access(lodge_id));
DROP POLICY IF EXISTS users_lodge_scope_update ON public.users;
CREATE POLICY users_lodge_scope_update ON public.users
  FOR UPDATE USING (public.app_lodge_access(lodge_id))
  WITH CHECK (public.app_lodge_access(lodge_id));
DROP POLICY IF EXISTS users_lodge_scope_delete ON public.users;
CREATE POLICY users_lodge_scope_delete ON public.users
  FOR DELETE USING (public.app_lodge_access(lodge_id));
