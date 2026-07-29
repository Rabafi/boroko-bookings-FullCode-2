-- Register the already-published LodgingOS v1.5.5 GitHub release with the
-- client-safe rollout gate. Without this row, healthy clients stop at the
-- Command Central gate and never consult the GitHub updater feed.
insert into public.app_releases (
  version,
  release_notes,
  channel,
  force_update,
  min_version,
  rollout_pct,
  status
)
values (
  '1.5.5',
  E'Tsa Bonno LodgingOS rebrand and compatibility release.\n\nThe untested Food & Beverage workspace is held back from this release.',
  'stable',
  false,
  null,
  100,
  'full'
)
on conflict (version) do update
set release_notes = excluded.release_notes,
    channel = excluded.channel,
    force_update = excluded.force_update,
    min_version = excluded.min_version,
    rollout_pct = excluded.rollout_pct,
    status = excluded.status,
    updated_at = now();
