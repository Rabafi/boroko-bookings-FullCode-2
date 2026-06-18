-- ══════════════════════════════════════════════════════════════════════════════
-- Admin Notification Inbox: persistent notifications with read/unread state
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Role-check pattern: service_role (Electron admin) OR super_admin session (PWA).

-- 1. Notifications table
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id          uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  type        text NOT NULL DEFAULT 'info',     -- info | warning | error | success | action_required
  title       text NOT NULL,
  body        text,
  entity_type text,                              -- company | license | invoice | ticket | feature | system
  entity_id   text,
  lodge_id    text,
  lodge_name  text,
  action_url  text,                              -- optional deep-link hint
  actor_email text,                              -- who triggered it
  read_at     timestamptz,                       -- NULL = unread
  created_at  timestamptz DEFAULT now() NOT NULL
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_admin_notifications_read   ON public.admin_notifications (read_at);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_type   ON public.admin_notifications (type);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_lodge  ON public.admin_notifications (lodge_id);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created ON public.admin_notifications (created_at DESC);

-- 3. RPC: create a notification (server-side only, with role enforcement)
CREATE OR REPLACE FUNCTION public.create_admin_notification(
  p_title       text,
  p_type        text DEFAULT 'info',
  p_body        text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id   text DEFAULT NULL,
  p_lodge_id    text DEFAULT NULL,
  p_lodge_name  text DEFAULT NULL,
  p_action_url  text DEFAULT NULL,
  p_actor_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Only service_role or super_admin may create notifications
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: super_admin required';
  END IF;
  IF nullif(btrim(coalesce(p_title, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Notification title is required';
  END IF;
  INSERT INTO public.admin_notifications (
    type, title, body, entity_type, entity_id,
    lodge_id, lodge_name, action_url, actor_email
  ) VALUES (
    p_type, p_title, p_body, p_entity_type, p_entity_id,
    p_lodge_id, p_lodge_name, p_action_url, p_actor_email
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 4. RPC: list notifications (with filters)
CREATE OR REPLACE FUNCTION public.get_admin_notifications(
  p_unread_only boolean DEFAULT false,
  p_type        text DEFAULT NULL,
  p_limit       int DEFAULT 50,
  p_offset      int DEFAULT 0
)
RETURNS TABLE (
  id          uuid,
  type        text,
  title       text,
  body        text,
  entity_type text,
  entity_id   text,
  lodge_id    text,
  lodge_name  text,
  action_url  text,
  actor_email text,
  read_at     timestamptz,
  created_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: super_admin required';
  END IF;
  RETURN QUERY
  SELECT n.id, n.type, n.title, n.body, n.entity_type, n.entity_id,
         n.lodge_id, n.lodge_name, n.action_url, n.actor_email,
         n.read_at, n.created_at
  FROM public.admin_notifications n
  WHERE (p_unread_only = false OR n.read_at IS NULL)
    AND (p_type IS NULL OR n.type = p_type)
  ORDER BY n.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 5. RPC: mark notification(s) as read
CREATE OR REPLACE FUNCTION public.mark_admin_notifications_read(
  p_ids uuid[] DEFAULT NULL  -- NULL = mark ALL as read
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: super_admin required';
  END IF;
  IF p_ids IS NULL THEN
    UPDATE public.admin_notifications SET read_at = now() WHERE read_at IS NULL;
  ELSE
    UPDATE public.admin_notifications SET read_at = now() WHERE id = ANY(p_ids) AND read_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 6. RPC: get unread count
CREATE OR REPLACE FUNCTION public.get_admin_notification_count()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: super_admin required';
  END IF;
  RETURN (SELECT COUNT(*)::int FROM public.admin_notifications WHERE read_at IS NULL);
END;
$$;

-- 7. RPC: delete old notifications (cleanup)
CREATE OR REPLACE FUNCTION public.cleanup_admin_notifications(p_older_than_days int DEFAULT 90)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: super_admin required';
  END IF;
  DELETE FROM public.admin_notifications
  WHERE created_at < now() - (p_older_than_days || ' days')::interval
    AND read_at IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 8. RLS: restrict to super_admins only
--    service_role bypasses RLS entirely (defense-in-depth for direct table access).
--    PWA users must have super_admin role in public.users.
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage notifications" ON public.admin_notifications;
CREATE POLICY "Super admins can manage notifications"
  ON public.admin_notifications FOR ALL
  USING (
    public.app_is_service_role()
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    public.app_is_service_role()
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.role = 'super_admin'
    )
  );

-- 9. Grants
REVOKE ALL ON FUNCTION public.create_admin_notification(text,text,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_notifications(boolean,text,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_admin_notifications_read(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_notification_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_admin_notifications(int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_admin_notification(text,text,text,text,text,text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_notifications(boolean,text,int,int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_admin_notifications_read(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_count() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_admin_notifications(int) TO authenticated, service_role;
