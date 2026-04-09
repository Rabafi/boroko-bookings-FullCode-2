-- Atomic invoice number generation per lodge per year.
-- Uses INSERT ... ON CONFLICT DO UPDATE which is atomic in PostgreSQL,
-- preventing duplicate invoice numbers under concurrent load.

CREATE TABLE IF NOT EXISTS invoice_sequences (
  lodge_id    uuid NOT NULL,
  year        int  NOT NULL,
  last_number int  NOT NULL DEFAULT 0,
  PRIMARY KEY (lodge_id, year)
);

CREATE OR REPLACE FUNCTION get_next_invoice_number(p_lodge_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_year int := EXTRACT(YEAR FROM NOW())::int;
  v_next int;
BEGIN
  INSERT INTO invoice_sequences (lodge_id, year, last_number)
  VALUES (p_lodge_id, v_year, 1)
  ON CONFLICT (lodge_id, year)
  DO UPDATE SET last_number = invoice_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN 'INV-' || v_year || '-' || LPAD(v_next::text, 4, '0');
END;
$$;
