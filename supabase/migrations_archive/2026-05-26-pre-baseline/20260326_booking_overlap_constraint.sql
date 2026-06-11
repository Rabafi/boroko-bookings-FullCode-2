-- Add atomic room booking overlap constraint.
-- Prevents two confirmed/checked-in bookings from occupying the same room on overlapping dates.
-- Uses daterange with '[)' (lower-inclusive, upper-exclusive) so same-day checkout/checkin is allowed.
--
-- ⚠️  Before applying, verify no existing overlaps:
-- SELECT room_id, status, check_in, check_out, COUNT(*)
-- FROM bookings
-- WHERE status <> 'cancelled'
-- GROUP BY lodge_id, room_id, check_in, check_out
-- HAVING COUNT(*) > 1;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD CONSTRAINT no_overlapping_bookings
  EXCLUDE USING gist (
    lodge_id WITH =,
    room_id  WITH =,
    daterange(check_in::date, check_out::date, '[)') WITH &&
  )
  WHERE (status <> 'cancelled');
