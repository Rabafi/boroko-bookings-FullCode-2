-- Surface intelligence needs health reports from every installed/routed client,
-- not only the desktop app and manager PWA.

ALTER TABLE public.device_health_reports
  DROP CONSTRAINT IF EXISTS device_health_reports_client_type_check;

ALTER TABLE public.device_health_reports
  ADD CONSTRAINT device_health_reports_client_type_check
  CHECK (
    client_type = ANY (
      ARRAY[
        'desktop'::text,
        'pwa'::text,
        'legacy_pos'::text,
        'bookings_site'::text,
        'marketing_site'::text
      ]
    )
  );

CREATE INDEX IF NOT EXISTS idx_device_health_reports_client_type_reported
  ON public.device_health_reports (client_type, reported_at DESC);
