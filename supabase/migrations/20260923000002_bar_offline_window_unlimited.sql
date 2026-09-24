-- Bar offline trading window: effectively no age limit (owner-approved).
--
-- create_pos_order_v3 refuses replays older than
-- settings.pos_offline_trading_hours (default 72h; Bar bumped to 1440h =
-- 60 days by 20260816200000). A Bar back from a 3-month outage gets
-- catalog_refresh_required + manual_review_required on every old sale, and
-- the desktop parks each one for a manager who can never review thousands
-- by hand. The owner requires every Bar sale to sync ("all sales even
-- beyond 60 days need to be synced").
--
-- Design:
--   * Bar-only lodges move to 87600h (10 years: effectively no age limit
--     while keeping the same check shape). Missing snapshots, wrong
--     lodge/outlet snapshots, and future device timestamps still refuse
--     exactly as before.
--   * The trigger keeps operator choice above the floor: it only raises
--     values below 87600h for bar_only lodges, never lowers a higher one.
--   * Other products keep 72h default; per-lodge overrides still work.
--   * Existing Bar rows at 1440h are backfilled to 87600h in the same
--     transaction.
--   * No GRANT/REVOKE in this file: CREATE OR REPLACE preserves ACLs.
--   * Deployment needs operator go-ahead (db:push). No relaunch needed for
--     the server change; queued old sales drain on next sync.

begin;

-- Guard: predecessor trigger function must exist.
do $guard$
begin
  if to_regprocedure('public.apply_bar_offline_trading_window()') is null then
    raise exception 'Missing predecessor: public.apply_bar_offline_trading_window/0';
  end if;
end;
$guard$;

create or replace function public.apply_bar_offline_trading_window()
returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(new.operating_profile, '{}'::jsonb)->>'hospitality_mode' = 'bar_only'
     and coalesce(new.pos_offline_trading_hours, 72) < 87600 then
    new.pos_offline_trading_hours := 87600;
  end if;
  return new;
end
$$;

-- Backfill Bar rows currently below the new floor (e.g. the 1440h cohort).
-- Non-Bar rows untouched. Operator-raised values above the floor untouched.
update public.settings
   set pos_offline_trading_hours = 87600
 where coalesce(operating_profile, '{}'::jsonb)->>'hospitality_mode' = 'bar_only'
   and coalesce(pos_offline_trading_hours, 72) < 87600;

commit;
