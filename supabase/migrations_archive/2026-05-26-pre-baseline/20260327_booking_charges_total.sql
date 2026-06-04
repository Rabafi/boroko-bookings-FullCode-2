-- P4-2: Add charges_total to bookings for canonical balance accuracy
-- All balance calculations must use total_amount + charges_total, not total_amount alone.

-- 1. Add column (idempotent)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS charges_total NUMERIC NOT NULL DEFAULT 0;

-- 2. Backfill existing rows from booking_charges
UPDATE public.bookings b
SET charges_total = GREATEST(0, (
  SELECT COALESCE(SUM(amount), 0)
  FROM public.booking_charges
  WHERE booking_id = b.id
));

-- 3. Trigger function: recompute charges_total after any charge write.
--    GREATEST(0, ...) clamps against negative total (bad data / rounding).
--    COALESCE(SUM(...), 0) guards against NULL when no charges remain.
CREATE OR REPLACE FUNCTION public.sync_booking_charges_total()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.bookings
  SET charges_total = GREATEST(0, (
    SELECT COALESCE(SUM(amount), 0)
    FROM public.booking_charges
    WHERE booking_id = COALESCE(NEW.booking_id, OLD.booking_id)
  ))
  WHERE id = COALESCE(NEW.booking_id, OLD.booking_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 4. Attach trigger to booking_charges (replace if already exists)
DROP TRIGGER IF EXISTS trg_sync_charges_total ON public.booking_charges;
CREATE TRIGGER trg_sync_charges_total
AFTER INSERT OR UPDATE OR DELETE ON public.booking_charges
FOR EACH ROW EXECUTE FUNCTION public.sync_booking_charges_total();
