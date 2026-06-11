-- Phase 1 Session Context Bridge
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem:
--   app_request_session_token() relied solely on current_setting('request.headers')
--   to find the x-boroko-session token. That GUC is set by PostgREST from HTTP
--   headers and works for most calls, but is fragile:
--   - PostgREST may serialize headers in varying formats across versions.
--   - Inside some SECURITY DEFINER call stacks the GUC context may not reflect
--     the live request headers.
--   - There is no strong typing — the token can silently resolve to null, causing
--     every app_lodge_access() / app_require_lodge_role() guard to fail open or
--     raise incorrectly.
--
-- Fix:
--   1. Register a PostgREST pre-request hook (handle_pgrst_request) that runs
--      at the START of every PostgREST transaction.  It reads x-boroko-session
--      from request.headers ONCE and stores it as a transaction-local typed GUC:
--        current_setting('app.session_token', true)
--
--   2. Update app_request_session_token() to prefer app.session_token over the
--      raw request.headers fallback.  The fallback is kept as belt-and-suspenders.
--
-- Token resolution chain after this migration:
--   client  →  HTTP header x-boroko-session
--   PostgREST  →  sets current_setting('request.headers')
--   handle_pgrst_request()  →  set_config('app.session_token', token, true)  [tx-local]
--   app_request_session_token()  →  reads app.session_token (then falls back to headers)
--   app_current_session_row()  →  validates token against app_sessions table
--   app_lodge_access() / app_require_lodge_role()  →  enforce tenant isolation
--
-- No changes to app_lodge_access(), app_require_lodge_role(), or RLS policies.
-- The entire fix is in the token-resolution layer.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Pre-request hook ───────────────────────────────────────────────────────
-- Called by PostgREST before every request.  Converts the HTTP header into a
-- transaction-local GUC so all downstream helpers read a single, consistent value.

create or replace function public.handle_pgrst_request()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_token text;
begin
  -- Extract session token from whichever header key the client sends.
  -- Coalesce order: canonical name → alternate name → empty string.
  -- set_config(..., true) = transaction-local (cleared automatically after commit/rollback).
  v_token := coalesce(
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session', '')),        ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session-token', '')),  ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x_boroko_session', '')),         ''),
    ''
  );
  perform set_config('app.session_token', v_token, true);
end;
$function$;

-- authenticator is the PostgREST connecting role in Supabase.
-- Only PostgREST (as authenticator) needs to invoke this.
revoke all on function public.handle_pgrst_request() from public, anon, authenticated;
grant execute on function public.handle_pgrst_request() to authenticator;

-- ── 2. Register hook with PostgREST ──────────────────────────────────────────
-- PostgREST reads pgrst.db_pre_request from the connecting role on each request.
-- The notify below signals PostgREST to reload its config and pick this up.

alter role authenticator set pgrst.db_pre_request to 'public.handle_pgrst_request';

-- ── 3. Update token resolver to prefer the typed GUC ─────────────────────────
-- Priority:
--   1. Explicit p_token argument (callers that already have the token)
--   2. app.session_token GUC (set by handle_pgrst_request at tx start)
--   3. request.headers fallback (pre-hook transition / belt-and-suspenders)

create or replace function public.app_request_session_token(p_token text default null)
returns text
language sql
stable
as $function$
  select nullif(
    btrim(
      coalesce(
        -- Explicit token passed by caller (highest priority)
        nullif(btrim(coalesce(p_token, '')), ''),
        -- Transaction-local GUC set by handle_pgrst_request() pre-hook
        nullif(current_setting('app.session_token', true), ''),
        -- Direct header parse — fallback for any request that bypassed the hook
        nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session', '')),       ''),
        nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session-token', '')), ''),
        nullif(btrim(coalesce(public.app_request_headers()->>'x_boroko_session', '')),        ''),
        ''
      )
    ),
    ''
  );
$function$;

-- ── 4. No further SQL changes required ───────────────────────────────────────
-- app_lodge_access(), app_require_lodge_role(), and all RLS policies already call
-- app_request_session_token() via the existing helper chain.  They will pick up
-- the token from the GUC automatically without modification.

notify pgrst, 'reload schema';

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION STEPS (run in Supabase SQL Editor after deploying migration)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ── V1: Pre-request hook is registered ───────────────────────────────────────
--
--   select rolname, rolconfig
--   from pg_roles
--   where rolname = 'authenticator';
--
--   Expected: rolconfig contains 'pgrst.db_pre_request=public.handle_pgrst_request'
--
--
-- ── V2: Token resolves correctly when GUC is set ─────────────────────────────
--   (Simulates what the pre-request hook does for a real request)
--
--   set local "app.session_token" = 'test-token-value';
--   select public.app_request_session_token();
--
--   Expected: 'test-token-value'
--
--
-- ── V3: No token → null → access denied ──────────────────────────────────────
--   (Simulates an unauthenticated request — no header, no GUC)
--
--   set local "app.session_token" = '';
--   select public.app_lodge_access('<any_lodge_id>'::uuid);
--
--   Expected: false   (unless running as service_role)
--
--
-- ── V4: Valid session → correct lodge allowed, other lodge denied ─────────────
--   (Run as anon/authenticated after obtaining a real session token)
--
--   Step A — log in via authenticate_user() or authenticate_manager() to get a token.
--
--   Step B — simulate the pre-request hook:
--     set local "app.session_token" = '<real_session_token>';
--
--   Step C — own lodge (should be true):
--     select public.app_lodge_access('<own_lodge_id>'::uuid);
--     Expected: true
--
--   Step D — other lodge (should be false):
--     select public.app_lodge_access('<other_lodge_id>'::uuid);
--     Expected: false
--
--
-- ── V5: RLS SELECT isolation ──────────────────────────────────────────────────
--   (Requires two lodges with bookings in the DB)
--
--   -- As anon with Lodge A token:
--   set local "app.session_token" = '<lodge_a_token>';
--   set role anon;
--   select count(*) from public.bookings where lodge_id = '<lodge_b_id>';
--
--   Expected: 0   (Lodge B rows invisible to Lodge A session)
--
--   select count(*) from public.bookings where lodge_id = '<lodge_a_id>';
--   Expected: actual count  (Lodge A rows visible)
--
--
-- ── V6: app_require_lodge_role() blocks wrong role ───────────────────────────
--   (Run with a token whose role is 'receptionist', calling a guard that requires 'admin')
--
--   set local "app.session_token" = '<receptionist_token>';
--   select public.app_require_lodge_role('<lodge_id>'::uuid, array['admin', 'manager']);
--
--   Expected: ERROR 42501 "This session is not allowed to perform that action."
--
--
-- ── V7: Service role bypasses all guards ─────────────────────────────────────
--
--   set local role service_role;
--   select public.app_lodge_access('<any_lodge_id>'::uuid);
--
--   Expected: true  (service_role is always trusted)
