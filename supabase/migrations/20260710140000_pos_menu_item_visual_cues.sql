-- POS menu item visual cues: dietary flags, prep time, popularity tracking
-- Adds columns to support kitchen staff visual cues on the terminal grid.
-- Does NOT replace existing RPCs — the new columns have safe defaults and are
-- handled by the existing create/update functions via JSONB payload spread.

ALTER TABLE public.pos_menu_items
  ADD COLUMN IF NOT EXISTS dietary_flags jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prep_time_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_popular boolean DEFAULT false;

COMMENT ON COLUMN public.pos_menu_items.dietary_flags IS 'Array of dietary labels, e.g. ["vegetarian","gluten-free"]. Rendered as badges on POS terminal cards.';
COMMENT ON COLUMN public.pos_menu_items.prep_time_minutes IS 'Estimated preparation time in minutes. Displayed as a clock icon on POS terminal cards.';
COMMENT ON COLUMN public.pos_menu_items.is_popular IS 'Operator-set flag for high-volume items. Displayed as a flame badge on POS terminal cards.';
