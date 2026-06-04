-- Drop the 7-parameter overload of update_booking_payment.
--
-- Background:
--   20260426_financial_integrity_followups.sql introduced two overloads:
--     • 7-param: (uuid, uuid, numeric, text, text, text, uuid)
--     • 8-param: (uuid, uuid, numeric, text, text, text, uuid, timestamptz)
--       where the 8th parameter p_expected_updated_at defaults to null.
--
--   When convert_quotation_to_booking calls update_booking_payment with 7
--   positional arguments and the 5th literal ('deposit') is untyped (Postgres
--   infers type 'unknown'), both overloads are candidates and Postgres raises:
--     "function public.update_booking_payment(..., unknown, ...) is not unique"
--
--   The 7-param overload is fully superseded by the 8-param version: any call
--   that worked with 7 args works identically with the 8-param overload because
--   p_expected_updated_at defaults to null (no conflict guard triggered).
--   Dropping the 7-param overload removes the ambiguity permanently without
--   changing observable behaviour for any existing caller.
--
--   NOTE: DROP FUNCTION also removes all associated ACL entries — no separate
--   REVOKE is needed or possible after the drop.

drop function if exists public.update_booking_payment(
  uuid, uuid, numeric, text, text, text, uuid
);
