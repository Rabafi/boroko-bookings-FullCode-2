-- Restaurant Accounting P2: fail closed while the ledger/control contracts are rebuilt.
--
-- This deliberately preserves read-only reporting and configuration discovery while
-- preventing financial state transitions that the July 18 audit found incomplete.
-- Service-role execution remains available for controlled remediation only.

begin;

-- General ledger posting.
revoke all on function public.post_pos_sales_to_gl(uuid, date, date) from public;
revoke execute on function public.post_pos_sales_to_gl(uuid, date, date) from authenticated;
grant execute on function public.post_pos_sales_to_gl(uuid, date, date) to service_role;

revoke all on function public.post_expenses_to_gl(uuid, date, date) from public;
revoke execute on function public.post_expenses_to_gl(uuid, date, date) from authenticated;
grant execute on function public.post_expenses_to_gl(uuid, date, date) to service_role;

-- Bank approval and reconciliation finalisation.
revoke all on function public.approve_bank_match(uuid, uuid, boolean) from public;
revoke execute on function public.approve_bank_match(uuid, uuid, boolean) from authenticated;
grant execute on function public.approve_bank_match(uuid, uuid, boolean) to service_role;

revoke all on function public.complete_bank_reconciliation(uuid, uuid, text) from public;
revoke execute on function public.complete_bank_reconciliation(uuid, uuid, text) from authenticated;
grant execute on function public.complete_bank_reconciliation(uuid, uuid, text) to service_role;

-- Accounts-payable approvals and payments.
revoke all on function public.update_bill_status(uuid, uuid, text) from public;
revoke execute on function public.update_bill_status(uuid, uuid, text) from authenticated;
grant execute on function public.update_bill_status(uuid, uuid, text) to service_role;

revoke all on function public.record_bill_payment(uuid, uuid, date, numeric, text, text, text, text) from public;
revoke execute on function public.record_bill_payment(uuid, uuid, date, numeric, text, text, text, text) from authenticated;
grant execute on function public.record_bill_payment(uuid, uuid, date, numeric, text, text, text, text) to service_role;

-- Tax filing status changes.
revoke all on function public.update_tax_return(uuid, uuid, text, text) from public;
revoke execute on function public.update_tax_return(uuid, uuid, text, text) from authenticated;
grant execute on function public.update_tax_return(uuid, uuid, text, text) to service_role;

-- Payroll changes and downstream posting. Payroll must not be used as a payment system
-- until statutory, approval and bank-payment contracts are implemented.
revoke all on function public.create_pay_period(uuid, text, date, date) from public;
revoke execute on function public.create_pay_period(uuid, text, date, date) from authenticated;
grant execute on function public.create_pay_period(uuid, text, date, date) to service_role;

revoke all on function public.calculate_payroll(uuid, uuid) from public;
revoke execute on function public.calculate_payroll(uuid, uuid) from authenticated;
grant execute on function public.calculate_payroll(uuid, uuid) to service_role;

revoke all on function public.update_employee_pay_record(uuid, uuid, jsonb) from public;
revoke execute on function public.update_employee_pay_record(uuid, uuid, jsonb) from authenticated;
grant execute on function public.update_employee_pay_record(uuid, uuid, jsonb) to service_role;

revoke all on function public.approve_payroll(uuid, uuid) from public;
revoke execute on function public.approve_payroll(uuid, uuid) from authenticated;
grant execute on function public.approve_payroll(uuid, uuid) to service_role;

revoke all on function public.post_payroll_to_gl(uuid, uuid) from public;
revoke execute on function public.post_payroll_to_gl(uuid, uuid) from authenticated;
grant execute on function public.post_payroll_to_gl(uuid, uuid) to service_role;

commit;