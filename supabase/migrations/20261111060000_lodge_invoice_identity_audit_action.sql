-- Keep the existing reviewed event identity/group repair executable under the
-- constrained financial audit action list.
begin;
alter table public.financial_audit_log
  drop constraint if exists financial_audit_log_action_check;
alter table public.financial_audit_log
  add constraint financial_audit_log_action_check check (
    action = any (array[
      'payment_recorded','refund_recorded','charge_added','charge_deleted',
      'booking_total_edited','booking_status_changed','booking_rescheduled',
      'customer_credit_received','customer_credit_allocated','customer_credit_refunded',
      'customer_credit_adjusted','customer_credit_reversed','event_created',
      'event_updated','event_cancelled','event_line_item_added','event_line_item_voided',
      'event_room_linked','event_room_unlinked','event_payment_recorded',
      'event_pos_charge_added','event_pos_charge_reversed','booking_group_created',
      'event_duplicate_payment_voided','event_invoice_identity_repaired'
    ]::text[])
  );
commit;
