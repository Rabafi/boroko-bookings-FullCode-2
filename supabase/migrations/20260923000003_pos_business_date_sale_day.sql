-- POS business_date: prefer the original sale day (owner + accounting approved).
--
-- assign_pos_daily_order_number derives business_date from created_at, which
-- the order RPC leaves as now() at receive time. Weeks-old offline replays
-- therefore land on reconnect day: reconnect cash-up/revenue/tax inflate
-- while origin days under-report, and daily_order_number sequences collide
-- on one date. The owner approved posting old sales to their original sale
-- day ("Change dates").
--
-- Design:
--   * Explicit new.business_date still wins (direct writes unaffected).
--   * Otherwise prefer new.client_created_at when sane: present and not more
--     than 5 minutes in the future (same future-guard the order RPC uses).
--     Fall back to created_at exactly as before.
--   * No lower age bound here: the order RPC already enforces the trading
--     window, and the trigger must not strand direct/legacy inserts.
--   * Moves with business_date automatically: daily sequences/numbers
--     (R-/RET-), per-order GL entry_date/source business_date. Batch GL that
--     groups by created_at day is a known separate divergence (see plan note
--     below) and is NOT changed here.
--   * Plan note: 20260717020000/20260718010000 batch posters still group by
--     created_at day. Reconcile them in a follow-up if day-level GL parity is
--     required; per-order postings are correct after this change.
--   * No GRANT/REVOKE in this file: CREATE OR REPLACE preserves ACLs
--     (original grants in 20260716030000:108-109 untouched).
--   * Deployment needs operator go-ahead (db:push).

begin;

-- Guard: predecessor trigger function must exist.
do $guard$
begin
  if to_regprocedure('public.assign_pos_daily_order_number()') is null then
    raise exception 'Missing predecessor: public.assign_pos_daily_order_number/0';
  end if;
end;
$guard$;

create or replace function public.assign_pos_daily_order_number()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_business_date date; v_daily_number integer;
begin
  v_business_date := coalesce(
    new.business_date,
    public.pos_business_date_at(new.lodge_id,
      case when new.client_created_at is not null
            and new.client_created_at <= now() + interval '5 minutes'
           then new.client_created_at
           else coalesce(new.created_at, now())
      end)
  );
  new.business_date := v_business_date;
  if new.daily_order_number is null then
    insert into public.pos_daily_order_sequences (lodge_id, business_date, last_number)
    values (new.lodge_id, v_business_date, 1)
    on conflict (lodge_id, business_date)
    do update set last_number = public.pos_daily_order_sequences.last_number + 1
    returning last_number into v_daily_number;
    new.daily_order_number := v_daily_number;
  end if;
  new.order_number := coalesce(new.order_number, lpad(new.daily_order_number::text, 4, '0'));
  new.receipt_number := coalesce(new.receipt_number,
    case when coalesce(new.transaction_type,'sale')='return' then 'RET-' else 'R-' end
    || lpad(new.daily_order_number::text, 4, '0'));
  return new;
end; $$;

commit;
