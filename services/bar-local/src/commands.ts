import {
  approvalPayloadHash,
  BAR_LOCAL_ERROR_CODES,
  BarLocalError,
  COMMANDS,
  object,
  operationPayloadHash,
  validateCommandOutcome,
  validateEnvelope
} from '@tsa-bonno/bar-contracts'
import type { CommandOutcome, Payload } from '@tsa-bonno/bar-contracts'
import type { Pool } from 'pg'
import { callFunction } from './db.js'
import type { FunctionArgument, JsonRecord } from './db.js'
import type { ServiceConfig } from './config.js'
import { hashPin } from './pin.js'

export const COMMAND_FUNCTIONS: Readonly<Record<string, string>> = Object.freeze({
  'sale.commit': 'bar_local.cmd_sale_commit',
  'sale.return': 'bar_local.cmd_sale_return',
  'sale.void': 'bar_local.cmd_sale_void',
  'sale.correct_after_close': 'bar_local.cmd_sale_correct_after_close',
  'tab.open': 'bar_local.cmd_tab_open',
  'tab.add': 'bar_local.cmd_tab_add',
  'tab.settle': 'bar_local.cmd_tab_settle',
  'tab.transfer': 'bar_local.cmd_tab_transfer',
  'tab.split': 'bar_local.cmd_tab_split',
  'tab.merge': 'bar_local.cmd_tab_merge',
  'shift.open': 'bar_local.cmd_shift_open',
  'shift.close': 'bar_local.cmd_shift_close',
  'drawer.movement': 'bar_local.cmd_drawer_movement',
  'cashup.submit': 'bar_local.cmd_cashup_submit',
  'cashup.review': 'bar_local.cmd_cashup_review',
  'cashup.reopen': 'bar_local.cmd_cashup_reopen',
  'stock.receive': 'bar_local.cmd_stock_receive',
  'stock.adjust': 'bar_local.cmd_stock_adjust',
  'stock.stocktake': 'bar_local.cmd_stock_stocktake',
  'stock.waste': 'bar_local.cmd_stock_waste',
  'stock.lot.waste': 'bar_local.cmd_stock_lot_waste',
  'stock.lot.release': 'bar_local.cmd_stock_lot_release',
  'stock.transfer': 'bar_local.cmd_stock_transfer',
  'supplier.upsert': 'bar_local.cmd_supplier_upsert',
  'purchase_order.create': 'bar_local.cmd_purchase_order_create',
  'purchase_order.cancel': 'bar_local.cmd_purchase_order_cancel',
  'purchase_order.receive': 'bar_local.cmd_purchase_order_receive',
  'customer.create': 'bar_local.cmd_customer_create',
  'customer.credit.payment': 'bar_local.cmd_credit_payment',
  'voucher.issue': 'bar_local.cmd_voucher_issue',
  'catalogue.upsert': 'bar_local.cmd_catalogue_upsert',
  'catalogue.availability.set': 'bar_local.cmd_catalogue_availability_set',
  'expense.create': 'bar_local.cmd_expense_create',
  'expense.void': 'bar_local.cmd_expense_void',
  'accounting.account.upsert': 'bar_local.cmd_accounting_account_upsert',
  'control.checklist.start': 'bar_local.cmd_control_checklist_start',
  'control.checklist.item.set': 'bar_local.cmd_control_checklist_item_set',
  'control.incident.log': 'bar_local.cmd_control_incident_log',
  'control.incident.resolve': 'bar_local.cmd_control_incident_resolve',
  'workforce.shift.schedule': 'bar_local.cmd_workforce_shift_schedule',
  'workforce.shift.cancel': 'bar_local.cmd_workforce_shift_cancel',
  'workforce.clock.in': 'bar_local.cmd_workforce_clock_in',
  'workforce.clock.out': 'bar_local.cmd_workforce_clock_out',
  'staff.create': 'bar_local.cmd_staff_create',
  'staff.status': 'bar_local.cmd_staff_status',
  'settings.update': 'bar_local.cmd_settings_update',
  'accounting.journal.post': 'bar_local.cmd_journal_post',
  'accounting.period.close': 'bar_local.cmd_period_close',
  'catalogue.modifier_group.upsert': 'bar_local.cmd_catalogue_modifier_group_upsert',
  'catalogue.modifier_option.upsert': 'bar_local.cmd_catalogue_modifier_option_upsert',
  'catalogue.product_modifier.set': 'bar_local.cmd_catalogue_product_modifier_set',
  'catalogue.recipe.set': 'bar_local.cmd_catalogue_recipe_set',
  'promotion.upsert': 'bar_local.cmd_promotion_upsert',
  'loyalty.program.upsert': 'bar_local.cmd_loyalty_program_upsert',
  'loyalty.account.enrol': 'bar_local.cmd_loyalty_account_enrol',
  'loyalty.points.earn': 'bar_local.cmd_loyalty_points_earn',
  'loyalty.points.redeem': 'bar_local.cmd_loyalty_points_redeem',
  'loyalty.points.adjust': 'bar_local.cmd_loyalty_points_adjust',
  'workforce.tip.allocate': 'bar_local.cmd_workforce_tip_allocate',
  'workforce.tip.payout': 'bar_local.cmd_workforce_tip_payout',
  'workforce.tip.payout.reverse': 'bar_local.cmd_workforce_tip_payout_reverse',
  'support.report.create': 'bar_local.cmd_support_report_create',
  'export.bundle.create': 'bar_local.cmd_export_bundle_create',
  'accounting.ap.invoice.upsert': 'bar_local.cmd_ap_invoice_upsert',
  'accounting.ap.invoice.approve': 'bar_local.cmd_ap_invoice_approve',
  'accounting.ap.payment.post': 'bar_local.cmd_ap_payment_post',
  'accounting.ap.payment.reverse': 'bar_local.cmd_ap_payment_reverse',
  'accounting.bank_account.upsert': 'bar_local.cmd_bank_account_upsert',
  'accounting.bank_statement.import': 'bar_local.cmd_bank_statement_import',
  'accounting.bank.reconcile': 'bar_local.cmd_bank_reconcile',
  'accounting.tax_code.upsert': 'bar_local.cmd_tax_code_upsert',
  'accounting.tax_return.prepare': 'bar_local.cmd_tax_return_prepare',
  'accounting.payroll_run.create': 'bar_local.cmd_payroll_run_create',
  'accounting.payroll_run.prepare': 'bar_local.cmd_payroll_run_prepare',
  'accounting.payroll_run.finalise': 'bar_local.cmd_payroll_run_finalise',
  'accounting.budget.upsert': 'bar_local.cmd_budget_upsert'
})

for (const command of Object.keys(COMMANDS)) {
  if (!COMMAND_FUNCTIONS[command]) {
    throw new Error(`Command ${command} is registered in contracts but has no local handler mapping.`)
  }
}

export function approvalHashFor(envelope: Parameters<typeof approvalPayloadHash>[0]): string {
  return approvalPayloadHash(envelope)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface ExecuteCommandOptions {
  pool: Pool
  config: ServiceConfig
  tokenHash: string
  deviceId: string
  envelope: Payload
}

export async function executeCommand(options: ExecuteCommandOptions): Promise<CommandOutcome | null> {
  const { pool, config, tokenHash, deviceId, envelope } = options
  const validated = validateEnvelope(envelope)
  if (validated.device_id !== deviceId) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_INVALID, 'The authenticated device does not match the command envelope.', { httpStatus: 401 })
  }
  const functionName = COMMAND_FUNCTIONS[validated.command]
  if (!functionName) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.COMMAND_NOT_REGISTERED, `Command ${validated.command} is not registered for local Bar authority.`)
  }
  const payloadHash = operationPayloadHash(validated)
  const approvalHash = approvalHashFor(validated)
  let dbEnvelope: unknown = validated
  let args: FunctionArgument[]

  if (validated.command === 'staff.create') {
    const payload = object(validated.payload, 'payload')
    const secret = hashPin(payload.pin, config.security.pinIterations)
    const redactedPayload = { ...payload }
    delete redactedPayload.pin
    dbEnvelope = { ...validated, payload: redactedPayload }
    args = [
      { value: tokenHash },
      { value: deviceId, cast: 'uuid' },
      { value: JSON.stringify(dbEnvelope), cast: 'jsonb' },
      { value: payloadHash },
      { value: approvalHash },
      { value: JSON.stringify(secret), cast: 'jsonb' }
    ]
  } else {
    args = [
      { value: tokenHash },
      { value: deviceId, cast: 'uuid' },
      { value: JSON.stringify(dbEnvelope), cast: 'jsonb' },
      { value: payloadHash },
      { value: approvalHash }
    ]
  }

  let lastError: unknown = new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local command did not complete.')
  for (let attempt = 0; attempt <= config.security.commandRetries; attempt += 1) {
    try {
      const result = await callFunction<JsonRecord>(pool, functionName, args)
      return result ? validateCommandOutcome(result) : null
    } catch (error) {
      lastError = error
      const retryable = error instanceof BarLocalError
        && error.code === BAR_LOCAL_ERROR_CODES.SERVICE_UNAVAILABLE
        && error.retrySameOperation
      if (!retryable || attempt === config.security.commandRetries) throw error
      await sleep(25 * (attempt + 1))
    }
  }
  throw lastError
}
