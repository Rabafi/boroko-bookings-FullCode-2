import { state } from '../state.js'
import { dedupePromise } from './infrastructure.js'

function requireOnline() {
  if (!state.isOnline) throw new Error('Restaurant Accounting requires an online connection')
}
async function rpc(name, payload = {}) {
  requireOnline()
  const { data, error } = await state.supabase.rpc(name, { p_lodge_id: state.lodgeId, ...payload })
  if (error) throw new Error(error.message)
  if (data?.success === false) throw new Error(data.error || `${name} failed`)
  return data
}
function requireKey(key) {
  if (!key || !String(key).trim()) throw new Error('A stable operation key is required')
  return String(key).trim()
}

export const getRestaurantAccountsV2 = () => dedupePromise('accounting:v2:accounts', () => rpc('get_restaurant_accounts'))
export const createRestaurantAccountV2 = (data) => rpc('create_restaurant_account', {
  p_code:data.code,p_name:data.name,p_account_type:data.accountType,p_parent_id:data.parentId||null,p_opening_balance:0,p_description:data.description||null
})
export const updateRestaurantAccountV2 = (id,data) => rpc('update_restaurant_account', {
  p_id:id,p_name:data.name??null,p_description:data.description??null,p_is_active:data.isActive??null,p_opening_balance:null
})
export const setRestaurantAccountCashFlowV2 = (id, classification) => rpc('set_restaurant_account_cash_flow_classification',{p_account_id:id,p_classification:classification})
export const deleteRestaurantAccountV2 = (id) => rpc('delete_restaurant_account',{p_id:id})
export const seedRestaurantAccountsV2 = () => rpc('seed_restaurant_default_accounts')
export const postRestaurantOpeningBalanceV2 = (data) => rpc('post_restaurant_opening_balance',{
  p_account_id:data.accountId,p_equity_account_id:data.equityAccountId,p_entry_date:data.entryDate,p_amount:data.amount,p_idempotency_key:requireKey(data.operationKey)
})

export const getRestaurantLedgerWorkspaceV2 = (filters={}) => dedupePromise(`accounting:v2:ledger:${JSON.stringify(filters)}`,()=>rpc('get_restaurant_ledger_workspace_v2',{p_start_date:filters.startDate||null,p_end_date:filters.endDate||null,p_account_id:filters.accountId||null}))
export const createRestaurantJournalV2 = (data) => rpc('create_restaurant_journal_entry',{p_entry_date:data.entryDate,p_description:data.description,p_source_type:data.sourceType||'manual',p_source_id:data.sourceId||null,p_reference_number:data.referenceNumber||null,p_idempotency_key:requireKey(data.operationKey),p_lines:data.lines})
export const reverseRestaurantJournalV2 = (data) => rpc('reverse_restaurant_journal_entry',{p_entry_id:data.entryId,p_reason:data.reason,p_idempotency_key:requireKey(data.operationKey)})
export const getRestaurantPosMappingsV2 = () => rpc('get_restaurant_pos_gl_mappings')
export const setRestaurantPosMappingV2 = (data) => rpc('set_restaurant_pos_gl_mapping',{p_mapping_type:data.mappingType,p_source_key:data.sourceKey,p_account_id:data.accountId})
export const postRestaurantPosOrderV2 = (orderId) => rpc('post_pos_order_to_gl',{p_order_id:orderId})

export const getRestaurantApWorkspaceV2 = () => dedupePromise('accounting:v2:ap',()=>rpc('get_restaurant_ap_workspace_v2'))
export const setRestaurantApGlSettingsV2 = (data) => rpc('set_restaurant_ap_gl_settings',{p_payable_account_id:data.payableAccountId,p_input_tax_account_id:data.inputTaxAccountId||null})
export const createRestaurantBillV2 = (data) => rpc('create_restaurant_bill_v2',{p_supplier_id:data.supplierId||null,p_supplier_name:data.supplierName,p_bill_number:data.billNumber,p_bill_date:data.billDate,p_due_date:data.dueDate,p_notes:data.notes||null,p_items:data.lines,p_idempotency_key:requireKey(data.operationKey)})
export const submitRestaurantBillV2 = (billId) => rpc('submit_restaurant_bill',{p_bill_id:billId})
export const approveRestaurantBillV2 = (billId, operationKey) => rpc('approve_restaurant_bill',{p_bill_id:billId,p_idempotency_key:requireKey(operationKey)})
export const payRestaurantBillV2 = (data) => rpc('record_restaurant_bill_payment_v2',{p_bill_id:data.billId,p_payment_date:data.paymentDate,p_amount:data.amount,p_payment_account_id:data.paymentAccountId,p_reference:data.reference||null,p_notes:data.notes||null,p_idempotency_key:requireKey(data.operationKey)})

export const saveRestaurantBankAccountV2 = (data) => rpc('save_restaurant_bank_account_v2',{p_id:data.id||null,p_account_id:data.accountId,p_name:data.name,p_bank_name:data.bankName||null,p_account_number:data.accountNumber,p_account_type:data.accountType,p_is_active:data.isActive??true})
export const getRestaurantBankWorkspaceV2 = (bankAccountId=null) => dedupePromise(`accounting:v2:bank:${bankAccountId||''}`,()=>rpc('get_restaurant_bank_workspace_v2',{p_bank_account_id:bankAccountId}))
export const importRestaurantBankStatementV2 = (data) => rpc('import_bank_statement_v2',{p_bank_account_id:data.bankAccountId,p_transactions:data.transactions,p_file_name:data.fileName,p_idempotency_key:requireKey(data.operationKey)})
export const proposeRestaurantBankMatchesV2 = (bankAccountId) => rpc('propose_bank_matches_v2',{p_bank_account_id:bankAccountId})
export const reviewRestaurantBankMatchV2 = (proposalId,approve) => rpc('review_bank_match_v2',{p_proposal_id:proposalId,p_approve:Boolean(approve)})
export const exceptRestaurantBankTransactionV2 = (transactionId,reason) => rpc('set_bank_transaction_exception',{p_transaction_id:transactionId,p_reason:reason})
export const createRestaurantBankReconciliationV2 = (data) => rpc('create_bank_reconciliation_v2',{p_bank_account_id:data.bankAccountId,p_statement_import_id:data.statementImportId,p_statement_balance:data.statementBalance,p_reconciliation_date:data.reconciliationDate,p_transaction_ids:data.transactionIds,p_adjustments:data.adjustments||[]})
export const completeRestaurantBankReconciliationV2 = (id,notes) => rpc('complete_bank_reconciliation_v2',{p_reconciliation_id:id,p_notes:notes||null})

export const getRestaurantTaxWorkspaceV2 = () => dedupePromise('accounting:v2:tax',()=>rpc('get_restaurant_tax_working_papers_v2'))
export const setRestaurantTaxConfigurationV2 = (data) => rpc('set_restaurant_tax_configuration',{p_jurisdiction_code:data.jurisdictionCode,p_rule_version:data.ruleVersion,p_effective_from:data.effectiveFrom,p_effective_to:data.effectiveTo||null,p_output_tax_account_id:data.outputTaxAccountId,p_input_tax_account_id:data.inputTaxAccountId})
export const generateRestaurantTaxWorkingPaperV2 = (data) => rpc('generate_restaurant_tax_working_paper',{p_period_start:data.periodStart,p_period_end:data.periodEnd,p_configuration_id:data.configurationId})
export const reviewRestaurantTaxWorkingPaperV2 = (id) => rpc('review_restaurant_tax_working_paper',{p_return_id:id})
export const approveRestaurantTaxWorkingPaperV2 = (id) => rpc('approve_restaurant_tax_working_paper',{p_return_id:id})
export const fileRestaurantTaxWorkingPaperV2 = (id,reference,notes) => rpc('record_restaurant_tax_filing',{p_return_id:id,p_filing_reference:reference,p_notes:notes||null})

export const getRestaurantBudgetMatrixV2 = (year) => dedupePromise(`accounting:v2:budgets:${year}`,()=>rpc('get_restaurant_budget_workspace_v2',{p_year:year}))
export const saveRestaurantBudgetMatrixV2 = (year,entries,operationKey) => rpc('save_restaurant_budget_matrix_v2',{p_year:year,p_entries:entries,p_idempotency_key:requireKey(operationKey)})
export const createRestaurantBudgetTemplateV2 = (data) => rpc('create_restaurant_budget_template_v2',{p_name:data.name,p_description:data.description||null,p_lines:data.lines,p_idempotency_key:requireKey(data.operationKey)})
export const applyRestaurantBudgetTemplateV2 = (data) => rpc('apply_restaurant_budget_template_v2',{p_template_id:data.templateId,p_year:data.year,p_month:data.month,p_idempotency_key:requireKey(data.operationKey)})
export const getRestaurantFinancialStatementsV2 = (startDate,endDate) => dedupePromise(`accounting:v2:statements:${startDate}:${endDate}`,()=>rpc('get_restaurant_financial_statements_v2',{p_start_date:startDate,p_end_date:endDate}))

export const getRestaurantPayrollWorkspaceV2 = () => dedupePromise('accounting:v2:payroll',()=>rpc('get_restaurant_payroll_workspace_v2'))
export const getRestaurantPayrollRecordsV2 = (periodId) => rpc('get_restaurant_payroll_records_v2',{p_pay_period_id:periodId})
export const setRestaurantPayrollTermsV2 = (data) => rpc('set_restaurant_payroll_employment_terms',{p_staff_user_id:data.staffUserId,p_effective_from:data.effectiveFrom,p_effective_to:data.effectiveTo||null,p_pay_type:data.payType,p_monthly_salary:data.monthlySalary||0,p_hourly_rate:data.hourlyRate||0,p_overtime_multiplier:data.overtimeMultiplier,p_standard_monthly_hours:data.standardMonthlyHours,p_payment_reference:data.paymentReference||null,p_bank_account_name:data.bankAccountName||null,p_bank_account_number:data.bankAccountNumber||null,p_bank_branch_code:data.bankBranchCode||null})
export const setRestaurantPayrollConfigurationV2 = (data) => rpc('set_restaurant_payroll_statutory_configuration',{p_jurisdiction_code:data.jurisdictionCode,p_rule_version:data.ruleVersion,p_effective_from:data.effectiveFrom,p_effective_to:data.effectiveTo||null,p_tax_brackets:data.taxBrackets,p_social_security_rate:data.socialSecurityRate,p_pension_rate:data.pensionRate,p_health_amount:data.healthAmount,p_currency:data.currency})
export const createRestaurantPayPeriodV2 = (data) => rpc('create_restaurant_pay_period_v2',{p_name:data.name,p_start_date:data.startDate,p_end_date:data.endDate,p_configuration_id:data.configurationId})
export const setRestaurantPayrollTimeV2 = (data) => rpc('set_restaurant_payroll_time_input',{p_pay_period_id:data.periodId,p_staff_user_id:data.staffUserId,p_regular_hours:data.regularHours,p_overtime_hours:data.overtimeHours,p_source_reference:data.sourceReference})
export const approveRestaurantPayrollTimeV2 = (id) => rpc('approve_restaurant_payroll_time_input',{p_time_input_id:id})
export const calculateRestaurantPayrollV2 = (id) => rpc('calculate_restaurant_payroll_v2',{p_pay_period_id:id})
export const approveRestaurantPayrollV2 = (id) => rpc('approve_restaurant_payroll_v2',{p_pay_period_id:id})
export const exportRestaurantPayrollPaymentsV2 = (id) => rpc('export_restaurant_payroll_payments',{p_pay_period_id:id})
export const setRestaurantPayrollGlSettingsV2 = (data) => rpc('set_restaurant_payroll_gl_settings',{p_payroll_expense_account_id:data.payrollExpenseAccountId,p_net_payable_account_id:data.netPayableAccountId,p_tax_payable_account_id:data.taxPayableAccountId,p_deductions_payable_account_id:data.deductionsPayableAccountId})
export const postRestaurantPayrollV2 = (id) => rpc('post_restaurant_payroll_to_gl_v2',{p_pay_period_id:id})

