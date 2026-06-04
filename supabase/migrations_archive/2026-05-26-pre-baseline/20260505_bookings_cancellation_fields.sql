-- Add structured cancellation fields to bookings.
--
-- Previously, cancel_expired_pending_online_bookings() recorded the reason by
-- appending a [SYSTEM] string into the free-text notes column.  That makes
-- programmatic filtering impossible.  This migration adds two dedicated columns
-- and updates the expiry function to write them atomically alongside the
-- existing notes append (the notes behavior is preserved for human readability).
--
-- cancel_reason TEXT       -- machine-readable cancellation token
-- cancelled_at  TIMESTAMPTZ -- when the cancellation was applied
--
-- Both columns are nullable so all existing rows are unaffected.

alter table public.bookings
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamptz;

-- Partial index for fast lookup of cancelled bookings with a known reason.
create index if not exists bookings_cancel_reason_idx
  on public.bookings (lodge_id, cancel_reason)
  where cancel_reason is not null;

-- Re-create the expiry function to also populate the new columns.
create or replace function public.cancel_expired_pending_online_bookings()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_expired_count int;
begin
  with expired as (
    select id
      from public.bookings
     where status      = 'pending'
       and source      = 'online'
       and created_at  < (now() - interval '24 hours')
  )
  update public.bookings b
     set status        = 'cancelled',
         cancel_reason = 'expired_online_booking',
         cancelled_at  = now(),
         notes         = coalesce(b.notes, '')
                         || case when coalesce(b.notes, '') = '' then '' else e'\n' end
                         || '[SYSTEM] Automatically cancelled due to 24h expiration threshold for pending online requests.',
         updated_at    = now()
    from expired e
   where b.id = e.id;

  get diagnostics v_expired_count = row_count;

  if v_expired_count > 0 then
    raise log 'System: Expired % pending online bookings that exceeded 24h TTL.', v_expired_count;
  end if;

  return v_expired_count;
end;
$$;
