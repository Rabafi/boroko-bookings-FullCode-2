// @ts-check
import { state } from '../state.js'
import { dedupePromise } from './infrastructure.js'

function requireOnline() {
  if (!state.isOnline) throw new Error('Restaurant Accounting requires an online connection')
}
/** @param {string} name @param {Record<string, unknown>} [payload] */
async function rpc(name, payload = {}) {
  requireOnline()
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc(name, { p_lodge_id: state.lodgeId, ...payload })
  if (error) throw new Error(error.message)
  if (data?.success === false) throw new Error(data.error || `${name} failed`)
  return data
}
/** @param {unknown} key */
function requireKey(key) {
  if (!key || !String(key).trim()) throw new Error('A stable operation key is required')
  return String(key).trim()
}

export const getRestaurantAccountsV2 = () => dedupePromise('accounting:v2:accounts', () => rpc('get_restaurant_accounts'))
export const getRestaurantChartExportV2 = () => rpc('get_restaurant_chart_export_v2')
/** @param {unknown} [filters] */
export const getRestaurantChartExportV3 = (filters = {}) => rpc('get_restaurant_chart_export_v3', { p_filters: filters })
/** @param {{code?: unknown, name?: unknown, accountType?: unknown, parentId?: unknown, description?: unknown}} data */
export const createRestaurantAccountV2 = (data) => rpc('create_restaurant_account', { p_code:data.code,p_name:data.name,p_account_type:data.accountType,p_parent_id:data.parentId||null,p_opening_balance:0,p_description:data.description||null })
/** @param {unknown} id @param {{name?: unknown, description?: unknown, isActive?: unknown}} data */
export const updateRestaurantAccountV2 = (id,data) => rpc('update_restaurant_account', { p_id:id,p_name:data.name??null,p_description:data.description??null,p_is_active:data.isActive??null,p_opening_balance:null })
/** @param {unknown} id @param {unknown} classification */
export const setRestaurantAccountCashFlowV2 = (id, classification) => rpc('set_restaurant_account_cash_flow_classification',{p_account_id:id,p_classification:classification})
/** @param {unknown} id */
export const deleteRestaurantAccountV2 = (id) => rpc('delete_restaurant_account',{p_id:id})
export const seedRestaurantAccountsV2 = () => rpc('seed_restaurant_default_accounts')
/** @param {{accountId?: unknown, equityAccountId?: unknown, entryDate?: unknown, amount?: unknown, operationKey?: unknown}} data */
export const postRestaurantOpeningBalanceV2 = (data) => rpc('post_restaurant_opening_balance',{p_account_id:data.accountId,p_equity_account_id:data.equityAccountId,p_entry_date:data.entryDate,p_amount:data.amount,p_idempotency_key:requireKey(data.operationKey)})
/** @param {{startDate?: unknown, endDate?: unknown, accountId?: unknown}} [filters] */
export const getRestaurantLedgerWorkspaceV2 = (filters={}) => dedupePromise(`accounting:v2:ledger:${JSON.stringify(filters)}`,()=>rpc('get_restaurant_ledger_workspace_v2',{p_start_date:filters.startDate||null,p_end_date:filters.endDate||null,p_account_id:filters.accountId||null}))
/** @param {{startDate?: unknown, endDate?: unknown, accountId?: unknown, cursor?: {entry_date?: unknown, created_at?: unknown, entry_id?: unknown} | null, pageSize?: unknown}} [filters] */
export const getRestaurantLedgerPageV2 = (filters={}) => dedupePromise(`accounting:v2:ledger-page:${JSON.stringify(filters)}`,()=>rpc('get_restaurant_ledger_workspace_page_v2',{p_start_date:filters.startDate||null,p_end_date:filters.endDate||null,p_account_id:filters.accountId||null,p_before_entry_date:filters.cursor?.entry_date||null,p_before_created_at:filters.cursor?.created_at||null,p_before_entry_id:filters.cursor?.entry_id||null,p_page_size:filters.pageSize||100}))
/** @param {{startDate?: unknown, endDate?: unknown, accountId?: unknown}} [filters] */
export const getRestaurantLedgerExportV2 = (filters={}) => rpc('get_restaurant_ledger_export_v2',{p_start_date:filters.startDate||null,p_end_date:filters.endDate||null,p_account_id:filters.accountId||null})
/** @param {{startDate?: unknown, endDate?: unknown, accountId?: unknown}} [filters] */
export const getRestaurantLedgerReportExportV2 = (filters={}) => rpc('get_restaurant_ledger_report_export_v2',{p_start_date:filters.startDate||null,p_end_date:filters.endDate||null,p_account_id:filters.accountId||null})
/** @param {{startDate?: unknown, endDate?: unknown, accountId?: unknown}} [filters] */
export const getRestaurantLedgerExportV3 = (filters = {}) => rpc('get_restaurant_ledger_export_v3', { p_start_date: filters.startDate || null, p_end_date: filters.endDate || null, p_account_id: filters.accountId || null, p_filters: filters })
/** @param {{entryDate?: unknown, description?: unknown, sourceType?: unknown, sourceId?: unknown, referenceNumber?: unknown, operationKey?: unknown, lines?: unknown}} data */
export const createRestaurantJournalV2 = (data) => rpc('create_restaurant_journal_entry',{p_entry_date:data.entryDate,p_description:data.description,p_source_type:data.sourceType||'manual',p_source_id:data.sourceId||null,p_reference_number:data.referenceNumber||null,p_idempotency_key:requireKey(data.operationKey),p_lines:data.lines})
/** @param {{entryDate?: unknown, description?: unknown, referenceNumber?: unknown, lines?: unknown, evidenceRef?: unknown, operationKey?: unknown}} data */
export const createRestaurantManualJournalDraftV2 = (data) => rpc('create_restaurant_manual_journal_draft',{p_entry_date:data.entryDate,p_description:data.description,p_reference_number:data.referenceNumber||null,p_lines:data.lines,p_evidence_ref:data.evidenceRef,p_operation_id:requireKey(data.operationKey)})
/** @param {{payload: {entry_date?: unknown, description?: unknown, reference_number?: unknown, lines?: unknown, evidence_ref?: unknown}, operationId?: unknown}} data */
export const createAndSubmitRestaurantManualJournalV2 = (data) => rpc('create_and_submit_restaurant_manual_journal_v2',{p_entry_date:data.payload.entry_date,p_description:data.payload.description,p_reference_number:data.payload.reference_number,p_lines:data.payload.lines,p_evidence_ref:data.payload.evidence_ref,p_operation_id:requireKey(data.operationId)})
/** @param {unknown} operationId */
export const getRestaurantManualJournalSubmissionStatusV2 = (operationId) => rpc('get_restaurant_manual_journal_submission_status_v2',{p_operation_id:requireKey(operationId)})
/** @param {unknown} id */
export const submitRestaurantManualJournalV2 = (id) => rpc('submit_restaurant_manual_journal',{p_draft_id:id})
/** @param {unknown} id */
export const approveRestaurantManualJournalV2 = (id) => rpc('approve_restaurant_manual_journal',{p_draft_id:id})
/** @param {unknown} id */
export const postRestaurantManualJournalV2 = (id) => rpc('post_restaurant_manual_journal',{p_draft_id:id})
/** @param {{entryId?: unknown, reason?: unknown, operationKey?: unknown}} data */
export const reverseRestaurantJournalV2 = (data) => rpc('reverse_restaurant_journal_entry',{p_entry_id:data.entryId,p_reason:data.reason,p_idempotency_key:requireKey(data.operationKey)})
export const getRestaurantPosMappingsV2 = () => rpc('get_restaurant_pos_gl_mappings')
/** @param {{mappingType?: unknown, sourceKey?: unknown, accountId?: unknown}} data */
export const setRestaurantPosMappingV2 = (data) => rpc('set_restaurant_pos_gl_mapping',{p_mapping_type:data.mappingType,p_source_key:data.sourceKey,p_account_id:data.accountId})
/** @param {{mappingType?: unknown, sourceKey?: unknown, accountId?: unknown, effectiveFrom?: unknown, effectiveTo?: unknown, mappingVersion?: unknown}} data */
export const setRestaurantPosMappingEffectiveV2 = (data) => rpc('set_restaurant_pos_gl_mapping_v2',{p_mapping_type:data.mappingType,p_source_key:data.sourceKey,p_account_id:data.accountId,p_effective_from:data.effectiveFrom,p_effective_to:data.effectiveTo||null,p_mapping_version:data.mappingVersion||'bar-accounting-financial-truth-v1'})
/** @param {unknown} orderId */
export const postRestaurantPosOrderV2 = (orderId) => rpc('post_pos_order_to_gl_v2',{p_order_id:orderId})
export const getRestaurantApWorkspaceV2 = () => dedupePromise('accounting:v2:ap',()=>rpc('get_restaurant_ap_workspace_v2'))
export const getRestaurantApExportV2 = () => rpc('get_restaurant_ap_export_v2')
/** @param {unknown} [filters] */
export const getRestaurantApExportV3 = (filters = {}) => rpc('get_restaurant_ap_export_v3', { p_filters: filters })
/** @param {unknown} supplierName @param {unknown} [startDate] @param {unknown} [endDate] */
export const getRestaurantApSupplierStatementV2 = (supplierName, startDate = null, endDate = null) => rpc('get_restaurant_supplier_statement_v2',{p_supplier_name:supplierName,p_start_date:startDate,p_end_date:endDate})
/** @param {{payableAccountId?: unknown, inputTaxAccountId?: unknown}} data */
export const setRestaurantApGlSettingsV2 = (data) => rpc('set_restaurant_ap_gl_settings',{p_payable_account_id:data.payableAccountId,p_input_tax_account_id:data.inputTaxAccountId||null})
/** @param {{supplierId?: unknown, supplierName?: unknown, billNumber?: unknown, billDate?: unknown, dueDate?: unknown, notes?: unknown, lines?: unknown, operationKey?: unknown, currency?: unknown, exchangeRate?: unknown, taxCode?: unknown, sourceDocumentRef?: unknown, sourceDocumentHash?: unknown}} data */
export const createRestaurantBillV2 = (data) => rpc('create_restaurant_bill_v3',{p_supplier_id:data.supplierId||null,p_supplier_name:data.supplierName,p_bill_number:data.billNumber,p_bill_date:data.billDate,p_due_date:data.dueDate,p_notes:data.notes||null,p_items:data.lines,p_idempotency_key:requireKey(data.operationKey),p_currency:data.currency||'BWP',p_exchange_rate:data.exchangeRate||1,p_tax_code:data.taxCode||null,p_source_document_ref:data.sourceDocumentRef||null,p_source_document_hash:data.sourceDocumentHash||null})
/** @param {unknown} billId */
export const submitRestaurantBillV2 = (billId) => rpc('submit_restaurant_bill',{p_bill_id:billId})
/** @param {unknown} billId @param {unknown} operationKey */
export const approveRestaurantBillV2 = (billId, operationKey) => rpc('approve_restaurant_bill',{p_bill_id:billId,p_idempotency_key:requireKey(operationKey)})
/** @param {{billId?: unknown, paymentDate?: unknown, amount?: unknown, paymentAccountId?: unknown, reference?: unknown, notes?: unknown, operationKey?: unknown}} data */
export const payRestaurantBillV2 = (data) => rpc('record_restaurant_bill_payment_v2',{p_bill_id:data.billId,p_payment_date:data.paymentDate,p_amount:data.amount,p_payment_account_id:data.paymentAccountId,p_reference:data.reference||null,p_notes:data.notes||null,p_idempotency_key:requireKey(data.operationKey)})
/** @param {{billId?: unknown, noteNumber?: unknown, noteDate?: unknown, reason?: unknown, lines?: unknown, sourceDocumentRef?: unknown, sourceDocumentHash?: unknown, operationKey?: unknown}} data */
export const createRestaurantApCreditNoteV2 = (data) => rpc('create_restaurant_ap_credit_note_v2',{p_bill_id:data.billId,p_note_number:data.noteNumber,p_note_date:data.noteDate,p_reason:data.reason,p_items:data.lines,p_source_document_ref:data.sourceDocumentRef||null,p_source_document_hash:data.sourceDocumentHash,p_idempotency_key:requireKey(data.operationKey)})
/** @param {unknown} creditNoteId */
export const submitRestaurantApCreditNoteV2 = (creditNoteId) => rpc('submit_restaurant_ap_credit_note_v2',{p_credit_note_id:creditNoteId})
/** @param {unknown} creditNoteId @param {unknown} operationKey */
export const approveRestaurantApCreditNoteV2 = (creditNoteId, operationKey) => rpc('approve_restaurant_ap_credit_note_v2',{p_credit_note_id:creditNoteId,p_idempotency_key:requireKey(operationKey)})
/** @param {{id?: unknown, accountId?: unknown, name?: unknown, bankName?: unknown, accountNumber?: unknown, accountType?: unknown, isActive?: unknown}} data */
export const saveRestaurantBankAccountV2 = (data) => rpc('save_restaurant_bank_account_v2',{p_id:data.id||null,p_account_id:data.accountId,p_name:data.name,p_bank_name:data.bankName||null,p_account_number:data.accountNumber,p_account_type:data.accountType,p_is_active:data.isActive??true})
/** @param {unknown} [bankAccountId] */
export const getRestaurantBankWorkspaceV2 = (bankAccountId=null) => dedupePromise(`accounting:v2:bank:${bankAccountId||''}`,()=>rpc('get_restaurant_bank_workspace_v2',{p_bank_account_id:bankAccountId}))
/** @param {unknown} bankTransactionId */
export const getRestaurantBankMatchCandidatesV1 = (bankTransactionId) => rpc('get_bank_match_candidates_v1',{p_bank_transaction_id:bankTransactionId})
export const getRestaurantBankExportV2 = () => rpc('get_restaurant_bank_export_v2')
/** @param {unknown} [filters] */
export const getRestaurantBankExportV3 = (filters = {}) => rpc('get_restaurant_bank_export_v3', { p_filters: filters })
/** @param {{bankAccountId?: unknown, transactions?: unknown, fileName?: unknown, operationKey?: unknown}} data */
export const importRestaurantBankStatementV2 = (data) => rpc('import_bank_statement_v2',{p_bank_account_id:data.bankAccountId,p_transactions:data.transactions,p_file_name:data.fileName,p_idempotency_key:requireKey(data.operationKey)})
/** @param {{bankAccountId?: unknown, transactions?: unknown, fileName?: unknown, operationKey?: unknown, openingBalance?: unknown, closingBalance?: unknown}} data */
export const importRestaurantBankStatementV3 = (data) => rpc('import_bank_statement_v3', { p_bank_account_id: data.bankAccountId, p_rows: data.transactions, p_file_name: data.fileName, p_operation_id: requireKey(data.operationKey), p_opening_balance: data.openingBalance, p_closing_balance: data.closingBalance })
/** @param {unknown} bankAccountId */
export const proposeRestaurantBankMatchesV2 = (bankAccountId) => rpc('propose_bank_matches_v2',{p_bank_account_id:bankAccountId})
/** @param {unknown} proposalId @param {unknown} approve */
export const reviewRestaurantBankMatchV2 = (proposalId,approve) => rpc('review_bank_match_v2',{p_proposal_id:proposalId,p_approve:Boolean(approve)})
/** @param {{bankTransactionId?: unknown, allocations?: unknown, reason?: unknown, evidence?: unknown}} data */
export const proposeRestaurantBankMatchAllocationV1 = (data) => rpc('propose_bank_match_allocations_v1',{p_bank_transaction_id:data.bankTransactionId,p_allocations:data.allocations,p_reason:data.reason,p_evidence:data.evidence||{}})
/** @param {unknown} allocationId @param {unknown} approve @param {unknown} [reason] */
export const reviewRestaurantBankMatchAllocationV1 = (allocationId,approve,reason='') => rpc('review_bank_match_allocation_v1',{p_allocation_id:allocationId,p_approve:Boolean(approve),p_reason:reason||null})
/** @param {unknown} transactionId @param {unknown} reason */
export const exceptRestaurantBankTransactionV2 = (transactionId,reason) => rpc('set_bank_transaction_exception',{p_transaction_id:transactionId,p_reason:reason})
/** @param {{bankAccountId?: unknown, statementImportId?: unknown, statementBalance?: unknown, reconciliationDate?: unknown, transactionIds?: unknown, adjustments?: unknown}} data */
export const createRestaurantBankReconciliationV2 = (data) => rpc('create_bank_reconciliation_v2',{p_bank_account_id:data.bankAccountId,p_statement_import_id:data.statementImportId,p_statement_balance:data.statementBalance,p_reconciliation_date:data.reconciliationDate,p_transaction_ids:data.transactionIds,p_adjustments:data.adjustments||[]})
/** @param {unknown} id @param {unknown} notes */
export const completeRestaurantBankReconciliationV2 = (id,notes) => rpc('complete_bank_reconciliation_v2',{p_reconciliation_id:id,p_notes:notes||null})
/** @param {unknown} id */
export const getRestaurantBankReconciliationPacketV2 = (id) => rpc('get_restaurant_bank_reconciliation_packet_v2',{p_reconciliation_id:id})
/** @param {{settlementId?: unknown, bankTransactionId?: unknown, evidenceRef?: unknown}} data */
export const matchRestaurantSettlementToBankTransactionV2 = (data) => rpc('match_restaurant_settlement_to_bank_transaction',{p_settlement_id:data.settlementId,p_bank_transaction_id:data.bankTransactionId,p_evidence_ref:data.evidenceRef})
export const getRestaurantTaxWorkspaceV2 = () => dedupePromise('accounting:v2:tax',()=>rpc('get_restaurant_tax_working_papers_v2'))
export const getRestaurantTaxAdjustmentsV2 = () => dedupePromise('accounting:v2:tax-adjustments',()=>rpc('get_restaurant_tax_adjustments'))
export const getRestaurantTaxExportV2 = () => rpc('get_restaurant_tax_export_v2')
/** @param {unknown} [filters] */
export const getRestaurantTaxExportV3 = (filters = {}) => rpc('get_restaurant_tax_export_v3', { p_filters: filters })
/** @param {{jurisdictionCode?: unknown, ruleVersion?: unknown, effectiveFrom?: unknown, effectiveTo?: unknown, outputTaxAccountId?: unknown, inputTaxAccountId?: unknown}} data */
export const setRestaurantTaxConfigurationV2 = (data) => rpc('set_restaurant_tax_configuration',{p_jurisdiction_code:data.jurisdictionCode,p_rule_version:data.ruleVersion,p_effective_from:data.effectiveFrom,p_effective_to:data.effectiveTo||null,p_output_tax_account_id:data.outputTaxAccountId,p_input_tax_account_id:data.inputTaxAccountId})
/** @param {{periodStart?: unknown, periodEnd?: unknown, configurationId?: unknown}} data */
export const generateRestaurantTaxWorkingPaperV2 = (data) => rpc('generate_restaurant_tax_working_paper',{p_period_start:data.periodStart,p_period_end:data.periodEnd,p_configuration_id:data.configurationId})
/** @param {{originalReturnId?: unknown, reason?: unknown, operationId?: unknown, configurationId?: unknown}} data */
export const createRestaurantTaxAmendmentV2 = (data) => rpc('create_restaurant_tax_amendment',{p_original_return_id:data.originalReturnId,p_reason:data.reason,p_operation_id:requireKey(data.operationId),p_configuration_id:data.configurationId||null})
/** @param {{amendmentId?: unknown, configurationId?: unknown}} data */
export const generateRestaurantTaxAmendmentWorkingPaperV2 = (data) => rpc('generate_restaurant_tax_amendment_working_paper',{p_amendment_id:data.amendmentId,p_configuration_id:data.configurationId||null})
/** @param {{payload?: unknown}} data */
export const recordRestaurantTaxAdjustmentV2 = (data) => rpc('record_restaurant_tax_adjustment',{payload:data.payload})
/** @param {unknown} adjustmentId */
export const approveRestaurantTaxAdjustmentV2 = (adjustmentId) => rpc('approve_restaurant_tax_adjustment',{p_adjustment_id:adjustmentId})
/** @param {unknown} id */
export const reviewRestaurantTaxWorkingPaperV2 = (id) => rpc('review_restaurant_tax_working_paper',{p_return_id:id})
/** @param {unknown} id */
export const approveRestaurantTaxWorkingPaperV2 = (id) => rpc('approve_restaurant_tax_working_paper',{p_return_id:id})
/** @param {unknown} id @param {unknown} reference @param {unknown} notes */
export const fileRestaurantTaxWorkingPaperV2 = (id,reference,notes) => rpc('record_restaurant_tax_filing',{p_return_id:id,p_filing_reference:reference,p_notes:notes||null})
/** @param {unknown} id */
export const getRestaurantTaxFilingPacketV2 = (id) => rpc('get_restaurant_tax_filing_packet_v2',{p_return_id:id})
/** @param {unknown} year */
export const getRestaurantBudgetMatrixV2 = (year) => dedupePromise(`accounting:v2:budgets:${year}`,()=>rpc('get_restaurant_budget_matrix_v2',{p_year:year}))
/** @param {unknown} year */
export const getRestaurantBudgetExportV2 = (year) => rpc('get_restaurant_budget_export_v2',{p_year:year})
/** @param {unknown} year @param {unknown} [filters] */
export const getRestaurantBudgetExportV3 = (year, filters = {}) => rpc('get_restaurant_budget_export_v3', { p_year: year, p_filters: filters })
/** @param {unknown} year @param {unknown} entries @param {unknown} operationKey */
export const saveRestaurantBudgetMatrixV2 = (year,entries,operationKey) => rpc('save_restaurant_budget_matrix_v2',{p_year:year,p_entries:entries,p_idempotency_key:requireKey(operationKey)})
/** @param {unknown} versionId */
export const approveRestaurantBudgetVersionV2 = (versionId) => rpc('approve_restaurant_budget_version',{p_version_id:versionId})
/** @param {{name?: unknown, description?: unknown, lines?: unknown, operationKey?: unknown}} data */
export const createRestaurantBudgetTemplateV2 = (data) => rpc('create_restaurant_budget_template_v2',{p_name:data.name,p_description:data.description||null,p_lines:data.lines,p_idempotency_key:requireKey(data.operationKey)})
/** @param {{templateId?: unknown, year?: unknown, month?: unknown, operationKey?: unknown}} data */
export const applyRestaurantBudgetTemplateV2 = (data) => rpc('apply_restaurant_budget_template_v2',{p_template_id:data.templateId,p_year:data.year,p_month:data.month,p_idempotency_key:requireKey(data.operationKey)})
/** @param {unknown} startDate @param {unknown} endDate */
export const getRestaurantFinancialStatementsV2 = (startDate,endDate) => dedupePromise(`accounting:v2:statements:${startDate}:${endDate}`,()=>rpc('get_restaurant_financial_statements_v3',{p_start_date:startDate,p_end_date:endDate}))
/** @param {unknown} startDate @param {unknown} endDate */
export const getRestaurantStatementsExportV2 = (startDate,endDate) => rpc('get_restaurant_statements_export_v2',{p_start_date:startDate,p_end_date:endDate})
/** @param {unknown} startDate @param {unknown} endDate @param {unknown} [filters] */
export const getRestaurantStatementsExportV3 = (startDate, endDate, filters = {}) => rpc('get_restaurant_statements_export_v3', { p_start_date: startDate, p_end_date: endDate, p_filters: filters })
export const getRestaurantPayrollWorkspaceV2 = () => dedupePromise('accounting:v2:payroll',()=>rpc('get_restaurant_payroll_workspace_v3'))
export const getRestaurantPayrollExportV2 = () => rpc('get_restaurant_payroll_export_v2')
/** @param {unknown} periodId @param {unknown} [filters] */
export const getRestaurantPayrollExportV3 = (periodId, filters = {}) => rpc('get_restaurant_payroll_export_v3', { p_pay_period_id: periodId, p_filters: filters })
/** @param {unknown} periodId */
export const getRestaurantPayrollRecordsV2 = (periodId) => rpc('get_restaurant_payroll_records_v2',{p_pay_period_id:periodId})
/** @param {{staffUserId?: unknown, effectiveFrom?: unknown, effectiveTo?: unknown, payType?: unknown, monthlySalary?: unknown, hourlyRate?: unknown, overtimeMultiplier?: unknown, standardMonthlyHours?: unknown, paymentReference?: unknown, bankAccountName?: unknown, bankAccountNumber?: unknown, bankBranchCode?: unknown}} data */
export const setRestaurantPayrollTermsV2 = (data) => rpc('set_restaurant_payroll_employment_terms',{p_staff_user_id:data.staffUserId,p_effective_from:data.effectiveFrom,p_effective_to:data.effectiveTo||null,p_pay_type:data.payType,p_monthly_salary:data.monthlySalary||0,p_hourly_rate:data.hourlyRate||0,p_overtime_multiplier:data.overtimeMultiplier,p_standard_monthly_hours:data.standardMonthlyHours,p_payment_reference:data.paymentReference||null,p_bank_account_name:data.bankAccountName||null,p_bank_account_number:data.bankAccountNumber||null,p_bank_branch_code:data.bankBranchCode||null})
/** @param {{jurisdictionCode?: unknown, ruleVersion?: unknown, effectiveFrom?: unknown, effectiveTo?: unknown, taxBrackets?: unknown, socialSecurityRate?: unknown, pensionRate?: unknown, healthAmount?: unknown, currency?: unknown, sourceReference?: unknown, sourceDocumentHash?: unknown, policyApproved?: unknown}} data */
export const setRestaurantPayrollConfigurationV2 = (data) => rpc('set_restaurant_payroll_statutory_configuration_v3',{p_jurisdiction_code:data.jurisdictionCode,p_rule_version:data.ruleVersion,p_effective_from:data.effectiveFrom,p_effective_to:data.effectiveTo||null,p_tax_brackets:data.taxBrackets,p_social_security_rate:data.socialSecurityRate,p_pension_rate:data.pensionRate,p_health_amount:data.healthAmount,p_currency:data.currency,p_source_reference:data.sourceReference,p_source_document_hash:data.sourceDocumentHash,p_policy_approved:data.policyApproved===true})
/** @param {{name?: unknown, startDate?: unknown, endDate?: unknown, configurationId?: unknown}} data */
export const createRestaurantPayPeriodV2 = (data) => rpc('create_restaurant_pay_period_v2',{p_name:data.name,p_start_date:data.startDate,p_end_date:data.endDate,p_configuration_id:data.configurationId})
/** @param {{periodId?: unknown, staffUserId?: unknown, regularHours?: unknown, overtimeHours?: unknown, sourceReference?: unknown}} data */
export const setRestaurantPayrollTimeV2 = (data) => rpc('set_restaurant_payroll_time_input',{p_pay_period_id:data.periodId,p_staff_user_id:data.staffUserId,p_regular_hours:data.regularHours,p_overtime_hours:data.overtimeHours,p_source_reference:data.sourceReference})
/** @param {unknown} id */
export const approveRestaurantPayrollTimeV2 = (id) => rpc('approve_restaurant_payroll_time_input',{p_time_input_id:id})
/** @param {unknown} id */
export const calculateRestaurantPayrollV2 = (id) => rpc('calculate_restaurant_payroll_v3',{p_pay_period_id:id})
/** @param {unknown} id @param {unknown} operationKey */
export const approveRestaurantPayrollV2 = (id, operationKey) => rpc('approve_restaurant_payroll_v3',{p_pay_period_id:id,p_operation_id:requireKey(operationKey)})
/** @param {unknown} id @param {unknown} operationKey @param {unknown} debitAccountId @param {unknown} [reason] */
export const exportRestaurantPayrollPaymentsV2 = (id, operationKey, debitAccountId, reason='') => rpc('export_restaurant_payroll_payments_v4',{p_pay_period_id:id,p_operation_id:requireKey(operationKey),p_debit_account_id:debitAccountId,p_reason:reason})
/** @param {{payrollExpenseAccountId?: unknown, netPayableAccountId?: unknown, taxPayableAccountId?: unknown, deductionsPayableAccountId?: unknown}} data */
export const setRestaurantPayrollGlSettingsV2 = (data) => rpc('set_restaurant_payroll_gl_settings',{p_payroll_expense_account_id:data.payrollExpenseAccountId,p_net_payable_account_id:data.netPayableAccountId,p_tax_payable_account_id:data.taxPayableAccountId,p_deductions_payable_account_id:data.deductionsPayableAccountId})
/** @param {unknown} id */
export const postRestaurantPayrollV2 = (id) => rpc('post_restaurant_payroll_to_gl_v2',{p_pay_period_id:id})
/** @param {unknown} id @param {unknown} operationKey @param {unknown} settlementDate @param {unknown} reference */
export const settleRestaurantPayrollV2 = (id, operationKey, settlementDate, reference) => rpc('settle_restaurant_payroll_v3',{p_pay_period_id:id,p_operation_id:requireKey(operationKey),p_settlement_date:settlementDate||null,p_reference:reference})
/** @param {unknown} id @param {unknown} operationKey @param {unknown} bankReference */
export const reconcileRestaurantPayrollSettlementV2 = (id, operationKey, bankReference) => rpc('reconcile_restaurant_payroll_settlement_v3',{p_pay_period_id:id,p_operation_id:requireKey(operationKey),p_bank_reference:bankReference})
/** @param {unknown} id @param {unknown} operationKey */
export const closeRestaurantPayrollV2 = (id, operationKey) => rpc('close_restaurant_payroll_v3',{p_pay_period_id:id,p_operation_id:requireKey(operationKey)})
/** @param {unknown} periodId */
export const getRestaurantPayrollReadinessV2 = (periodId) => rpc('get_restaurant_payroll_readiness_v2',{p_pay_period_id:periodId})
/** @param {{payPeriodId?: unknown, staffUserId?: unknown, attendanceSource?: unknown, expectedHours?: unknown, approvedHours?: unknown, disposition?: unknown, exclusionReason?: unknown, operationKey?: unknown}} data */
export const setRestaurantPayrollAttendanceDispositionV2 = (data) => rpc('set_restaurant_payroll_attendance_disposition_v3',{p_pay_period_id:data.payPeriodId,p_staff_user_id:data.staffUserId,p_attendance_source:data.attendanceSource,p_expected_hours:data.expectedHours,p_approved_hours:data.approvedHours,p_disposition:data.disposition,p_exclusion_reason:data.exclusionReason||null,p_operation_id:requireKey(data.operationKey)})
/** @param {unknown} periodId */
export const getRestaurantPayrollAttendanceReconciliationV2 = (periodId) => rpc('get_restaurant_payroll_attendance_reconciliation_v3',{p_pay_period_id:periodId})
export const getRestaurantAccountingReadinessV2 = () => dedupePromise('accounting:v2:readiness', () => rpc('get_restaurant_accounting_readiness'))
export const getRestaurantAccountingActivationStateV2 = () => rpc('get_restaurant_accounting_activation_state')
/** @param {{cutoverDate?: unknown, openingBalances?: unknown, evidenceManifest?: unknown, operationKey?: unknown}} data */
export const prepareRestaurantHistoricalCutoverV2 = (data) => rpc('prepare_restaurant_historical_cutover',{p_cutover_date:data.cutoverDate,p_opening_balances:data.openingBalances||[],p_evidence_manifest:data.evidenceManifest||{},p_operation_key:requireKey(data.operationKey)})
/** @param {{batchId?: unknown, reviewNotes?: unknown, expectedOpeningPayloadHash?: unknown, expectedSourceManifestHash?: unknown, expectedPreparedBy?: unknown}} data */
export const approveRestaurantHistoricalCutoverV2 = (data) => rpc('approve_restaurant_historical_cutover',{p_batch_id:data.batchId,p_review_notes:data.reviewNotes,p_expected_opening_payload_hash:data.expectedOpeningPayloadHash||null,p_expected_source_manifest_hash:data.expectedSourceManifestHash ?? null,p_expected_prepared_by:data.expectedPreparedBy ?? null})
export const getRestaurantHistoricalCutoverBatchesV2 = (limit = 20) => dedupePromise('accounting:v2:cutover-batches', () => rpc('get_restaurant_historical_cutover_batches',{p_limit:Math.min(Math.max(Number(limit) || 20, 1), 100)}))
/** @param {unknown} batchId */
export const getRestaurantHistoricalCutoverBatchV2 = (batchId) => {
  if (!batchId || !String(batchId).trim()) throw new Error('A cutover batch ID is required to load its authoritative state.')
  return rpc('get_restaurant_historical_cutover_batch',{p_batch_id:String(batchId).trim()})
}
/** @param {unknown} batchId */
export const applyRestaurantHistoricalCutoverV2 = (batchId) => {
  if (!batchId || !String(batchId).trim()) throw new Error('A cutover batch ID is required to apply opening balances.')
  return rpc('apply_restaurant_historical_cutover',{p_batch_id:String(batchId).trim()})
}
/** @param {{effectiveFrom?: unknown, configurationVersion?: unknown, policyVersion?: unknown, cutoverBatchId?: unknown}} data */
export const activateRestaurantAccountingV2 = (data) => rpc('activate_restaurant_accounting',{p_effective_from:data.effectiveFrom,p_configuration_version:data.configurationVersion,p_policy_version:data.policyVersion,p_cutover_batch_id:data.cutoverBatchId||null})
/** @param {unknown} reason */
export const suspendRestaurantAccountingV2 = (reason) => rpc('suspend_restaurant_accounting',{p_reason:reason})
/** @param {unknown} startDate @param {unknown} endDate */
export const getRestaurantFinancialSourceCoverageV2 = (startDate,endDate) => rpc('get_restaurant_financial_source_coverage',{p_start_date:startDate,p_end_date:endDate})
/** @param {{reportKey?: unknown, startDate?: unknown, endDate?: unknown, outletId?: unknown}} data */
export const startRestaurantReportRunV2 = (data) => rpc('start_restaurant_report_run',{p_report_key:data.reportKey,p_start_date:data.startDate||null,p_end_date:data.endDate||null,p_outlet_id:data.outletId||null})
/** @param {{reportRunId?: unknown, sections?: unknown, controlTotals?: unknown, dataHash?: unknown}} data */
export const completeRestaurantReportRunV2 = (data) => rpc('complete_restaurant_report_run',{p_report_run_id:data.reportRunId,p_sections:data.sections||{},p_control_totals:data.controlTotals||{},p_data_hash:data.dataHash||null})
/** @param {{reportRunId?: unknown, reason?: unknown}} data */
export const failRestaurantReportRunV2 = (data) => rpc('fail_restaurant_report_run',{p_report_run_id:data.reportRunId,p_reason:data.reason||'Report generation failed'})
/** @param {{periodStart?: unknown, periodEnd?: unknown, operationKey?: unknown}} data */
export const prepareRestaurantPeriodCloseV2 = (data) => rpc('prepare_restaurant_period_close',{p_period_start:data.periodStart,p_period_end:data.periodEnd,p_operation_key:requireKey(data.operationKey)})
/** @param {unknown} periodCloseId */
export const approveRestaurantPeriodCloseV2 = (periodCloseId) => rpc('approve_restaurant_period_close',{p_period_close_id:periodCloseId})
/** @param {unknown} periodCloseId @param {unknown} reason */
export const reopenRestaurantPeriodCloseV2 = (periodCloseId, reason) => rpc('reopen_restaurant_period_close',{p_period_close_id:periodCloseId,p_reason:reason})
/** @param {unknown} periodStart @param {unknown} periodEnd */
export const getRestaurantPeriodCloseV2 = (periodStart, periodEnd) => rpc('get_restaurant_period_close',{p_period_start:periodStart,p_period_end:periodEnd})
/** @param {{startDate?: unknown, endDate?: unknown, outletId?: unknown}} [data] */
export const getPosFinancialReportExportV2 = (data = {}) => rpc('get_pos_financial_report_export_v2',{p_start_date:data.startDate,p_end_date:data.endDate,p_outlet_id:data.outletId||null})
/** @param {{reportKey?: unknown, startDate?: unknown, endDate?: unknown, filters?: unknown}} [data] */
export const getLodgeOperationalReportExportV2 = (data = {}) => rpc('get_lodge_operational_report_export_v2',{p_report_key:data.reportKey,p_start_date:data.startDate,p_end_date:data.endDate,p_filters:data.filters||{}})
export const getStarterBasicReport = async (rangeDays = 1) => {
  const days = Number(rangeDays)
  if (![1, 7, 30].includes(days)) throw new Error('Basic report range must be one of 1, 7, or 30 days')
  const result = await rpc('get_starter_basic_report', { p_range_days: days })
  if (!result?.data || result.data.schema_version !== 'starter-basic-report-v1') {
    throw new Error('Starter basic report returned an invalid server response')
  }
  return result.data
}
/** @param {{reportRunId?: unknown, artifactType?: unknown, filePath?: unknown, fileHash?: unknown, byteCount?: unknown, artifactError?: unknown}} [data] */
export const recordReportArtifactResult = (data = {}) => rpc('record_report_artifact_result',{p_report_run_id:data.reportRunId,p_artifact_type:data.artifactType,p_file_path:data.filePath||null,p_file_hash:data.fileHash||null,p_byte_count:data.byteCount||0,p_artifact_error:data.artifactError||null})
/** @param {{exportId?: unknown, artifactType?: unknown, fileHash?: unknown, byteCount?: unknown, filePath?: unknown, detailedCompanionPath?: unknown, detailedCompanionHash?: unknown, artifactError?: unknown}} [data] */
export const recordAccountingExportArtifactV3 = (data = {}) => rpc('record_accounting_export_artifact_v3', { p_export_id: data.exportId, p_artifact_type: data.artifactType, p_file_hash: data.fileHash || null, p_byte_count: data.byteCount || 0, p_artifact_file_path: data.filePath || null, p_detailed_companion_path: data.detailedCompanionPath || null, p_detailed_companion_hash: data.detailedCompanionHash || null, p_artifact_error: data.artifactError || null })
