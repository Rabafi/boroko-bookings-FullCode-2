-- Step A: Create payments table
-- Individual payment event records. Audit trail for all money received.
-- amount_paid on bookings remains the operational cache — updated ONLY via update_booking_payment RPC.
-- Existing bookings without payment rows continue to work correctly.

CREATE TABLE IF NOT EXISTS payments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  lodge_id         UUID        NOT NULL,
  amount           NUMERIC     NOT NULL CHECK (amount != 0),
  method           TEXT        NOT NULL DEFAULT 'cash',
  type             TEXT        NOT NULL DEFAULT 'payment'
                               CHECK (type IN ('deposit', 'payment', 'refund')),
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by      UUID,
  notes            TEXT        DEFAULT '',
  idempotency_key  TEXT        UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_booking_id_idx ON payments(booking_id);
CREATE INDEX IF NOT EXISTS payments_lodge_id_idx   ON payments(lodge_id);
