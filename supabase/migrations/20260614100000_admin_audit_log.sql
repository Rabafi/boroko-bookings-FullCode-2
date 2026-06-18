-- ══════════════════════════════════════════════════════════════════════════════
-- Admin Audit Log: add actor tracking to activity_logs + audit RPC
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Role-check pattern: The Electron admin client authenticates via the
-- service_role key (app_is_service_role()). PWA super_admin users
-- authenticate via Supabase Auth + app_sessions (app_current_role()).
-- We allow either path.

-- 1. Add actor tracking columns to activity_logs
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id text;

-- 2. Index for fast actor-based queries
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_id ON public.activity_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON public.activity_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON public.activity_logs (action);

-- 3. RPC: log an admin audit entry (with actor tracking)
--    Called server-side only (SECURITY DEFINER, no user-facing role check needed)
CREATE OR REPLACE FUNCTION public.log_admin_audit(
  p_lodge_id text,
  p_lodge_name text,
  p_action text,
  p_actor_id uuid DEFAULT NULL,
  p_actor_email text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.activity_logs (
    lodge_id, lodge_name, action, actor_id, actor_email,
    entity_type, entity_id, details, created_at
  ) VALUES (
    p_lodge_id, p_lodge_name, p_action, p_actor_id, p_actor_email,
    p_entity_type, p_entity_id, p_details, now()
  );
END;
$$;

-- 4. RPC: get admin audit log with actor info (for the audit viewer)
CREATE OR REPLACE FUNCTION public.get_admin_audit_log(
  p_lodge_id text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  lodge_id text,
  lodge_name text,
  action text,
  actor_id uuid,
  actor_email text,
  entity_type text,
  entity_id text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role (Electron admin) OR super_admin session (PWA)
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: super_admin required';
  END IF;
  RETURN QUERY
  SELECT al.id, al.lodge_id, al.lodge_name, al.action,
         al.actor_id, al.actor_email, al.entity_type, al.entity_id,
         al.details, al.created_at
  FROM public.activity_logs al
  WHERE (p_lodge_id IS NULL OR al.lodge_id = p_lodge_id)
    AND (p_actor_id IS NULL OR al.actor_id = p_actor_id)
    AND (p_action IS NULL OR al.action = p_action)
    AND (p_start IS NULL OR al.created_at >= p_start)
    AND (p_end IS NULL OR al.created_at <= p_end)
  ORDER BY al.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 5. RPC: get audit summary stats (action counts by type)
CREATE OR REPLACE FUNCTION public.get_admin_audit_summary(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
)
RETURNS TABLE (
  action text,
  count bigint,
  last_at timestamptz
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
  SELECT al.action, COUNT(*) AS count, MAX(al.created_at) AS last_at
  FROM public.activity_logs al
  WHERE (p_start IS NULL OR al.created_at >= p_start)
    AND (p_end IS NULL OR al.created_at <= p_end)
  GROUP BY al.action
  ORDER BY count DESC;
END;
$$;

-- 6. Grant execute to authenticated/service_role (role checks enforced inside RPCs)
REVOKE ALL ON FUNCTION public.log_admin_audit(text, text, text, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_audit_log(text, uuid, text, timestamptz, timestamptz, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_audit_summary(timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_admin_audit(text, text, text, uuid, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_log(text, uuid, text, timestamptz, timestamptz, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_summary(timestamptz, timestamptz) TO authenticated, service_role;
