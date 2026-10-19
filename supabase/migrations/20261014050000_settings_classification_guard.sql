-- LodgingOS classification ownership: server-side guard for property_type/business_type (R3).
--
-- Gap repaired: the transition ledger (20261014010000 + 20261014040000) is
-- authoritative, but ordinary settings/profile upserts could still overwrite
-- a committed classification. A device holding a stale cached type passes
-- its local lock check and sends the old type back; nothing at the database
-- boundary stops it, so the settings row can disagree with the audited
-- ledger. Local-cache/domain checks alone cannot fix this under concurrency.
--
-- Enforcement: R3-CLASSIFICATION-GUARD, a BEFORE UPDATE OF property_type,
-- business_type trigger on public.settings. When the new row actually
-- changes either classification column (OLD IS DISTINCT FROM NEW), the
-- write must satisfy ONE trusted condition:
--   (1) R3-WRITER-FLAG: current_setting('app.property_transition_writer',
--       true) = '1' — set transaction-locally by commit_property_type_change
--       immediately before its narrow settings UPDATE. Ordinary upserts never
--       set this flag.
--   (2) Bootstrap window: OLD.setup_complete IS NOT TRUE — first-time setup
--       and setup-incomplete rows may still establish classification through
--       the bootstrap path (bootstrap_company_settings RPC / service-role
--       bootstrap upsert, 20260712120000). Fresh INSERTs never reach this
--       trigger (UPDATE-only).
--   (3) app_is_service_role() IS TRUE — direct service_role (or
--       postgres/supabase_admin) sessions: server-side admin and exact-restore
--       paths. This condition is meaningful, not dead code:
--       app_is_service_role() reads app_request_role(), which reflects the
--       CALLER's request role GUCs (request.jwt.claim.role, then role), never
--       the SECURITY DEFINER owner. Inside commit_property_type_change called
--       from an anon/authenticated app session it returns FALSE (verified
--       against the definitions in 20260526101632 + 20260714235000 +
--       20260714245000), so the commit fn still needs condition (1) as
--       defense-in-depth: without the flag the trigger could not distinguish
--       the audited commit UPDATE from any other SECURITY DEFINER UPDATE.
--       Direct service_role sessions (admin tooling, exact restore) return
--       TRUE. app_is_service_role() is granted to authenticated only, so this
--       guard function is SECURITY DEFINER: nested calls then execute as the
--       owner and anon/authenticated invokers get a clean classification_locked
--       denial instead of a permission error.
-- Otherwise the write raises P0001 with code marker classification_locked,
-- naming the audited contract and the repair. Unchanged classification
-- values (ordinary saves echoing the current type) pass through untouched,
-- so legitimate unrelated settings/profile saves keep working.
--
-- Trusted-contract audit (verified in-tree, 2026-10-15):
--   - commit_property_type_change: sets the writer flag; ONLY writer of
--     property_type through this contract. Its no-op path writes nothing.
--   - Ordinary desktop save (saveRemoteSettingsRecord, settings.js): direct
--     upsert incl. property_type/business_type/operating_profile. Stale
--     differing values are now rejected server-side; callers must reload and
--     resubmit preserving the current classification (Agent B owns the
--     client reload/retry mapping of classification_locked).
--   - admin_update_company_settings (20260721156000): allowlist INCLUDES
--     business_type but EXCLUDES property_type; executable by service_role
--     only -> passes via condition (3). Preserved deliberately: Command
--     Central company edits stay available to server-side admin.
--   - Starter backup/restore: exact restore performs plain INSERTs into a
--     fresh quarantined recovery lodge (_starter_recovery_execute_v1/v2,
--     20260826000000) — INSERT, so this UPDATE trigger never fires. The
--     quarantine hardenings (20260827010000: UPDATE ... SET deleted/updated_at
--     WHERE is_disposable_recovery) touch NEITHER classification column, so
--     the column-scoped trigger never fires there either. Restore fns are
--     revoked from anon/authenticated (server-side only).
--   - Bootstrap (bootstrap_company_settings, 20260712120000): INSERT path,
--     unaffected; setup-incomplete upsert conflicts pass via condition (2).
--   - Existing settings triggers coexist: settings_trial_anchor_guard fires
--     only on trial_started_at (disjoint columns); the Bar AFTER trigger
--     (settings_provision_bar_mode_default_outlet) fires after the commit
--     UPDATE too but no-ops unless property_type='restaurant' AND
--     hospitality_mode='bar_only', which a lodging transition never
--     produces; apply_bar_offline_trading_window mutates NEW only for
--     bar_only lodges and never raises. None raise on lodging writes.
--   - Later-migration inspection: no migration after 20261014020000
--     redefines the transition RPCs, the family helper, app_is_service_role,
--     or settings ACLs/policies (20261014030000 touches only quotation
--     conversion; 20261015010000 touches only POS order replay and calls
--     app_is_service_role() read-only). No GRANT changes to settings or the
--     transition functions exist past 20261014020000.
--
-- Deliberate boundary: operating_profile NESTED classification/presentation
-- fields are not guarded here (column scope is property_type/business_type
-- only). A stale nested profile echo is cosmetic: the server reads the
-- top-level columns, and the commit narrow-fill preserves configured
-- choices. Client profile guards remain Agent B's ownership.
--
-- Grants match convention: trigger helper revoked (owner-only invocation by
-- the trigger itself).
--
-- Idempotent: CREATE OR REPLACE function, DROP TRIGGER IF EXISTS + CREATE.

begin;

-- ── Classification guard (owner-only; invoked by the trigger) ───────────────
create or replace function public._property_transition_guard_classification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- R3-CLASSIFICATION-GUARD: only actual classification changes need trust.
  if OLD.property_type is distinct from NEW.property_type
     or OLD.business_type is distinct from NEW.business_type then
    -- (1) Audited transition contract (R3-WRITER-FLAG).
    if current_setting('app.property_transition_writer', true) = '1' then
      return NEW;
    end if;
    -- (2) Bootstrap window: setup not yet complete.
    if OLD.setup_complete is not true then
      return NEW;
    end if;
    -- (3) Server-side admin / exact restore (direct service_role session).
    if public.app_is_service_role() is true then
      return NEW;
    end if;
    raise exception 'classification_locked: property_type/business_type may only change through the audited commit_property_type_change contract (preview, confirm, commit with a stable idempotency key). Unrelated settings saves must preserve the current classification: reload company settings and retry without changing the type. Current type "%", attempted "%".',
      coalesce(OLD.property_type, ''), coalesce(NEW.property_type, '')
      using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

revoke all on function public._property_transition_guard_classification() from public, anon, authenticated;

comment on function public._property_transition_guard_classification() is
  'R3 classification ownership: BEFORE UPDATE guard on settings property_type/business_type. Trusted writers: audited transition (app.property_transition_writer flag), setup-incomplete bootstrap, direct service_role admin/restore. All other classification changes raise classification_locked (P0001).';

drop trigger if exists settings_property_transition_guard on public.settings;
create trigger settings_property_transition_guard
before update of property_type, business_type on public.settings
for each row execute function public._property_transition_guard_classification();

notify pgrst, 'reload schema';

commit;
