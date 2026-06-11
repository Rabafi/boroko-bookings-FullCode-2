-- Add sort_order column to rooms table for custom room ordering.
-- The column is referenced by PostgREST/Supabase but does not exist,
-- causing "column rooms.sort_order does not exist" errors.

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;

-- Backfill sort_order based on current room_number ordering so existing
-- rooms get a sensible initial position.
UPDATE public.rooms
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY room_number) - 1 AS rn
  FROM public.rooms
) sub
WHERE public.rooms.id = sub.id
  AND public.rooms.sort_order = 0;
