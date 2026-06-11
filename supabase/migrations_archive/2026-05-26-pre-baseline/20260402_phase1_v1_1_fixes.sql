-- Phase 1.1 Security Hardening Fixes
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem: 20260401_pwa_access_contract.sql runs after 20260401_phase1_auth_sessions.sql
-- (alphabetical order: "pwa" > "phase1") and re-creates the insecure 2-param
-- authenticate_manager(text, text) overload that was dropped by phase1_auth_sessions.
-- That overload returns pwa_password_hash to the caller — a critical security defect.
--
-- This migration runs last (20260402 > 20260401) and removes that overload for good.
-- The secure 3-param version authenticate_manager(text, text, uuid) from
-- phase1_auth_sessions.sql remains and is the only callable overload after this runs.
-- ─────────────────────────────────────────────────────────────────────────────

-- Fix 1: Remove the insecure authenticate_manager(text, text) overload.
-- pwa_access_contract.sql re-created this after phase1_auth_sessions.sql dropped it.
-- The secure authenticate_manager(text, text, uuid) (3-param) is unaffected.
drop function if exists public.authenticate_manager(text, text);

-- Fix 2: Belt-and-suspenders — ensure the old authenticate_user(text, uuid) overload
-- is gone. phase1_auth_sessions.sql already drops it, but re-asserting here is harmless
-- and guards against any future migration ordering issues.
drop function if exists public.authenticate_user(text, uuid);

notify pgrst, 'reload schema';
