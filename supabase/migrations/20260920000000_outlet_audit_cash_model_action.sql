-- The village cash model (20260918000000) audits outlet cash-model switches as
-- 'cash_model_changed', but the outlet audit table's action check (20260716)
-- only admits created/updated/activated/deactivated — so every switch aborts
-- on the audit insert and the outlet never changes (operator-reproduced on the
-- live Bar outlet: new row violates
-- "restaurant_outlet_control_audit_action_check").
--
-- Fix (forward-only, no DML, no RPC/grant change): widen the check to admit
-- the cash-model action alongside the four legacy actions.

begin;

alter table public.restaurant_outlet_control_audit
  drop constraint if exists restaurant_outlet_control_audit_action_check;

alter table public.restaurant_outlet_control_audit
  add constraint restaurant_outlet_control_audit_action_check
  check (action in ('created', 'updated', 'activated', 'deactivated', 'cash_model_changed'));

commit;
