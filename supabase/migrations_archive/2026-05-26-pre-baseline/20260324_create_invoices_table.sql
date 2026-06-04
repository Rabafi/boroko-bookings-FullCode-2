-- Step B: Create invoices table
-- Financial header entity. One invoice per booking.
-- All amounts (total, paid, balance, status) are derived — never stored here.
-- Existing bookings without invoice rows continue to work correctly.

CREATE TABLE IF NOT EXISTS invoices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT        UNIQUE,
  booking_id      UUID        NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  lodge_id        UUID        NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date        DATE,
  notes           TEXT        DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoices_booking_id_idx ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS invoices_lodge_id_idx   ON invoices(lodge_id);
