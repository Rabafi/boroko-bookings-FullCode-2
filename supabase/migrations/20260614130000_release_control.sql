-- ══════════════════════════════════════════════════════════════════════════════
-- Release Control: auto-expire feature overrides + scheduled releases viewer
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Role-check pattern: service_role (Electron admin) OR super_admin session (PWA).
-- Joins against public.settings (not lodge) for lodge names.
-- Uses lodge_features columns: lodge_id, feature_name, enabled, reason,
--   expires_at, review_at, granted_by, granted_at.

-- 1. Auto-expire features past their expires_at
CREATE OR REPLACE FUNCTION public.expire_overdue_features()
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
  UPDATE public.lodge_features
  SET enabled = false,
      updated_at = now()
  WHERE enabled = true
    AND expires_at IS NOT NULL
    AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 2. Get scheduled releases (features with future expiry or review dates)
CREATE OR REPLACE FUNCTION public.get_scheduled_releases()
RETURNS TABLE (
  lodge_id      uuid,
  lodge_name    text,
  feature_name  text,
  enabled       boolean,
  reason        text,
  expires_at    timestamptz,
  review_at     timestamptz,
  granted_by    uuid,
  granted_at    timestamptz,
  status        text
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
  SELECT
    lf.lodge_id,
    s.lodge_name,
    lf.feature_name,
    lf.enabled,
    lf.reason,
    lf.expires_at,
    lf.review_at,
    lf.granted_by,
    lf.granted_at,
    CASE
      WHEN lf.expires_at IS NOT NULL AND lf.expires_at <= now() THEN 'expired'
      WHEN lf.expires_at IS NOT NULL AND lf.expires_at > now() THEN 'scheduled'
      ELSE 'active'
    END AS status
  FROM public.lodge_features lf
  LEFT JOIN public.settings s ON s.lodge_id = lf.lodge_id
  WHERE lf.expires_at IS NOT NULL OR lf.review_at IS NOT NULL
  ORDER BY
    CASE WHEN lf.expires_at IS NOT NULL AND lf.expires_at <= now() THEN 0 ELSE 1 END,
    COALESCE(lf.expires_at, lf.review_at) ASC;
END;
$$;

-- 3. Grants
GRANT EXECUTE ON FUNCTION public.expire_overdue_features() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scheduled_releases() TO authenticated;
