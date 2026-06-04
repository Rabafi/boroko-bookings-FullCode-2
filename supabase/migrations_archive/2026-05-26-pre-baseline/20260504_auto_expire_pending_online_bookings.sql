-- =============================================================================
-- Stabilization Step 3: Auto-Expire Pending Online Bookings
-- =============================================================================
-- Problem: Online bookings (source='online', status='pending') hold rooms
-- indefinitely if front-desk staff do not process them.
--
-- Solution: Add a scheduled function to automatically cancel these bookings
-- if they are older than 24 hours. Because availability constraints and queries
-- universally ignore 'cancelled' bookings (`status != 'cancelled'`), this securely
-- frees up the room. Confirmed/checked_in bookings, and offline desktop bookings
-- (which lack source='online' or status='pending' by default), are untouched.
-- =============================================================================

begin;

create or replace function public.cancel_expired_pending_online_bookings()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_expired_count int;
begin
  -- Automatically cancel pending online bookings older than 24 hours
  with expired as (
    select id
      from public.bookings
     where status = 'pending'
       and source = 'online'
       and created_at < (now() - interval '24 hours')
  )
  update public.bookings b
     set status = 'cancelled',
         notes = coalesce(b.notes, '') || case when coalesce(b.notes, '') = '' then '' else e'\n' end || '[SYSTEM] Automatically cancelled due to 24h expiration threshold for pending online requests.',
         updated_at = now()
    from expired e
   where b.id = e.id;

  get diagnostics v_expired_count = row_count;

  -- Emit a Postgres log for observability/audit
  if v_expired_count > 0 then
    raise log 'System: Expired % pending online bookings that exceeded 24h TTL.', v_expired_count;
  end if;

  return v_expired_count;
end;
$$;

-- Schedule the job via pg_cron if available (Supabase standard)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- Unschedule if it already exists to avoid duplication
      perform cron.unschedule('cancel-expired-pending-online-bookings');
    exception
      when others then null;
    end;

    -- Schedule to run every hour at minute 0
    perform cron.schedule(
      'cancel-expired-pending-online-bookings',
      '0 * * * *',
      'select public.cancel_expired_pending_online_bookings();'
    );
  end if;
end;
$$;

commit;
