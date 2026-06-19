-- Fleet health is a presence signal, not a live socket.
-- Active clients heartbeat every five minutes while open, but devices that are
-- closed overnight should not be reported as unhealthy after only ten minutes.

CREATE OR REPLACE FUNCTION public.get_fleet_health_rollup()
RETURNS TABLE (
  lodge_id       uuid,
  lodge_name     text,
  device_id      text,
  client_type    text,
  reported_at    timestamptz,
  stale          boolean,
  pending_queue  int,
  failed_queue   int,
  unresolved     int,
  sync_ready     boolean,
  last_sync_at   timestamptz,
  reconciliation text,
  top_faults     jsonb
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
    dh.lodge_id,
    COALESCE(s.lodge_name, s.company_name),
    dh.device_id,
    dh.client_type,
    dh.reported_at,
    (dh.reported_at < now() - interval '24 hours') AS stale,
    dh.pending_queue_count,
    dh.failed_queue_count,
    dh.unresolved_local_count,
    dh.replay_auth_ready,
    dh.last_successful_sync_at,
    dh.reconciliation_state,
    to_jsonb(dh.top_fault_types)
  FROM public.device_health_reports dh
  LEFT JOIN public.settings s ON s.lodge_id = dh.lodge_id
  ORDER BY
    (dh.failed_queue_count > 0) DESC,
    (dh.reported_at < now() - interval '24 hours') DESC,
    dh.reported_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_fleet_health_summary()
RETURNS TABLE (
  total_devices    bigint,
  healthy_devices  bigint,
  stale_devices    bigint,
  failed_devices   bigint,
  total_lodges     bigint
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
    COUNT(*) AS total_devices,
    COUNT(*) FILTER (
      WHERE reported_at >= now() - interval '24 hours'
        AND failed_queue_count = 0
    ) AS healthy_devices,
    COUNT(*) FILTER (WHERE reported_at < now() - interval '24 hours') AS stale_devices,
    COUNT(*) FILTER (WHERE failed_queue_count > 0) AS failed_devices,
    COUNT(DISTINCT lodge_id) AS total_lodges
  FROM public.device_health_reports;
END;
$$;

REVOKE ALL ON FUNCTION public.get_fleet_health_rollup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_fleet_health_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fleet_health_rollup() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fleet_health_summary() TO authenticated, service_role;
