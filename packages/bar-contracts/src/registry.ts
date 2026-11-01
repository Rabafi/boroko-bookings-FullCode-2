import { BAR_LOCAL_ERROR_CODES, BarLocalError } from './errors.js'
import {
  array, boolean, dateString, enumeration, fail, integer, keys, longText, money, monthString,
  object, optionalBoolean, optionalInteger, optionalMoney, optionalString, optionalUuid,
  pin, quantity, string, uuid, validateItems, validateTenders
} from './validation.js'
import type { Payload } from './validation.js'

export const CONTRACT_VERSION = 1
export const PAYLOAD_VERSION = 1

export const CAPABILITIES = Object.freeze({
  POS_VIEW: 'pos.view',
  POS_MANAGE: 'pos.manage',
  POS_VOID: 'pos.void',
  POS_DISCOUNT: 'pos.discount',
  POS_CASHUP: 'pos.cashup',
  POS_REPORTS: 'pos.reports',
  MENU_MANAGE: 'pos.menu_manage',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  INVENTORY_APPROVE: 'inventory.approve',
  CUSTOMERS_MANAGE: 'customers.manage',
  VOUCHERS_MANAGE: 'vouchers.manage',
  STAFF_MANAGE: 'staff.manage',
  SETTINGS_MANAGE: 'settings.manage',
  ACCOUNTING_READ: 'accounting.read',
  ACCOUNTING_MANAGE: 'accounting.manage',
  ACCOUNTING_APPROVE: 'accounting.approve',
  BACKUP_MANAGE: 'backup.manage',
  EXPORT_MANAGE: 'export.manage'
})

export const ROLE_CAPABILITIES = Object.freeze({
  owner: Object.freeze(Object.values(CAPABILITIES)),
  manager: Object.freeze([
    CAPABILITIES.POS_VIEW, CAPABILITIES.POS_MANAGE, CAPABILITIES.POS_VOID, CAPABILITIES.POS_DISCOUNT,
    CAPABILITIES.POS_CASHUP, CAPABILITIES.POS_REPORTS, CAPABILITIES.MENU_MANAGE,
    CAPABILITIES.INVENTORY_VIEW, CAPABILITIES.INVENTORY_MANAGE, CAPABILITIES.INVENTORY_APPROVE,
    CAPABILITIES.CUSTOMERS_MANAGE, CAPABILITIES.VOUCHERS_MANAGE, CAPABILITIES.STAFF_MANAGE,
    CAPABILITIES.ACCOUNTING_READ, CAPABILITIES.ACCOUNTING_MANAGE,
    CAPABILITIES.EXPORT_MANAGE
  ]),
  cashier: Object.freeze([
    CAPABILITIES.POS_VIEW, CAPABILITIES.POS_MANAGE, CAPABILITIES.POS_REPORTS,
    CAPABILITIES.INVENTORY_VIEW, CAPABILITIES.CUSTOMERS_MANAGE
  ]),
  stock: Object.freeze([
    CAPABILITIES.POS_VIEW, CAPABILITIES.INVENTORY_VIEW, CAPABILITIES.INVENTORY_MANAGE
  ]),
  finance: Object.freeze([
    CAPABILITIES.POS_VIEW, CAPABILITIES.POS_REPORTS, CAPABILITIES.ACCOUNTING_READ,
    CAPABILITIES.ACCOUNTING_MANAGE, CAPABILITIES.ACCOUNTING_APPROVE, CAPABILITIES.EXPORT_MANAGE
  ])
})

export const ROLES = Object.freeze(Object.keys(ROLE_CAPABILITIES))

export interface CommandDefinition {
  readonly version: number
  readonly capability: string
  readonly approval: string | null
  readonly validate: (payload: Payload) => unknown
  readonly description: string
}

export interface QueryDefinition {
  readonly version: number
  readonly capability: string
  readonly validate: (filters: Payload) => Payload
}

const ITEM_KEYS = ['items']
const saleItems = (payload: Payload) => validateItems(payload.items, 'items', { max: 200 })
const saleTenders = (payload: Payload) => validateTenders(payload.tenders, 'tenders', { max: 20 })

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return dateString(value, field)
}

function objectValue(value: unknown, field: string): Payload {
  return object(value ?? {}, field)
}

function validateSaleCommit(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'shift_id', 'tab_id', 'expected_tab_version', 'customer_id', 'walk_in_name', 'items',
    'tenders', 'discount_amount', 'discount_reason', 'tip_amount', 'note', 'promotion_code', 'approval_id'
  ])
  const tabId = optionalUuid(payload.tab_id, 'tab_id')
  const items = tabId ? (payload.items === undefined ? [] : saleItems(payload)) : saleItems(payload)
  if (!tabId && items.length === 0) throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'items or tab_id is required')
  return {
    shift_id: uuid(payload.shift_id, 'shift_id'),
    tab_id: tabId,
    expected_tab_version: tabId ? integer(payload.expected_tab_version, 'expected_tab_version', { min: 1 }) : null,
    customer_id: optionalUuid(payload.customer_id, 'customer_id'),
    walk_in_name: optionalString(payload.walk_in_name, 'walk_in_name', { max: 120, trim: true }),
    items,
    tenders: saleTenders(payload),
    discount_amount: optionalMoney(payload.discount_amount, 'discount_amount', { maxScale: 2 }) ?? '0.00',
    discount_reason: optionalString(payload.discount_reason, 'discount_reason', { max: 300, trim: true }),
    tip_amount: optionalMoney(payload.tip_amount, 'tip_amount', { maxScale: 2 }) ?? '0.00',
    note: optionalString(payload.note, 'note', { max: 1000, trim: true }),
    promotion_code: optionalString(payload.promotion_code, 'promotion_code', { max: 32, trim: true }),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateSaleReturn(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['sale_id', 'reason', 'lines', 'disposition', 'approval_id'])
  array(payload.lines, 'lines', { min: 1, max: 200 }).forEach((line, index) => {
    const row = object(line, `lines[${index}]`)
    keys(row, `lines[${index}]`, ['sale_line_id', 'quantity'])
  })
  return {
    sale_id: uuid(payload.sale_id, 'sale_id'),
    reason: longText(payload.reason, 'reason', 500),
    lines: array(payload.lines, 'lines', { min: 1, max: 200 }).map((line, index) => {
      const row = object(line, `lines[${index}]`)
      return {
        sale_line_id: uuid(row.sale_line_id, `lines[${index}].sale_line_id`),
        quantity: quantity(row.quantity, `lines[${index}].quantity`)
      }
    }),
    disposition: enumeration(payload.disposition || 'restock', 'disposition', ['restock', 'waste']),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateSaleVoid(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['sale_id', 'reason', 'approval_id'])
  return {
    sale_id: uuid(payload.sale_id, 'sale_id'),
    reason: longText(payload.reason, 'reason', 500),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateSaleCorrectAfterClose(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['sale_id', 'kind', 'reason', 'lines', 'disposition', 'approval_id'])
  const kind = enumeration(payload.kind, 'kind', ['return', 'void'])
  const lines = payload.lines === undefined
    ? []
    : array(payload.lines, 'lines', { min: 0, max: 200 }).map((line, index) => {
      const row = object(line, `lines[${index}]`)
      keys(row, `lines[${index}]`, ['sale_line_id', 'quantity'])
      return {
        sale_line_id: uuid(row.sale_line_id, `lines[${index}].sale_line_id`),
        quantity: quantity(row.quantity, `lines[${index}].quantity`)
      }
    })
  if (kind === 'return' && lines.length === 0) {
    fail('lines', 'At least one sale line is required for a post-close return')
  }
  if (kind === 'void' && lines.length > 0) {
    fail('lines', 'A remaining-sale cancellation calculates its own lines')
  }
  return {
    sale_id: uuid(payload.sale_id, 'sale_id'),
    kind,
    reason: longText(payload.reason, 'reason', 500),
    lines,
    disposition: enumeration(payload.disposition || 'restock', 'disposition', ['restock', 'waste']),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateTabOpen(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['table_label', 'owner_staff_id', 'note'])
  return {
    table_label: optionalString(payload.table_label, 'table_label', { max: 120, trim: true }),
    owner_staff_id: optionalUuid(payload.owner_staff_id, 'owner_staff_id'),
    note: optionalString(payload.note, 'note', { max: 1000, trim: true })
  }
}

function validateTabAdd(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['tab_id', 'expected_version', 'items'])
  return {
    tab_id: uuid(payload.tab_id, 'tab_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    items: validateItems(payload.items, 'items', { max: 200 })
  }
}

function validateTabSettle(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['tab_id', 'expected_version', 'tenders', 'tip_amount', 'customer_id', 'discount_amount', 'promotion_code', 'approval_id'])
  return {
    tab_id: uuid(payload.tab_id, 'tab_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    tenders: saleTenders(payload),
    tip_amount: optionalMoney(payload.tip_amount, 'tip_amount', { maxScale: 2 }) ?? '0.00',
    customer_id: optionalUuid(payload.customer_id, 'customer_id'),
    discount_amount: optionalMoney(payload.discount_amount, 'discount_amount', { maxScale: 2 }) ?? '0.00',
    promotion_code: optionalString(payload.promotion_code, 'promotion_code', { max: 32, trim: true }),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateTabTransfer(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['tab_id', 'expected_version', 'target_staff_id', 'approval_id', 'reason'])
  return {
    tab_id: uuid(payload.tab_id, 'tab_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    target_staff_id: uuid(payload.target_staff_id, 'target_staff_id'),
    approval_id: optionalUuid(payload.approval_id, 'approval_id'),
    reason: optionalString(payload.reason, 'reason', { max: 300, trim: true })
  }
}

function validateTabSplit(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['source_tab_id', 'expected_version', 'line_ids', 'target_owner_staff_id', 'table_label', 'note', 'approval_id', 'reason'])
  const lineIds = array(payload.line_ids, 'line_ids', { min: 1, max: 200 }).map((lineId, index) => uuid(lineId, `line_ids[${index}]`))
  if (new Set(lineIds).size !== lineIds.length) fail('line_ids', 'must not contain duplicate lines')
  return {
    source_tab_id: uuid(payload.source_tab_id, 'source_tab_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    line_ids: lineIds,
    target_owner_staff_id: optionalUuid(payload.target_owner_staff_id, 'target_owner_staff_id'),
    table_label: optionalString(payload.table_label, 'table_label', { max: 120, trim: true }),
    note: optionalString(payload.note, 'note', { max: 1000, trim: true }),
    approval_id: optionalUuid(payload.approval_id, 'approval_id'),
    reason: optionalString(payload.reason, 'reason', { max: 300, trim: true })
  }
}

function validateTabMerge(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['source_tab_id', 'source_expected_version', 'target_tab_id', 'target_expected_version', 'approval_id', 'reason'])
  const sourceTabId = uuid(payload.source_tab_id, 'source_tab_id')
  const targetTabId = uuid(payload.target_tab_id, 'target_tab_id')
  if (sourceTabId === targetTabId) fail('target_tab_id', 'must differ from the source tab')
  return {
    source_tab_id: sourceTabId,
    source_expected_version: integer(payload.source_expected_version, 'source_expected_version', { min: 1 }),
    target_tab_id: targetTabId,
    target_expected_version: integer(payload.target_expected_version, 'target_expected_version', { min: 1 }),
    approval_id: optionalUuid(payload.approval_id, 'approval_id'),
    reason: optionalString(payload.reason, 'reason', { max: 300, trim: true })
  }
}

function validateShiftOpen(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['opening_float', 'note'])
  return {
    opening_float: money(payload.opening_float, 'opening_float', { allowZero: true, maxScale: 2 }),
    note: optionalString(payload.note, 'note', { max: 1000, trim: true })
  }
}

function validateShiftClose(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['shift_id', 'counted_cash', 'note'])
  return {
    shift_id: uuid(payload.shift_id, 'shift_id'),
    counted_cash: money(payload.counted_cash, 'counted_cash', { allowZero: true, maxScale: 2 }),
    note: optionalString(payload.note, 'note', { max: 1000, trim: true })
  }
}

function validateDrawerMovement(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['shift_id', 'type', 'amount', 'reason','source_shift_id','receiver_confirmed','approval_id'])
  const type = enumeration(payload.type, 'type', ['paid_in', 'paid_out', 'float', 'handover', 'count'])
  if(type!=='handover'&&['source_shift_id','receiver_confirmed','approval_id'].some(key=>payload[key]!==undefined)){
    fail('payload','handover fields cannot be attached to an ordinary drawer movement')
  }
  if(type==='handover'&&payload.receiver_confirmed!==true){
    fail('receiver_confirmed','must confirm that the receiving operator counted and received the cash')
  }
  return {
    shift_id: uuid(payload.shift_id, 'shift_id'),
    type,
    amount: money(payload.amount, 'amount', { allowZero: type === 'count', maxScale: 2 }),
    reason: longText(payload.reason, 'reason', 500),
    ...(type==='handover'?{
      source_shift_id:uuid(payload.source_shift_id,'source_shift_id'),
      receiver_confirmed:boolean(payload.receiver_confirmed,'receiver_confirmed'),
      approval_id:optionalUuid(payload.approval_id,'approval_id')
    }:{})
  }
}

function validateCashupSubmit(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['shift_id', 'counted_cash', 'counted_card', 'notes', 'proof_refs'])
  const proofRefs = payload.proof_refs === undefined ? [] : array(payload.proof_refs, 'proof_refs', { max: 20 })
    .map((value, index) => string(value, `proof_refs[${index}]`, { min: 1, max: 200, trim: true }))
  return {
    shift_id: uuid(payload.shift_id, 'shift_id'),
    counted_cash: money(payload.counted_cash, 'counted_cash', { allowZero: true, maxScale: 2 }),
    counted_card: optionalMoney(payload.counted_card, 'counted_card', { allowZero: true, maxScale: 2 }),
    notes: optionalString(payload.notes, 'notes', { max: 2000, trim: true }),
    proof_refs: proofRefs
  }
}

function validateCashupReview(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['cashup_id', 'decision', 'reason', 'approval_id'])
  return {
    cashup_id: uuid(payload.cashup_id, 'cashup_id'),
    decision: enumeration(payload.decision, 'decision', ['approved', 'rejected']),
    reason: optionalString(payload.reason, 'reason', { max: 1000, trim: true }),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateCashupReopen(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['cashup_id', 'expected_status', 'counted_cash', 'counted_card', 'notes', 'proof_refs', 'reason', 'approval_id'])
  const proofRefs = payload.proof_refs === undefined ? [] : array(payload.proof_refs, 'proof_refs', { max: 20 })
    .map((value, index) => string(value, `proof_refs[${index}]`, { min: 1, max: 200, trim: true }))
  const countedCash = money(payload.counted_cash, 'counted_cash', { allowZero: true, maxScale: 2 })
  const countedCard = optionalMoney(payload.counted_card, 'counted_card', { allowZero: true, maxScale: 2 })
  if (countedCash.startsWith('-')) fail('counted_cash', 'must not be negative')
  if (countedCard?.startsWith('-')) fail('counted_card', 'must not be negative')
  return {
    cashup_id: uuid(payload.cashup_id, 'cashup_id'),
    expected_status: enumeration(payload.expected_status, 'expected_status', ['approved', 'rejected']),
    counted_cash: countedCash,
    counted_card: countedCard,
    notes: optionalString(payload.notes, 'notes', { max: 2000, trim: true }),
    proof_refs: proofRefs,
    reason: longText(payload.reason, 'reason', 1000),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateStockReceive(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['product_id', 'quantity', 'unit_cost', 'supplier_ref', 'lot_code', 'expires_on'])
  return {
    product_id: uuid(payload.product_id, 'product_id'),
    quantity: quantity(payload.quantity, 'quantity'),
    unit_cost: optionalMoney(payload.unit_cost, 'unit_cost', { allowZero: true, maxScale: 4 }),
    supplier_ref: optionalString(payload.supplier_ref, 'supplier_ref', { max: 160, trim: true }),
    lot_code: optionalString(payload.lot_code, 'lot_code', { max: 120, trim: true }),
    expires_on: payload.expires_on ? dateString(payload.expires_on, 'expires_on') : null
  }
}

function validateStockAdjust(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['product_id', 'delta', 'reason', 'approval_id'])
  const delta = quantity(payload.delta, 'delta', { allowZero: false, maxScale: 6 })
  if (!delta.startsWith('-')) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'delta must be negative; use stock.receive for increases')
  }
  return {
    product_id: uuid(payload.product_id, 'product_id'),
    delta,
    reason: longText(payload.reason, 'reason', 500),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateStockStocktake(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['product_id', 'counted_quantity', 'reason'])
  return {
    product_id: uuid(payload.product_id, 'product_id'),
    counted_quantity: quantity(payload.counted_quantity, 'counted_quantity', { allowZero: true }),
    reason: optionalString(payload.reason, 'reason', { max: 500, trim: true })
  }
}

function validateStockWaste(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['product_id', 'quantity', 'reason', 'approval_id'])
  return {
    product_id: uuid(payload.product_id, 'product_id'),
    quantity: quantity(payload.quantity, 'quantity'),
    reason: longText(payload.reason, 'reason', 500),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateStockLotWaste(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['lot_id', 'product_id', 'expected_version', 'quantity', 'reason', 'approval_id'])
  return {
    lot_id: uuid(payload.lot_id, 'lot_id'),
    product_id: uuid(payload.product_id, 'product_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    quantity: quantity(payload.quantity, 'quantity'),
    reason: longText(payload.reason, 'reason', 500),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateStockLotRelease(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['lot_id', 'expected_version', 'verified_lot_code', 'verified_expires_on', 'no_expiry_confirmed', 'reason', 'approval_id'])
  return {
    lot_id: uuid(payload.lot_id, 'lot_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    verified_lot_code: string(payload.verified_lot_code, 'verified_lot_code', { min: 1, max: 120, trim: true }),
    verified_expires_on: optionalDate(payload.verified_expires_on, 'verified_expires_on'),
    no_expiry_confirmed: boolean(payload.no_expiry_confirmed, 'no_expiry_confirmed'),
    reason: longText(payload.reason, 'reason', 500),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateStockTransfer(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['product_id', 'to_outlet_id', 'quantity', 'reason'])
  return {
    product_id: uuid(payload.product_id, 'product_id'),
    to_outlet_id: uuid(payload.to_outlet_id, 'to_outlet_id'),
    quantity: quantity(payload.quantity, 'quantity'),
    reason: longText(payload.reason, 'reason', 500)
  }
}

function validateSupplierUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'supplier_id', 'expected_version', 'name', 'contact_name', 'phone', 'email', 'address', 'notes', 'active'
  ])
  const supplierId = optionalUuid(payload.supplier_id, 'supplier_id')
  const expectedVersion = optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  if ((supplierId === null) !== (expectedVersion === null)) {
    fail('expected_version', 'supplier_id and expected_version must be supplied together')
  }
  return {
    supplier_id: supplierId,
    expected_version: expectedVersion,
    name: string(payload.name, 'name', { min: 1, max: 160, trim: true }),
    contact_name: optionalString(payload.contact_name, 'contact_name', { max: 160, trim: true }),
    phone: optionalString(payload.phone, 'phone', { max: 40, trim: true }),
    email: optionalString(payload.email, 'email', { max: 200, trim: true }),
    address: optionalString(payload.address, 'address', { max: 500, trim: true }),
    notes: optionalString(payload.notes, 'notes', { max: 2000, trim: true }),
    active: optionalBoolean(payload.active, 'active', true)
  }
}

function validatePurchaseOrderCreate(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['supplier_id', 'expected_supplier_version', 'expected_on', 'notes', 'lines', 'approval_id'])
  const lines = array(payload.lines, 'lines', { min: 1, max: 200 }).map((line, index) => {
    const row = object(line, `lines[${index}]`)
    keys(row, `lines[${index}]`, ['product_id', 'quantity', 'unit_cost', 'tax_rate'])
    const taxRate = optionalMoney(row.tax_rate, `lines[${index}].tax_rate`, { allowZero: true, maxScale: 4 })
    if (taxRate !== null && Number.parseFloat(taxRate) > 1) fail(`lines[${index}].tax_rate`, 'must be between 0 and 1')
    return {
      product_id: uuid(row.product_id, `lines[${index}].product_id`),
      quantity: quantity(row.quantity, `lines[${index}].quantity`),
      unit_cost: money(row.unit_cost, `lines[${index}].unit_cost`, { allowZero: true, maxScale: 4 }),
      tax_rate: taxRate
    }
  })
  if (new Set(lines.map((line) => line.product_id)).size !== lines.length) {
    fail('lines', 'must not contain duplicate products')
  }
  return {
    supplier_id: uuid(payload.supplier_id, 'supplier_id'),
    expected_supplier_version: optionalInteger(payload.expected_supplier_version, 'expected_supplier_version', { min: 1 }),
    expected_on: payload.expected_on ? dateString(payload.expected_on, 'expected_on') : null,
    notes: optionalString(payload.notes, 'notes', { max: 2000, trim: true }),
    lines,
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validatePurchaseOrderCancel(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['purchase_order_id', 'expected_version', 'reason', 'approval_id'])
  return {
    purchase_order_id: uuid(payload.purchase_order_id, 'purchase_order_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    reason: longText(payload.reason, 'reason', 1000),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validatePurchaseOrderReceive(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['purchase_order_id', 'expected_version', 'supplier_reference', 'notes', 'received_on', 'lines'])
  const lines = array(payload.lines, 'lines', { min: 1, max: 200 }).map((line, index) => {
    const row = object(line, `lines[${index}]`)
    keys(row, `lines[${index}]`, ['purchase_order_line_id', 'quantity', 'unit_cost', 'lot_code', 'expires_on'])
    return {
      purchase_order_line_id: uuid(row.purchase_order_line_id, `lines[${index}].purchase_order_line_id`),
      quantity: quantity(row.quantity, `lines[${index}].quantity`),
      unit_cost: optionalMoney(row.unit_cost, `lines[${index}].unit_cost`, { allowZero: true, maxScale: 4 }),
      lot_code: optionalString(row.lot_code, `lines[${index}].lot_code`, { max: 120, trim: true }),
      expires_on: row.expires_on ? dateString(row.expires_on, `lines[${index}].expires_on`) : null
    }
  })
  return {
    purchase_order_id: uuid(payload.purchase_order_id, 'purchase_order_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    supplier_reference: optionalString(payload.supplier_reference, 'supplier_reference', { max: 160, trim: true }),
    notes: optionalString(payload.notes, 'notes', { max: 2000, trim: true }),
    received_on: payload.received_on ? dateString(payload.received_on, 'received_on') : null,
    lines
  }
}

function validateCustomerCreate(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['name', 'phone', 'email', 'credit_limit'])
  return {
    name: string(payload.name, 'name', { min: 1, max: 160, trim: true }),
    phone: optionalString(payload.phone, 'phone', { max: 40, trim: true }),
    email: optionalString(payload.email, 'email', { max: 200, trim: true }),
    credit_limit: optionalMoney(payload.credit_limit, 'credit_limit', { allowZero: true, maxScale: 2 }) ?? '0.00'
  }
}

function validateCreditPayment(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['customer_id', 'amount', 'method', 'shift_id', 'reference'])
  return {
    customer_id: uuid(payload.customer_id, 'customer_id'),
    amount: money(payload.amount, 'amount', { allowZero: false, maxScale: 2 }),
    method: enumeration(payload.method, 'method', ['cash', 'card', 'bank_transfer']),
    shift_id: uuid(payload.shift_id, 'shift_id'),
    reference: optionalString(payload.reference, 'reference', { max: 120, trim: true })
  }
}

function validateVoucherIssue(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['amount', 'code', 'expires_on', 'customer_id', 'approval_id'])
  return {
    amount: money(payload.amount, 'amount', { allowZero: false, maxScale: 2 }),
    code: optionalString(payload.code, 'code', { max: 60, trim: true, pattern: /^[A-Za-z0-9_-]+$/ }),
    expires_on: payload.expires_on ? dateString(payload.expires_on, 'expires_on') : null,
    customer_id: optionalUuid(payload.customer_id, 'customer_id'),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateCatalogueUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['product_id', 'expected_version', 'sku', 'name', 'category', 'price', 'tax_rate', 'track_stock', 'active'])
  const productId = optionalUuid(payload.product_id, 'product_id')
  const expectedVersion = optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  if (productId && expectedVersion === null) fail('expected_version', 'is required when updating a product')
    if (!productId && expectedVersion !== null) fail('expected_version', 'is only valid when updating a product')
  return {
    product_id: productId,
    expected_version: expectedVersion,
    sku: string(payload.sku, 'sku', { min: 1, max: 80, trim: true }),
    name: string(payload.name, 'name', { min: 1, max: 200, trim: true }),
    category: optionalString(payload.category, 'category', { max: 80, trim: true }),
    price: money(payload.price, 'price', { allowZero: true, maxScale: 2 }),
    tax_rate: money(String(payload.tax_rate ?? '0'), 'tax_rate', { allowZero: true, maxScale: 4 }),
    track_stock: optionalBoolean(payload.track_stock, 'track_stock', true),
    active: optionalBoolean(payload.active, 'active', true)
  }
}

function validateCatalogueAvailability(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['product_id', 'available', 'expected_version'])
  return {
    product_id: uuid(payload.product_id, 'product_id'),
    available: boolean(payload.available, 'available'),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateExpenseCreate(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'expense_date', 'category', 'description', 'amount', 'expense_account_code',
    'payment_account_code', 'supplier_id', 'reference'
  ])
  return {
    expense_date: dateString(payload.expense_date, 'expense_date'),
    category: string(payload.category, 'category', { min: 1, max: 80, trim: true }),
    description: longText(payload.description, 'description', 500),
    amount: money(payload.amount, 'amount'),
    expense_account_code: string(payload.expense_account_code, 'expense_account_code', { min: 1, max: 32, trim: true }),
    payment_account_code: string(payload.payment_account_code, 'payment_account_code', { min: 1, max: 32, trim: true }),
    supplier_id: optionalUuid(payload.supplier_id, 'supplier_id'),
    reference: optionalString(payload.reference, 'reference', { max: 120, trim: true })
  }
}

function validateExpenseVoid(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['expense_id', 'expected_version', 'reason', 'approval_id'])
  return {
    expense_id: uuid(payload.expense_id, 'expense_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    reason: longText(payload.reason, 'reason', 500),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateAccountingAccountUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['code', 'name', 'type', 'active', 'expected_version'])
  return {
    code: string(payload.code, 'code', { min: 1, max: 32, trim: true, pattern: /^[0-9A-Za-z][0-9A-Za-z.-]{0,31}$/ }),
    name: string(payload.name, 'name', { min: 1, max: 120, trim: true }),
    type: enumeration(payload.type, 'type', ['asset', 'liability', 'equity', 'revenue', 'expense']),
    active: payload.active === undefined ? true : boolean(payload.active, 'active'),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateChecklistStart(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['template_key', 'checklist_date', 'shift_id'])
  return {
    template_key: string(payload.template_key, 'template_key', { min: 1, max: 80, trim: true, pattern: /^[a-z0-9][a-z0-9._-]*$/ }),
    checklist_date: payload.checklist_date === undefined || payload.checklist_date === null ? null : dateString(payload.checklist_date, 'checklist_date'),
    shift_id: optionalUuid(payload.shift_id, 'shift_id')
  }
}

function validateChecklistItemSet(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['checklist_id', 'item_id', 'completed', 'note', 'expected_version'])
  return {
    checklist_id: uuid(payload.checklist_id, 'checklist_id'),
    item_id: uuid(payload.item_id, 'item_id'),
    completed: boolean(payload.completed, 'completed'),
    note: optionalString(payload.note, 'note', { max: 500, trim: true }),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateIncidentLog(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['incident_date', 'category', 'severity', 'description', 'immediate_action'])
  return {
    incident_date: payload.incident_date === undefined || payload.incident_date === null ? null : dateString(payload.incident_date, 'incident_date'),
    category: string(payload.category, 'category', { min: 1, max: 80, trim: true }),
    severity: enumeration(payload.severity, 'severity', ['low', 'medium', 'high', 'critical']),
    description: longText(payload.description, 'description', 2000),
    immediate_action: optionalString(payload.immediate_action, 'immediate_action', { max: 1000, trim: true })
  }
}

function validateIncidentResolve(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['incident_id', 'expected_version', 'resolution'])
  return {
    incident_id: uuid(payload.incident_id, 'incident_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    resolution: longText(payload.resolution, 'resolution', 2000)
  }
}

function validateWorkforceShiftSchedule(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'shift_id', 'staff_id', 'work_date', 'starts_at', 'ends_at', 'break_minutes',
    'role_label', 'notes', 'expected_version'
  ])
  const shiftId = optionalUuid(payload.shift_id, 'shift_id')
  const startsAt = string(payload.starts_at, 'starts_at', { min: 5, max: 5, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ })
  const endsAt = string(payload.ends_at, 'ends_at', { min: 5, max: 5, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ })
  if (startsAt === endsAt) fail('ends_at', 'must differ from starts_at')
  return {
    shift_id: shiftId,
    staff_id: uuid(payload.staff_id, 'staff_id'),
    work_date: dateString(payload.work_date, 'work_date'),
    starts_at: startsAt,
    ends_at: endsAt,
    break_minutes: integer(payload.break_minutes ?? 0, 'break_minutes', { min: 0, max: 720 }),
    role_label: optionalString(payload.role_label, 'role_label', { max: 80, trim: true }),
    notes: optionalString(payload.notes, 'notes', { max: 500, trim: true }),
    expected_version: shiftId
      ? integer(payload.expected_version, 'expected_version', { min: 1 })
      : null
  }
}

function validateWorkforceShiftCancel(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['shift_id', 'expected_version', 'reason'])
  return {
    shift_id: uuid(payload.shift_id, 'shift_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    reason: longText(payload.reason, 'reason', 500)
  }
}

function validateWorkforceClockIn(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['staff_id', 'workforce_shift_id', 'trading_shift_id', 'note'])
  return {
    staff_id: optionalUuid(payload.staff_id, 'staff_id'),
    workforce_shift_id: optionalUuid(payload.workforce_shift_id, 'workforce_shift_id'),
    trading_shift_id: optionalUuid(payload.trading_shift_id, 'trading_shift_id'),
    note: optionalString(payload.note, 'note', { max: 500, trim: true })
  }
}

function validateWorkforceClockOut(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['attendance_id', 'note'])
  return {
    attendance_id: uuid(payload.attendance_id, 'attendance_id'),
    note: optionalString(payload.note, 'note', { max: 500, trim: true })
  }
}

function validateStaffCreate(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['display_name', 'role', 'pin', 'capabilities', 'approval_id'])
  const capabilities = payload.capabilities === undefined
    ? null
    : array(payload.capabilities, 'capabilities', { max: 40 }).map((value, index) => enumeration(value, `capabilities[${index}]`, Object.values(CAPABILITIES)))
  return {
    display_name: string(payload.display_name, 'display_name', { min: 1, max: 120, trim: true }),
    role: enumeration(payload.role, 'role', Object.keys(ROLE_CAPABILITIES)),
    pin: pin(payload.pin),
    approval_id: optionalUuid(payload.approval_id, 'approval_id'),
    capabilities
  }
}

function validateStaffStatus(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['staff_id', 'status', 'reason', 'approval_id'])
  return {
    staff_id: uuid(payload.staff_id, 'staff_id'),
    status: enumeration(payload.status, 'status', ['active', 'suspended']),
    reason: longText(payload.reason, 'reason', 500),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

const SETTING_KEYS = [
  'business_name', 'currency', 'timezone', 'receipt_footer', 'tax_inclusive',
  'allow_negative_stock', 'default_tax_rate', 'receipt_series',
  'discount_approval_threshold_percent', 'discount_max_percent'
]

function validateSettingValue(key: string, value: unknown) {
  if (key === 'business_name' || key === 'receipt_footer') {
    return string(value, key, { min: 1, max: 500, trim: true })
  }
  if (key === 'receipt_series') {
    return string(value, key, { min: 1, max: 8, pattern: /^[A-Za-z0-9_-]+$/ })
  }
  if (key === 'currency') {
    return string(value, key, { min: 3, max: 3, pattern: /^[A-Z]{3}$/ })
  }
  if (key === 'timezone') {
    return string(value, key, { min: 1, max: 80, pattern: /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/ })
  }
  if (key === 'tax_inclusive' || key === 'allow_negative_stock') {
    return boolean(value, key)
  }
  if (key === 'discount_approval_threshold_percent' || key === 'discount_max_percent') {
    const percent = money(String(value ?? ''), key, { allowZero: true, maxScale: 4, maxIntegerDigits: 3 })
    if (Number.parseFloat(percent) > 100) fail(key, 'must be between 0 and 100')
    return percent
  }
  const rate = money(String(value ?? ''), key, { allowZero: true, maxScale: 4, maxIntegerDigits: 1 })
  if (Number.parseFloat(rate) > 1) fail(key, 'must be between 0 and 1')
  return rate
}

function validateSettingsUpdate(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['key', 'value', 'expected_version'])
  const key = enumeration(payload.key, 'key', SETTING_KEYS)
  return {
    key,
    value: validateSettingValue(key, payload.value),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 0 })
  }
}

function validateJournalPost(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['entry_date', 'memo', 'lines', 'source_type', 'source_id'])
  const lines = array(payload.lines, 'lines', { min: 2, max: 500 }).map((line, index) => {
    const row = object(line, `lines[${index}]`)
    keys(row, `lines[${index}]`, ['account_code', 'debit', 'credit', 'description'])
    return {
      account_code: string(row.account_code, `lines[${index}].account_code`, { min: 1, max: 40, trim: true }),
      debit: optionalMoney(row.debit, `lines[${index}].debit`, { allowZero: true, maxScale: 2 }) ?? '0.00',
      credit: optionalMoney(row.credit, `lines[${index}].credit`, { allowZero: true, maxScale: 2 }) ?? '0.00',
      description: optionalString(row.description, `lines[${index}].description`, { max: 500, trim: true })
    }
  })
  return {
    entry_date: dateString(payload.entry_date, 'entry_date'),
    memo: longText(payload.memo, 'memo', 1000),
    lines,
    source_type: string(payload.source_type, 'source_type', { min: 1, max: 60, trim: true }),
    source_id: optionalUuid(payload.source_id, 'source_id')
  }
}

function validatePeriodClose(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['period', 'approval_id'])
  return {
    period: monthString(payload.period, 'period'),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateModifierGroupUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'modifier_group_id', 'code', 'name', 'required', 'min_selections', 'max_selections',
    'active', 'expected_version'
  ])
  return {
    modifier_group_id: optionalUuid(payload.modifier_group_id, 'modifier_group_id'),
    code: string(payload.code, 'code', { min: 1, max: 32, pattern: /^[A-Za-z0-9_-]+$/, trim: true }),
    name: string(payload.name, 'name', { min: 1, max: 120, trim: true }),
    required: optionalBoolean(payload.required, 'required', false),
    min_selections: optionalInteger(payload.min_selections, 'min_selections', { min: 0 }) ?? 0,
    max_selections: optionalInteger(payload.max_selections, 'max_selections', { min: 1 }) ?? 1,
    active: optionalBoolean(payload.active, 'active'),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateModifierOptionUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'modifier_option_id', 'modifier_group_id', 'code', 'name', 'price_delta',
    'sort_order', 'active', 'expected_version'
  ])
  return {
    modifier_option_id: optionalUuid(payload.modifier_option_id, 'modifier_option_id'),
    modifier_group_id: uuid(payload.modifier_group_id, 'modifier_group_id'),
    code: string(payload.code, 'code', { min: 1, max: 32, pattern: /^[A-Za-z0-9_-]+$/, trim: true }),
    name: string(payload.name, 'name', { min: 1, max: 120, trim: true }),
    price_delta: optionalMoney(payload.price_delta, 'price_delta', { allowZero: true, maxScale: 2 }) ?? '0.00',
    sort_order: optionalInteger(payload.sort_order, 'sort_order') ?? 0,
    active: optionalBoolean(payload.active, 'active'),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateProductModifierSet(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['product_id', 'groups', 'expected_version'])
  const groups = array(payload.groups ?? [], 'groups', { max: 50 }).map((group, index) => {
    const path = `groups[${index}]`
    if (typeof group === 'string') return uuid(group, path)
    const row = object(group, path)
    keys(row, path, ['modifier_group_id', 'group_id', 'sort_order'])
    const groupId = optionalUuid(row.modifier_group_id, `${path}.modifier_group_id`)
      ?? optionalUuid(row.group_id, `${path}.group_id`)
    if (!groupId) fail(`${path}.modifier_group_id`, 'is required')
    return {
      modifier_group_id: groupId,
      sort_order: optionalInteger(row.sort_order, `${path}.sort_order`, { min: 0 })
    }
  })
  return {
    product_id: uuid(payload.product_id, 'product_id'),
    groups,
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateRecipeSet(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['product_id', 'lines', 'expected_version'])
  const lines = array(payload.lines ?? [], 'lines', { max: 200 }).map((line, index) => {
    const path = `lines[${index}]`
    const row = object(line, path)
    keys(row, path, ['ingredient_product_id', 'product_id', 'quantity', 'unit_cost'])
    const ingredientId = optionalUuid(row.ingredient_product_id, `${path}.ingredient_product_id`)
      ?? optionalUuid(row.product_id, `${path}.product_id`)
    if (!ingredientId) fail(`${path}.ingredient_product_id`, 'is required')
    return {
      ingredient_product_id: ingredientId,
      quantity: quantity(row.quantity, `${path}.quantity`),
      unit_cost: optionalMoney(row.unit_cost, `${path}.unit_cost`, { allowZero: true, maxScale: 2 }) ?? '0.00'
    }
  })
  const ingredients = lines.map((line) => line.ingredient_product_id)
  if (new Set(ingredients).size !== ingredients.length) fail('lines', 'must not contain duplicate ingredients')
  return {
    product_id: uuid(payload.product_id, 'product_id'),
    lines,
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 0 })
  }
}

function validatePromotionUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'promotion_id', 'code', 'name', 'discount_type', 'percent', 'amount',
    'minimum_subtotal', 'scope', 'product_id', 'category', 'active',
    'starts_on', 'ends_on', 'expected_version'
  ])
  const discountType = enumeration(payload.discount_type, 'discount_type', ['percent', 'amount'])
  const percent = optionalMoney(payload.percent, 'percent', { allowZero: true, maxScale: 4 }) ?? '0.00'
  const amount = optionalMoney(payload.amount, 'amount', { allowZero: true, maxScale: 2 }) ?? '0.00'
  const minimum = optionalMoney(payload.minimum_subtotal, 'minimum_subtotal', { allowZero: true, maxScale: 2 }) ?? '0.00'
  if (Number.parseFloat(percent) > 100) fail('percent', 'must be between 0 and 100')
  if (Number.parseFloat(minimum) < 0) fail('minimum_subtotal', 'must not be negative')
  if (discountType === 'percent' && Number.parseFloat(percent) <= 0) fail('percent', 'must be greater than zero for a percentage promotion')
  if (discountType === 'percent' && Number.parseFloat(amount) !== 0) fail('amount', 'must be zero for a percentage promotion')
  if (discountType === 'amount' && Number.parseFloat(amount) <= 0) fail('amount', 'must be greater than zero for a fixed promotion')
  if (discountType === 'amount' && Number.parseFloat(percent) !== 0) fail('percent', 'must be zero for a fixed promotion')
  return {
    promotion_id: optionalUuid(payload.promotion_id, 'promotion_id'),
    code: string(payload.code, 'code', { min: 1, max: 32, pattern: /^[A-Za-z0-9_-]+$/, trim: true }),
    name: string(payload.name, 'name', { min: 1, max: 160, trim: true }),
    discount_type: discountType,
    percent,
    amount,
    minimum_subtotal: minimum,
    scope: enumeration(payload.scope ?? 'all', 'scope', ['all', 'product', 'category']),
    product_id: optionalUuid(payload.product_id, 'product_id'),
    category: optionalString(payload.category, 'category', { max: 120, trim: true }),
    active: optionalBoolean(payload.active, 'active'),
    starts_on: optionalDate(payload.starts_on, 'starts_on'),
    ends_on: optionalDate(payload.ends_on, 'ends_on'),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateLoyaltyProgramUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'program_id', 'outlet_id', 'name', 'earn_rate', 'redeem_value',
    'min_redeem_points', 'active', 'expected_version'
  ])
  const validated: Payload = {
    program_id: optionalUuid(payload.program_id, 'program_id'),
    name: optionalString(payload.name, 'name', { max: 120, trim: true }),
    earn_rate: money(payload.earn_rate, 'earn_rate', { allowZero: true, maxScale: 4 }),
    redeem_value: optionalMoney(payload.redeem_value, 'redeem_value', { allowZero: true, maxScale: 4 }) ?? '0.00',
    min_redeem_points: optionalInteger(payload.min_redeem_points, 'min_redeem_points', { min: 0 }) ?? 0,
    active: optionalBoolean(payload.active, 'active', true),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
  if (payload.outlet_id !== undefined) validated.outlet_id = optionalUuid(payload.outlet_id, 'outlet_id')
  return validated
}

function validateLoyaltyAccountEnrol(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['customer_id'])
  return { customer_id: uuid(payload.customer_id, 'customer_id') }
}

function validateLoyaltyPointsEarn(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['sale_id', 'customer_id', 'reference'])
  return {
    sale_id: uuid(payload.sale_id, 'sale_id'),
    customer_id: uuid(payload.customer_id, 'customer_id'),
    reference: optionalString(payload.reference, 'reference', { max: 200, trim: true })
  }
}

function validateLoyaltyPointsRedeem(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['customer_id', 'points', 'reference', 'sale_id'])
  return {
    customer_id: uuid(payload.customer_id, 'customer_id'),
    points: money(payload.points, 'points', { allowZero: false, maxScale: 0, maxIntegerDigits: 12 }),
    reference: string(payload.reference, 'reference', { min: 1, max: 200, trim: true }),
    sale_id: optionalUuid(payload.sale_id, 'sale_id')
  }
}

function validateLoyaltyPointsAdjust(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['customer_id', 'points', 'reason', 'approval_id'])
  return {
    customer_id: uuid(payload.customer_id, 'customer_id'),
    points: money(payload.points, 'points', { allowZero: false, maxScale: 0, maxIntegerDigits: 12 }),
    reason: longText(payload.reason, 'reason', 500),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateTipAllocate(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['sale_id', 'staff_id', 'amount', 'points'])
  return {
    sale_id: uuid(payload.sale_id, 'sale_id'),
    staff_id: uuid(payload.staff_id, 'staff_id'),
    amount: money(payload.amount, 'amount', { allowZero: false, maxScale: 2 }),
    points: optionalMoney(payload.points, 'points', { allowZero: false, maxScale: 4 })
  }
}

function validateTipPayout(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['staff_id', 'shift_id', 'amount', 'reason', 'approval_id'])
  return {
    staff_id: uuid(payload.staff_id, 'staff_id'),
    shift_id: uuid(payload.shift_id, 'shift_id'),
    amount: money(payload.amount, 'amount', { allowZero: false, maxScale: 2 }),
    reason: longText(payload.reason, 'reason', 500),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateTipPayoutReverse(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['payout_id', 'reason', 'recovery_shift_id', 'approval_id'])
  return {
    payout_id: uuid(payload.payout_id, 'payout_id'),
    reason: longText(payload.reason, 'reason', 500),
    recovery_shift_id: optionalUuid(payload.recovery_shift_id, 'recovery_shift_id'),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateSupportReportCreate(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['category', 'severity', 'subject', 'message', 'diagnostics', 'metadata'])
  return {
    category: string(payload.category, 'category', { min: 1, max: 64, trim: true }),
    severity: enumeration(payload.severity ?? 'normal', 'severity', ['low', 'normal', 'high', 'critical']),
    subject: string(payload.subject, 'subject', { min: 1, max: 200, trim: true }),
    message: string(payload.message, 'message', { min: 1, max: 4000, trim: true }),
    diagnostics: objectValue(payload.diagnostics, 'diagnostics'),
    metadata: objectValue(payload.metadata, 'metadata')
  }
}

const EXPORT_SIGNING_KEYS = ['signature', 'signing_key', 'private_key', 'signature_key_id']

function validateExportBundleCreate(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['limit', ...EXPORT_SIGNING_KEYS])
  if (EXPORT_SIGNING_KEYS.some((key) => key in payload)) {
    throw new BarLocalError(
      BAR_LOCAL_ERROR_CODES.EXPORT_DISABLED,
      'Local export signing is not available in this release. The bundle is recorded unsigned and cloud transport is disabled.'
    )
  }
  return { limit: optionalInteger(payload.limit, 'limit', { min: 1, max: 1000 }) ?? 200 }
}

function validateApInvoiceUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'invoice_id', 'supplier_id', 'invoice_number', 'invoice_date', 'due_date',
    'purchase_order_id', 'lines', 'subtotal', 'tax_total', 'total',
    'payable_account_code', 'tax_account_code', 'expected_version'
  ])
  const lines = array(payload.lines, 'lines', { min: 1, max: 500 }).map((line, index) => {
    const path = `lines[${index}]`
    const row = object(line, path)
    keys(row, path, ['description', 'expense_account_code', 'quantity', 'unit_price', 'tax_rate'])
    const taxRate = optionalMoney(row.tax_rate, `${path}.tax_rate`, { allowZero: true, maxScale: 4 }) ?? '0.00'
    if (Number.parseFloat(taxRate) > 1) fail(`${path}.tax_rate`, 'must be between 0 and 1')
    return {
      description: string(row.description, `${path}.description`, { min: 1, max: 240, trim: true }),
      expense_account_code: string(row.expense_account_code, `${path}.expense_account_code`, { min: 1, max: 40, trim: true }),
      quantity: quantity(row.quantity, `${path}.quantity`),
      unit_price: money(row.unit_price, `${path}.unit_price`, { allowZero: true, maxScale: 2 }),
      tax_rate: taxRate
    }
  })
  return {
    invoice_id: optionalUuid(payload.invoice_id, 'invoice_id'),
    supplier_id: uuid(payload.supplier_id, 'supplier_id'),
    invoice_number: string(payload.invoice_number, 'invoice_number', { min: 1, max: 80, trim: true }),
    invoice_date: dateString(payload.invoice_date, 'invoice_date'),
    due_date: optionalDate(payload.due_date, 'due_date'),
    purchase_order_id: optionalUuid(payload.purchase_order_id, 'purchase_order_id'),
    lines,
    subtotal: money(payload.subtotal, 'subtotal', { allowZero: true, maxScale: 2 }),
    tax_total: money(payload.tax_total, 'tax_total', { allowZero: true, maxScale: 2 }),
    total: money(payload.total, 'total', { allowZero: true, maxScale: 2 }),
    payable_account_code: string(payload.payable_account_code, 'payable_account_code', { min: 1, max: 40, trim: true }),
    tax_account_code: optionalString(payload.tax_account_code, 'tax_account_code', { max: 40, trim: true }),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateApInvoiceApprove(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['invoice_id', 'approval_id'])
  return {
    invoice_id: uuid(payload.invoice_id, 'invoice_id'),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateApPaymentPost(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'invoice_id', 'amount', 'payment_date', 'payment_account_code',
    'method', 'reference', 'approval_id'
  ])
  return {
    invoice_id: uuid(payload.invoice_id, 'invoice_id'),
    amount: money(payload.amount, 'amount', { allowZero: false, maxScale: 2 }),
    payment_date: dateString(payload.payment_date, 'payment_date'),
    payment_account_code: string(payload.payment_account_code, 'payment_account_code', { min: 1, max: 40, trim: true }),
    method: optionalString(payload.method, 'method', { max: 40, trim: true }),
    reference: optionalString(payload.reference, 'reference', { max: 120, trim: true }),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateApPaymentReverse(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['payment_id', 'reversal_date', 'reason', 'approval_id'])
  return {
    payment_id: uuid(payload.payment_id, 'payment_id'),
    reversal_date: optionalDate(payload.reversal_date, 'reversal_date'),
    reason: optionalString(payload.reason, 'reason', { max: 500, trim: true }),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateBankAccountUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'bank_account_id', 'name', 'institution', 'account_number',
    'account_code', 'active', 'expected_version'
  ])
  return {
    bank_account_id: optionalUuid(payload.bank_account_id, 'bank_account_id'),
    name: string(payload.name, 'name', { min: 1, max: 120, trim: true }),
    institution: optionalString(payload.institution, 'institution', { max: 120, trim: true }),
    account_number: optionalString(payload.account_number, 'account_number', { max: 80, trim: true }),
    account_code: string(payload.account_code, 'account_code', { min: 1, max: 40, trim: true }),
    active: optionalBoolean(payload.active, 'active'),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateBankStatementImport(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['bank_account_id', 'lines'])
  const lines = array(payload.lines, 'lines', { min: 1, max: 1000 }).map((line, index) => {
    const path = `lines[${index}]`
    const row = object(line, path)
    keys(row, path, ['external_ref', 'statement_date', 'amount', 'description'])
    return {
      external_ref: string(row.external_ref, `${path}.external_ref`, { min: 1, max: 120, trim: true }),
      statement_date: dateString(row.statement_date, `${path}.statement_date`),
      amount: money(row.amount, `${path}.amount`, { allowZero: false, maxScale: 2 }),
      description: optionalString(row.description, `${path}.description`, { max: 500, trim: true })
    }
  })
  return {
    bank_account_id: uuid(payload.bank_account_id, 'bank_account_id'),
    lines
  }
}

function validateBankReconcile(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'statement_line_id', 'journal_entry_id', 'ap_payment_id', 'reconciled_on', 'note'
  ])
  const journalEntryId = optionalUuid(payload.journal_entry_id, 'journal_entry_id')
  const apPaymentId = optionalUuid(payload.ap_payment_id, 'ap_payment_id')
  if ((journalEntryId === null) === (apPaymentId === null)) {
    fail('journal_entry_id', 'exactly one of journal_entry_id or ap_payment_id is required')
  }
  return {
    statement_line_id: uuid(payload.statement_line_id, 'statement_line_id'),
    journal_entry_id: journalEntryId,
    ap_payment_id: apPaymentId,
    reconciled_on: optionalDate(payload.reconciled_on, 'reconciled_on'),
    note: optionalString(payload.note, 'note', { max: 500, trim: true })
  }
}

function validateTaxCodeUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['code', 'name', 'rate', 'active', 'expected_version'])
  const rate = money(payload.rate, 'rate', { allowZero: true, maxScale: 4, maxIntegerDigits: 1 })
  if (Number.parseFloat(rate) > 1) fail('rate', 'must be between 0 and 1')
  return {
    code: string(payload.code, 'code', { min: 1, max: 32, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/, trim: true }),
    name: string(payload.name, 'name', { min: 1, max: 160, trim: true }),
    rate,
    active: optionalBoolean(payload.active, 'active'),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validateTaxReturnPrepare(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['period'])
  return { period: monthString(payload.period, 'period') }
}

function validatePayrollRunCreate(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'period_start', 'period_end', 'pay_date', 'expense_account_code',
    'payable_account_code', 'deductions_account_code', 'lines'
  ])
  const lines = array(payload.lines ?? [], 'lines', { max: 2000 }).map((line, index) => {
    const path = `lines[${index}]`
    const row = object(line, path)
    keys(row, path, ['employee_ref', 'gross', 'deductions'])
    return {
      employee_ref: string(row.employee_ref, `${path}.employee_ref`, { min: 1, max: 64, trim: true }),
      gross: money(row.gross, `${path}.gross`, { allowZero: true, maxScale: 2 }),
      deductions: optionalMoney(row.deductions, `${path}.deductions`, { allowZero: true, maxScale: 2 }) ?? '0.00'
    }
  })
  return {
    period_start: dateString(payload.period_start, 'period_start'),
    period_end: dateString(payload.period_end, 'period_end'),
    pay_date: dateString(payload.pay_date, 'pay_date'),
    expense_account_code: string(payload.expense_account_code, 'expense_account_code', { min: 1, max: 40, trim: true }),
    payable_account_code: string(payload.payable_account_code, 'payable_account_code', { min: 1, max: 40, trim: true }),
    deductions_account_code: optionalString(payload.deductions_account_code, 'deductions_account_code', { max: 40, trim: true }),
    lines
  }
}

function validatePayrollRunPrepare(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['payroll_run_id', 'expected_version'])
  return {
    payroll_run_id: uuid(payload.payroll_run_id, 'payroll_run_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 })
  }
}

function validatePayrollRunFinalise(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', ['payroll_run_id', 'expected_version', 'approval_id'])
  return {
    payroll_run_id: uuid(payload.payroll_run_id, 'payroll_run_id'),
    expected_version: integer(payload.expected_version, 'expected_version', { min: 1 }),
    approval_id: optionalUuid(payload.approval_id, 'approval_id')
  }
}

function validateBudgetUpsert(payload: Payload) {
  object(payload, 'payload')
  keys(payload, 'payload', [
    'budget_id', 'name', 'period_start', 'period_end', 'active', 'expected_version', 'lines'
  ])
  const lines = array(payload.lines, 'lines', { min: 1, max: 500 }).map((line, index) => {
    const path = `lines[${index}]`
    const row = object(line, path)
    keys(row, path, ['account_code', 'amount', 'description'])
    return {
      account_code: string(row.account_code, `${path}.account_code`, { min: 1, max: 40, trim: true }),
      amount: money(row.amount, `${path}.amount`, { allowZero: true, maxScale: 2 }),
      description: optionalString(row.description, `${path}.description`, { max: 240, trim: true })
    }
  })
  return {
    budget_id: optionalUuid(payload.budget_id, 'budget_id'),
    name: string(payload.name, 'name', { min: 1, max: 120, trim: true }),
    period_start: dateString(payload.period_start, 'period_start'),
    period_end: dateString(payload.period_end, 'period_end'),
    active: optionalBoolean(payload.active, 'active'),
    expected_version: optionalInteger(payload.expected_version, 'expected_version', { min: 1 }),
    lines
  }
}

function validateQueryFilters(payload: Payload, allowed: readonly string[]): Payload {
  const filters = object(payload, 'filters')
  keys(filters, 'filters', allowed)
  return filters
}

function validateExportBundleGet(payload: Payload): Payload {
  const filters = object(payload, 'filters')
  keys(filters, 'filters', ['batch_id'])
  return { batch_id: uuid(filters.batch_id, 'batch_id') }
}

const commandDefinitions = {
  'sale.commit': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: CAPABILITIES.POS_DISCOUNT, validate: validateSaleCommit, description: 'Atomically price, stock-deplete, tender, receipt and audit a counter sale or tab settlement, with a discount approval when policy requires it.' },
  'sale.return': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: CAPABILITIES.POS_VOID, validate: validateSaleReturn, description: 'Atomically reverse sale lines and linked stock/tender/credit effects.' },
  'sale.void': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: CAPABILITIES.POS_VOID, validate: validateSaleVoid, description: 'Cancel remaining original sale items and unallocated tip with exact original-linked compensation.' },
  'sale.correct_after_close': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: CAPABILITIES.POS_VOID, validate: validateSaleCorrectAfterClose, description: 'Post a manager-approved current-date compensating return for a closed-day sale without rewriting the closed receipt.' },
  'tab.open': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: null, validate: validateTabOpen, description: 'Open an owned tab.' },
  'tab.add': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: null, validate: validateTabAdd, description: 'Add priced lines to an open tab and hold stock.' },
  'tab.settle': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: CAPABILITIES.POS_DISCOUNT, validate: validateTabSettle, description: 'Settle an open tab atomically into a sale, with a discount approval when policy requires it.' },
  'tab.transfer': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: CAPABILITIES.POS_MANAGE, validate: validateTabTransfer, description: 'Transfer tab ownership with an exact approval.' },
  'tab.split': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: CAPABILITIES.POS_MANAGE, validate: validateTabSplit, description: 'Move selected open tab lines into a new tab with an exact approval.' },
  'tab.merge': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: CAPABILITIES.POS_MANAGE, validate: validateTabMerge, description: 'Move all open lines from one tab into another with an exact approval.' },
  'shift.open': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: null, validate: validateShiftOpen, description: 'Open a staff trading shift and drawer.' },
  'shift.close': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: null, validate: validateShiftClose, description: 'Close a shift after checking open tabs and cash evidence.' },
  'drawer.movement': { version: 1, capability: CAPABILITIES.POS_CASHUP, approval: CAPABILITIES.POS_CASHUP, validate: validateDrawerMovement, description: 'Record a drawer movement; paired handovers require outgoing-operator approval and receiving-operator confirmation.' },
  'cashup.submit': { version: 1, capability: CAPABILITIES.POS_CASHUP, approval: null, validate: validateCashupSubmit, description: 'Submit counted cash/card evidence for manager review.' },
  'cashup.review': { version: 1, capability: CAPABILITIES.POS_CASHUP, approval: CAPABILITIES.POS_CASHUP, validate: validateCashupReview, description: 'Approve or reject a submitted cash-up with a distinct reviewer.' },
  'cashup.reopen': { version: 1, capability: CAPABILITIES.POS_CASHUP, approval: CAPABILITIES.POS_CASHUP, validate: validateCashupReopen, description: 'Reopen a reviewed cash-up as a new submission revision with an exact approval.' },
  'stock.receive': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: null, validate: validateStockReceive, description: 'Receive stock into the outlet movement ledger.' },
  'stock.adjust': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: CAPABILITIES.INVENTORY_APPROVE, validate: validateStockAdjust, description: 'Apply a negative stock adjustment with approval.' },
  'stock.stocktake': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: null, validate: validateStockStocktake, description: 'Reconcile a locked counted quantity against the movement ledger.' },
  'stock.waste': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: CAPABILITIES.INVENTORY_APPROVE, validate: validateStockWaste, description: 'Record stock waste with approval.' },
  'stock.lot.waste': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: CAPABILITIES.INVENTORY_APPROVE, validate: validateStockLotWaste, description: 'Record manager-approved waste from one selected stock lot.' },
  'stock.lot.release': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: CAPABILITIES.INVENTORY_APPROVE, validate: validateStockLotRelease, description: 'Release a quarantined return lot after an approved physical inspection.' },
  'stock.transfer': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: null, validate: validateStockTransfer, description: 'Transfer stock between outlets on the same local authority.' },
  'supplier.upsert': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: null, validate: validateSupplierUpsert, description: 'Create or update a locally owned supplier with optimistic versioning.' },
  'purchase_order.create': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: CAPABILITIES.INVENTORY_APPROVE, validate: validatePurchaseOrderCreate, description: 'Create a priced purchase order with manager approval.' },
  'purchase_order.cancel': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: CAPABILITIES.INVENTORY_APPROVE, validate: validatePurchaseOrderCancel, description: 'Cancel an unreceived purchase order with manager approval.' },
  'purchase_order.receive': { version: 1, capability: CAPABILITIES.INVENTORY_MANAGE, approval: null, validate: validatePurchaseOrderReceive, description: 'Receive purchase-order quantities into stock with lot and cost evidence.' },
  'customer.create': { version: 1, capability: CAPABILITIES.CUSTOMERS_MANAGE, approval: null, validate: validateCustomerCreate, description: 'Create a locally owned customer account.' },
  'customer.credit.payment': { version: 1, capability: CAPABILITIES.CUSTOMERS_MANAGE, approval: null, validate: validateCreditPayment, description: 'Record a customer credit payment against the local credit ledger.' },
  'voucher.issue': { version: 1, capability: CAPABILITIES.VOUCHERS_MANAGE, approval: CAPABILITIES.VOUCHERS_MANAGE, validate: validateVoucherIssue, description: 'Issue a locally owned voucher liability.' },
  'catalogue.upsert': { version: 1, capability: CAPABILITIES.MENU_MANAGE, approval: null, validate: validateCatalogueUpsert, description: 'Create or version-update a catalogue product with stale-write protection.' },
  'catalogue.availability.set': { version: 1, capability: CAPABILITIES.MENU_MANAGE, approval: null, validate: validateCatalogueAvailability, description: 'Mark a catalogue product available or sold out in the current outlet.' },
  'expense.create': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateExpenseCreate, description: 'Record an outlet expense and post its balanced journal entry.' },
  'expense.void': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: CAPABILITIES.ACCOUNTING_APPROVE, validate: validateExpenseVoid, description: 'Reverse a posted expense with an approved compensating journal entry.' },
  'accounting.account.upsert': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateAccountingAccountUpsert, description: 'Create or update a chart account while preserving posted-usage type integrity.' },
  'control.checklist.start': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: null, validate: validateChecklistStart, description: 'Start an outlet checklist from a server-seeded control template.' },
  'control.checklist.item.set': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: null, validate: validateChecklistItemSet, description: 'Complete or reopen a checklist item with optimistic versioning.' },
  'control.incident.log': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: null, validate: validateIncidentLog, description: 'Log an operational incident with severity and immediate action.' },
  'control.incident.resolve': { version: 1, capability: CAPABILITIES.POS_MANAGE, approval: null, validate: validateIncidentResolve, description: 'Resolve an operational incident with versioned resolution evidence.' },
  'workforce.shift.schedule': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, approval: null, validate: validateWorkforceShiftSchedule, description: 'Create or version-edit an outlet roster shift for active staff.' },
  'workforce.shift.cancel': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, approval: null, validate: validateWorkforceShiftCancel, description: 'Cancel a scheduled roster shift with versioned audit evidence.' },
  'workforce.clock.in': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, approval: null, validate: validateWorkforceClockIn, description: 'Record one open attendance period for an active staff member.' },
  'workforce.clock.out': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, approval: null, validate: validateWorkforceClockOut, description: 'Close an open attendance period with audit evidence.' },
  'staff.create': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, approval: null, validate: validateStaffCreate, description: 'Create a local staff identity with a service-hashed PIN.' },
  'staff.status': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, approval: CAPABILITIES.STAFF_MANAGE, validate: validateStaffStatus, description: 'Suspend or reactivate a staff identity and revoke sessions.' },
  'settings.update': { version: 1, capability: CAPABILITIES.SETTINGS_MANAGE, approval: null, validate: validateSettingsUpdate, description: 'Update an allowlisted versioned local setting.' },
  'accounting.journal.post': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateJournalPost, description: 'Post an immutable balanced local journal with source provenance.' },
  'accounting.period.close': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: CAPABILITIES.ACCOUNTING_APPROVE, validate: validatePeriodClose, description: 'Close an accounting period with maker-checker approval.' },
  'catalogue.modifier_group.upsert': { version: 1, capability: CAPABILITIES.MENU_MANAGE, approval: null, validate: validateModifierGroupUpsert, description: 'Create or version a modifier group with selection limits.' },
  'catalogue.modifier_option.upsert': { version: 1, capability: CAPABILITIES.MENU_MANAGE, approval: null, validate: validateModifierOptionUpsert, description: 'Create or version an option within a modifier group.' },
  'catalogue.product_modifier.set': { version: 1, capability: CAPABILITIES.MENU_MANAGE, approval: null, validate: validateProductModifierSet, description: 'Replace the ordered modifier groups linked to a product.' },
  'catalogue.recipe.set': { version: 1, capability: CAPABILITIES.MENU_MANAGE, approval: null, validate: validateRecipeSet, description: 'Replace a product recipe and its ingredient cost lines.' },
  'promotion.upsert': { version: 1, capability: CAPABILITIES.MENU_MANAGE, approval: null, validate: validatePromotionUpsert, description: 'Create or version a local code promotion.' },
  'loyalty.program.upsert': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateLoyaltyProgramUpsert, description: 'Create or version an outlet loyalty programme.' },
  'loyalty.account.enrol': { version: 1, capability: CAPABILITIES.CUSTOMERS_MANAGE, approval: null, validate: validateLoyaltyAccountEnrol, description: 'Enrol an active customer in the local loyalty programme.' },
  'loyalty.points.earn': { version: 1, capability: CAPABILITIES.CUSTOMERS_MANAGE, approval: null, validate: validateLoyaltyPointsEarn, description: 'Earn loyalty points for a completed sale exactly once.' },
  'loyalty.points.redeem': { version: 1, capability: CAPABILITIES.CUSTOMERS_MANAGE, approval: null, validate: validateLoyaltyPointsRedeem, description: 'Redeem whole loyalty points against a customer balance.' },
  'loyalty.points.adjust': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: CAPABILITIES.ACCOUNTING_APPROVE, validate: validateLoyaltyPointsAdjust, description: 'Adjust loyalty points with a reason and manager approval.' },
  'workforce.tip.allocate': { version: 1, capability: CAPABILITIES.POS_CASHUP, approval: null, validate: validateTipAllocate, description: 'Allocate sale tip amounts to an active staff member.' },
  'workforce.tip.payout': { version: 1, capability: CAPABILITIES.POS_CASHUP, approval: CAPABILITIES.POS_CASHUP, validate: validateTipPayout, description: 'Pay out a staff tip balance from an open shift with approval.' },
  'workforce.tip.payout.reverse': { version: 1, capability: CAPABILITIES.POS_CASHUP, approval: CAPABILITIES.POS_CASHUP, validate: validateTipPayoutReverse, description: 'Reverse a paid tip payout with approval and cash evidence.' },
  'support.report.create': { version: 1, capability: CAPABILITIES.SETTINGS_MANAGE, approval: null, validate: validateSupportReportCreate, description: 'Record a redacted local support report.' },
  'export.bundle.create': { version: 1, capability: CAPABILITIES.EXPORT_MANAGE, approval: null, validate: validateExportBundleCreate, description: 'Record an unsigned local outbox export bundle checkpoint.' },
  'accounting.ap.invoice.upsert': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateApInvoiceUpsert, description: 'Create or version a draft supplier invoice with exact line totals.' },
  'accounting.ap.invoice.approve': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: CAPABILITIES.ACCOUNTING_APPROVE, validate: validateApInvoiceApprove, description: 'Approve a draft supplier invoice into a balanced payable journal.' },
  'accounting.ap.payment.post': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: CAPABILITIES.ACCOUNTING_APPROVE, validate: validateApPaymentPost, description: 'Post an approved supplier payment with balanced journal evidence.' },
  'accounting.ap.payment.reverse': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: CAPABILITIES.ACCOUNTING_APPROVE, validate: validateApPaymentReverse, description: 'Reverse a posted supplier payment with approval.' },
  'accounting.bank_account.upsert': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateBankAccountUpsert, description: 'Create or version a bank account linked to an asset ledger.' },
  'accounting.bank_statement.import': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateBankStatementImport, description: 'Import idempotent bank statement lines for an active account.' },
  'accounting.bank.reconcile': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateBankReconcile, description: 'Reconcile one statement line to exactly one journal or payable payment.' },
  'accounting.tax_code.upsert': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateTaxCodeUpsert, description: 'Create or version a local tax code.' },
  'accounting.tax_return.prepare': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateTaxReturnPrepare, description: 'Prepare a hashed local tax return draft for a month.' },
  'accounting.payroll_run.create': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validatePayrollRunCreate, description: 'Create a draft payroll run with opaque employee references.' },
  'accounting.payroll_run.prepare': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validatePayrollRunPrepare, description: 'Snapshot and prepare a non-empty draft payroll run.' },
  'accounting.payroll_run.finalise': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: CAPABILITIES.ACCOUNTING_APPROVE, validate: validatePayrollRunFinalise, description: 'Finalise a prepared payroll run into balanced journals with approval.' },
  'accounting.budget.upsert': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, approval: null, validate: validateBudgetUpsert, description: 'Create or version an outlet budget with non-negative account lines.' }
} satisfies Readonly<Record<string, CommandDefinition>>

export const COMMANDS = Object.freeze(commandDefinitions)

export type CommandName = keyof typeof COMMANDS
export type CommandPayload<C extends CommandName> = ReturnType<(typeof COMMANDS)[C]['validate']>

const queryDefinitions = {
  'drawer.open_shifts': { version: 1, capability: CAPABILITIES.POS_CASHUP, validate: (payload) => validateQueryFilters(payload,['outlet_id','limit','cursor']) },
  'workforce.tip_payouts': { version: 1, capability: CAPABILITIES.POS_CASHUP, validate: (payload) => validateQueryFilters(payload,['outlet_id','limit','cursor']) },
  'accounting.records': { version: 1, capability: CAPABILITIES.ACCOUNTING_READ, validate: (payload: Payload) => {
    const filters=object(payload,'filters')
    keys(filters,'filters',['kind','outlet_id','limit','cursor','record_id'])
    return {...filters,kind:enumeration(filters.kind,'kind',['ap_invoices','ap_payments','bank_accounts','bank_statement_lines','bank_reconciliations','tax_codes','tax_return_periods','payroll_runs','budgets','journal_entries','suppliers']),record_id:optionalUuid(filters.record_id,'record_id')}
  } },
  'bootstrap': { version: 1, capability: CAPABILITIES.POS_VIEW, validate: (payload) => validateQueryFilters(payload, []) },
  'menu.list': { version: 1, capability: CAPABILITIES.POS_VIEW, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'include_inactive', 'limit', 'cursor']) },
  'menu.availability': { version: 1, capability: CAPABILITIES.POS_VIEW, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'include_inactive', 'available_only', 'limit', 'cursor']) },
  'menu.promotions': { version: 1, capability: CAPABILITIES.POS_VIEW, validate: (payload) => validateQueryFilters(payload, []) },
  'menu.modifiers': { version: 1, capability: CAPABILITIES.MENU_MANAGE, validate: (payload) => validateQueryFilters(payload, []) },
  'expenses.list': { version: 1, capability: CAPABILITIES.ACCOUNTING_READ, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'status', 'category', 'limit', 'cursor']) },
  'expense.get': { version: 1, capability: CAPABILITIES.ACCOUNTING_READ, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'expense_id']) },
  'accounting.accounts.list': { version: 1, capability: CAPABILITIES.ACCOUNTING_READ, validate: (payload) => validateQueryFilters(payload, ['type', 'include_inactive', 'search', 'limit', 'cursor']) },
  'tabs.list': { version: 1, capability: CAPABILITIES.POS_VIEW, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'status', 'limit', 'cursor']) },
  'tab.get': { version: 1, capability: CAPABILITIES.POS_VIEW, validate: (payload) => validateQueryFilters(payload, ['tab_id']) },
  'sales.list': { version: 1, capability: CAPABILITIES.POS_REPORTS, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'limit', 'cursor']) },
  'reports.sales_summary': { version: 1, capability: CAPABILITIES.POS_REPORTS, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'shift_id']) },
  'reports.post_close_corrections': { version: 1, capability: CAPABILITIES.POS_REPORTS, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'original_sale_id', 'limit', 'cursor']) },
  'reports.stock': { version: 1, capability: CAPABILITIES.POS_REPORTS, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'threshold']) },
  'reports.cashup': { version: 1, capability: CAPABILITIES.POS_CASHUP, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'shift_id']) },
  'control.templates.list': { version: 1, capability: CAPABILITIES.POS_MANAGE, validate: (payload) => validateQueryFilters(payload, []) },
  'control.checklists.list': { version: 1, capability: CAPABILITIES.POS_MANAGE, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'status', 'template_key', 'limit', 'cursor']) },
  'control.checklist.get': { version: 1, capability: CAPABILITIES.POS_MANAGE, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'checklist_id']) },
  'control.incidents.list': { version: 1, capability: CAPABILITIES.POS_MANAGE, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'status', 'severity', 'limit', 'cursor']) },
  'workforce.roster': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'staff_id', 'status', 'limit', 'cursor']) },
  'workforce.attendance.list': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'from', 'to', 'staff_id', 'status', 'limit', 'cursor']) },
  'workforce.attendance.current': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'staff_id']) },
  'sale.get': { version: 1, capability: CAPABILITIES.POS_VIEW, validate: (payload) => validateQueryFilters(payload, ['sale_id', 'receipt_number']) },
  'shift.current': { version: 1, capability: CAPABILITIES.POS_VIEW, validate: (payload) => validateQueryFilters(payload, ['outlet_id']) },
  'cashup.summary': { version: 1, capability: CAPABILITIES.POS_CASHUP, validate: (payload) => validateQueryFilters(payload, ['shift_id', 'outlet_id']) },
  'stock.list': { version: 1, capability: CAPABILITIES.INVENTORY_VIEW, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'low_only', 'limit', 'cursor']) },
  'stock.lot_expiry': { version: 1, capability: CAPABILITIES.INVENTORY_VIEW, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'limit', 'cursor']) },
  'stock.lot_balances': { version: 1, capability: CAPABILITIES.INVENTORY_VIEW, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'limit', 'cursor']) },
  'suppliers.list': { version: 1, capability: CAPABILITIES.INVENTORY_VIEW, validate: (payload) => validateQueryFilters(payload, ['search', 'include_inactive', 'limit', 'cursor']) },
  'purchase_orders.list': { version: 1, capability: CAPABILITIES.INVENTORY_VIEW, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'supplier_id', 'status', 'from', 'to', 'limit', 'cursor']) },
  'purchase_order.get': { version: 1, capability: CAPABILITIES.INVENTORY_VIEW, validate: (payload) => validateQueryFilters(payload, ['purchase_order_id']) },
  'customers.list': { version: 1, capability: CAPABILITIES.CUSTOMERS_MANAGE, validate: (payload) => validateQueryFilters(payload, ['search', 'limit', 'cursor']) },
  'vouchers.list': { version: 1, capability: CAPABILITIES.VOUCHERS_MANAGE, validate: (payload) => validateQueryFilters(payload, ['status', 'limit', 'cursor']) },
  'staff.list': { version: 1, capability: CAPABILITIES.STAFF_MANAGE, validate: (payload) => validateQueryFilters(payload, ['include_suspended']) },
  'audit.search': { version: 1, capability: CAPABILITIES.SETTINGS_MANAGE, validate: (payload) => validateQueryFilters(payload, ['from', 'to', 'action', 'operation_id', 'search', 'actor_staff_id', 'limit', 'cursor']) },
  'outbox.status': { version: 1, capability: CAPABILITIES.EXPORT_MANAGE, validate: (payload) => validateQueryFilters(payload, []) },
  'outbox.bundle.get': { version: 1, capability: CAPABILITIES.EXPORT_MANAGE, validate: validateExportBundleGet },
  'loyalty.programs.list': { version: 1, capability: CAPABILITIES.ACCOUNTING_MANAGE, validate: (payload) => validateQueryFilters(payload, []) },
  'loyalty.account.get': { version: 1, capability: CAPABILITIES.CUSTOMERS_MANAGE, validate: (payload) => { const filters = validateQueryFilters(payload, ['customer_id']); return { customer_id: uuid(filters.customer_id, 'customer_id') } } },
  'accounting.trial_balance': { version: 1, capability: CAPABILITIES.ACCOUNTING_READ, validate: (payload) => validateQueryFilters(payload, ['from', 'to']) },
  'support.reports.list': { version: 1, capability: CAPABILITIES.SETTINGS_MANAGE, validate: (payload) => validateQueryFilters(payload, ['outlet_id', 'limit', 'cursor']) }
} satisfies Readonly<Record<string, QueryDefinition>>

export const QUERIES = Object.freeze(queryDefinitions)

export type QueryName = keyof typeof QUERIES
export type QueryFilters<Q extends QueryName> = ReturnType<(typeof QUERIES)[Q]['validate']>

export function getCommand(name: string, version = 1): CommandDefinition {
  const command = COMMANDS[name as CommandName] as CommandDefinition | undefined
  if (!command) throw new BarLocalError(BAR_LOCAL_ERROR_CODES.COMMAND_NOT_REGISTERED, `Command ${name} is not registered for local Bar authority.`)
  if (version !== command.version) throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `Command ${name} version ${version} is not supported.`)
  return command
}

export function getQuery(name: string, version = 1): QueryDefinition {
  const query = QUERIES[name as QueryName] as QueryDefinition | undefined
  if (!query) throw new BarLocalError(BAR_LOCAL_ERROR_CODES.QUERY_NOT_REGISTERED, `Query ${name} is not registered for local Bar authority.`)
  if (version !== query.version) throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `Query ${name} version ${version} is not supported.`)
  return query
}

const QUERY_ENVELOPE_KEYS = [
  'contract_version', 'authority_id', 'authority_epoch', 'query', 'query_version', 'filters'
]

export function validateQueryEnvelope(envelope: Payload) {
  object(envelope, 'query_envelope')
  keys(envelope, 'query_envelope', QUERY_ENVELOPE_KEYS)
  if (envelope.contract_version !== CONTRACT_VERSION) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `contract_version must be ${CONTRACT_VERSION}`)
  }
  const queryName = string(envelope.query, 'query', { min: 1, max: 80 })
  const queryVersion = envelope.query_version === undefined
    ? 1
    : integer(envelope.query_version, 'query_version', { min: 1 })
  const query = getQuery(queryName, queryVersion)
  const filters = query.validate(object(envelope.filters ?? {}, 'filters'))
  return {
    contract_version: CONTRACT_VERSION,
    authority_id: uuid(envelope.authority_id, 'authority_id'),
    authority_epoch: integer(envelope.authority_epoch, 'authority_epoch', { min: 1 }),
    query: queryName,
    query_version: query.version,
    filters: filters ?? {}
  }
}

const ENVELOPE_KEYS = [
  'contract_version', 'authority_id', 'authority_epoch', 'business_id', 'outlet_id',
  'device_id', 'operation_id', 'command', 'payload_version', 'payload',
  'expected_versions', 'dependencies', 'client_occurred_at'
]

export function validateEnvelope(envelope: Payload) {
  object(envelope, 'envelope')
  keys(envelope, 'envelope', ENVELOPE_KEYS)
  if (envelope.contract_version !== CONTRACT_VERSION) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `contract_version must be ${CONTRACT_VERSION}`)
  }
  const commandName = string(envelope.command, 'command', { min: 1, max: 80 })
  const payloadVersion = envelope.payload_version === undefined
    ? PAYLOAD_VERSION
    : integer(envelope.payload_version, 'payload_version', { min: 1 })
  const command = getCommand(commandName, payloadVersion)
  const payloadValue = envelope.payload ?? {}
  const payload = command.validate(object(payloadValue, 'payload'))
  const dependencies = envelope.dependencies === undefined
    ? []
    : array(envelope.dependencies, 'dependencies', { max: 50 }).map((value, index) => uuid(value, `dependencies[${index}]`))
  const clientOccurredAt = optionalString(envelope.client_occurred_at, 'client_occurred_at', { max: 40, trim: true })
  if (clientOccurredAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(clientOccurredAt)) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'client_occurred_at must be an ISO-8601 UTC timestamp')
  }
  return {
    contract_version: CONTRACT_VERSION,
    authority_id: uuid(envelope.authority_id, 'authority_id'),
    authority_epoch: integer(envelope.authority_epoch, 'authority_epoch', { min: 1 }),
    business_id: uuid(envelope.business_id, 'business_id'),
    outlet_id: uuid(envelope.outlet_id, 'outlet_id'),
    device_id: uuid(envelope.device_id, 'device_id'),
    operation_id: uuid(envelope.operation_id, 'operation_id'),
    command: commandName,
    payload_version: command.version,
    payload,
    expected_versions: object(envelope.expected_versions ?? {}, 'expected_versions'),
    dependencies,
    client_occurred_at: clientOccurredAt
  }
}
