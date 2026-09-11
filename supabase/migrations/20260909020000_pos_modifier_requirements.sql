-- Mandatory server enforcement of required modifier choices.
-- Minimum-selection rules live on pos_modifier_groups; previously only the
-- Till modal checked them, so any sale that never opened Options (or any
-- direct RPC caller) could post a sale missing required choices. This
-- BEFORE INSERT trigger enforces the same applicability the Till uses
-- (active groups whose categories are empty, "all", or the line category)
-- for every writer: desktop, Legacy POS, offline replay, and direct RPCs.
--
-- Scope is deliberately narrow and reversal-safe:
-- * only rows with quantity > 0 and a JSON-array modifiers value;
-- * reversal/void rows (quantity <= 0) and legacy rows without a modifiers
--   array pass untouched;
-- * previously committed idempotent replays return before mutation in the
--   claim-first settlement path, so they never reach this trigger twice.
-- Client Hold/Pay validation and domain pre-checks remain as earlier,
-- user-friendly layers; this trigger is the authoritative boundary.

begin;

create or replace function public.enforce_pos_modifier_requirements()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_group record;
  v_selected integer;
  v_line_category text:=lower(coalesce(btrim(NEW.category), ''));
  v_modifiers jsonb:=NEW.modifiers;
begin
  -- Only new-shape sale rows are in scope. Reversal/void rows
  -- (quantity <= 0) pass untouched. Malformed modifier values on new sale
  -- rows are rejected rather than treated as legacy exemptions: the
  -- checkout contract always resolves modifiers to a JSON array.
  if coalesce(NEW.quantity, 0) <= 0 then return NEW; end if;
  if jsonb_typeof(coalesce(v_modifiers, 'null'::jsonb)) <> 'array' then
    raise exception 'Sale line modifiers must be a JSON array' using errcode='P0001';
  end if;

  for v_group in
    select g.id, g.name, g.min_selections, g.options
      from public.pos_modifier_groups g
     where g.lodge_id = NEW.lodge_id
       and coalesce(g.active, true) = true
       and coalesce(g.min_selections, 0) > 0
       and (
         coalesce(array_length(g.applies_to_categories, 1), 0) = 0
         or exists (
           select 1 from unnest(g.applies_to_categories) c
            where lower(btrim(c)) in ('all', v_line_category)
         )
       )
  loop
    -- Count distinct selections attributed to this group: explicit
    -- group_id wins; otherwise the selection must match a known option id.
    select count(*) into v_selected
      from jsonb_array_elements(v_modifiers) sel(line)
     where (sel.line->>'group_id' = v_group.id::text)
        or (
             (sel.line->>'group_id' is null)
             and exists (
               select 1 from jsonb_array_elements(coalesce(v_group.options, '[]'::jsonb)) opt(value)
                where opt.value->>'id' = sel.line->>'id'
             )
           );
    if v_selected < v_group.min_selections then
      raise exception 'Complete required choices: %', v_group.name using errcode='P0001';
    end if;
  end loop;
  return NEW;
end
$$;

drop trigger if exists trg_pos_order_items_modifier_requirements on public.pos_order_items;
create trigger trg_pos_order_items_modifier_requirements
  before insert on public.pos_order_items
  for each row execute function public.enforce_pos_modifier_requirements();

-- Authoritative tab-save coverage: held tabs store their lines in
-- pos_tabs.items, so the same minimum-selection rule runs there for every
-- writer (desktop holds, offline replays, direct RPC callers). Scoped to
-- INSERT only: server transfer/split rewrites of pre-existing tabs must not
-- be blocked by requirements introduced after those tabs were held.
-- Re-holds flow through client + domain validation on their new input.
-- Reversal semantics do not apply to held lines; malformed items arrays
-- are rejected.
create or replace function public.enforce_pos_tab_modifier_requirements()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_line jsonb;
  v_group record;
  v_selected integer;
  v_line_category text;
  v_line_modifiers jsonb;
begin
  if jsonb_typeof(coalesce(NEW.items, 'null'::jsonb)) <> 'array' then
    raise exception 'Held tab items must be a JSON array' using errcode='P0001';
  end if;
  for v_line in select value from jsonb_array_elements(NEW.items) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Held tab lines must be JSON objects' using errcode='P0001';
    end if;
    v_line_category := lower(coalesce(btrim(v_line->>'category'), ''));
    v_line_modifiers := v_line->'modifiers';
    if v_line_modifiers is not null and jsonb_typeof(v_line_modifiers) <> 'array' then
      raise exception 'Held tab line modifiers must be a JSON array' using errcode='P0001';
    end if;
    for v_group in
      select g.id, g.name, g.min_selections, g.options
        from public.pos_modifier_groups g
       where g.lodge_id = NEW.lodge_id
         and coalesce(g.active, true) = true
         and coalesce(g.min_selections, 0) > 0
         and (
           coalesce(array_length(g.applies_to_categories, 1), 0) = 0
           or exists (
             select 1 from unnest(g.applies_to_categories) c
              where lower(btrim(c)) in ('all', v_line_category)
           )
         )
    loop
      select count(*) into v_selected
        from jsonb_array_elements(coalesce(v_line_modifiers, '[]'::jsonb)) sel(line)
       where (sel.line->>'group_id' = v_group.id::text)
          or (
               (sel.line->>'group_id' is null)
               and exists (
                 select 1 from jsonb_array_elements(coalesce(v_group.options, '[]'::jsonb)) opt(value)
                  where opt.value->>'id' = sel.line->>'id'
               )
             );
      if v_selected < v_group.min_selections then
        raise exception 'Complete required choices: %', v_group.name using errcode='P0001';
      end if;
    end loop;
  end loop;
  return NEW;
end
$$;

drop trigger if exists trg_pos_tabs_modifier_requirements on public.pos_tabs;
create trigger trg_pos_tabs_modifier_requirements
  before insert on public.pos_tabs
  for each row execute function public.enforce_pos_tab_modifier_requirements();

commit;
