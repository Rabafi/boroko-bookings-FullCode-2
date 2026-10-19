import fs from 'fs'
import net from 'net'
import os from 'os'
import { ECOSYSTEM_BRAND } from '../../shared/brandIdentity.js'

const ESC = 0x1b
const GS = 0x1d

const DEFAULT_NETWORK_PORT = 9100
const DEFAULT_TIMEOUT_MS = 8000

/** @typedef {Record<string, unknown>} HardwareRecord */

/** @param {unknown} value @param {boolean} [fallback] @returns {boolean} */
function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return value === true || value === 'true' || value === 1 || value === '1'
}

/** @param {unknown} value @param {number} [fallback] @returns {number} */
function toNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max @returns {number} */
function clampNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, toNumber(value, fallback)))
}

/** @param {unknown} value @returns {number} */
function normalizeMoney(value) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0
}

/** @param {unknown} value @returns {string} */
function stripControl(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

/** @param {unknown} value @returns {string} */
function normalizeScannerPrefixOrSuffix(value) {
  // Scanner framing is deliberately limited to printable ASCII.  Prefixes
  // and suffixes are configuration, not a place to store arbitrary control
  // sequences or secrets.
  return stripControl(value).slice(0, 16)
}

/** @param {unknown} value @returns {string} */
function sanitizeText(value) {
  return String(value || '')
    .replace(/[–—]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?')
}

/** @param {unknown} [value] @returns {Buffer} */
function textBuffer(value = '') {
  return Buffer.from(sanitizeText(value), 'latin1')
}

/** @param {number[]} [values] @returns {Buffer} */
function commandBuffer(values = []) {
  return Buffer.from(values)
}

/** @param {unknown} [codepage] @returns {number} */
function escposCodepageByte(codepage = 'cp437') {
  const normalized = String(codepage || '').toLowerCase()
  if (normalized === 'cp850') return 2
  if (normalized === 'cp858') return 19
  if (normalized === 'cp860') return 3
  if (normalized === 'cp863') return 4
  if (normalized === 'cp865') return 5
  return 0
}

/** @param {unknown} [width] @returns {number} */
function paperColumns(width = '80mm') {
  const normalized = String(width || '').toLowerCase()
  if (normalized.includes('58')) return 32
  if (normalized.includes('a4')) return 48
  return 42
}

/** @param {unknown} value @param {number} width @returns {string[]} */
function wrapText(value, width) {
  const words = sanitizeText(value).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    if (!line) {
      line = word
    } else if (`${line} ${word}`.length <= width) {
      line = `${line} ${word}`
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** @param {unknown} left @param {unknown} right @param {number} width @returns {string[]} */
function twoColumn(left, right, width) {
  const safeRight = sanitizeText(right)
  const rightWidth = Math.min(width, safeRight.length)
  const leftWidth = Math.max(1, width - rightWidth - 1)
  const leftLines = wrapText(left, leftWidth)
  return leftLines.map((line, index) => {
    if (index > 0) return line
    return `${line.padEnd(leftWidth, ' ')} ${safeRight.slice(0, rightWidth).padStart(rightWidth, ' ')}`
  })
}

/** @param {unknown} pathValue @returns {string} */
function normalizeDevicePath(pathValue) {
  const raw = stripControl(pathValue)
  if (/^(com|lpt)\d+:?$/i.test(raw)) {
    return `\\\\.\\${raw.replace(/:$/, '')}`
  }
  return raw
}

/** @param {unknown} pathValue @returns {{ host: string, port: number } | null} */
function parseNetworkPath(pathValue) {
  const raw = stripControl(pathValue)
  if (!raw) return null
  const tcpMatch = raw.match(/^tcp:\/\/([^:/]+)(?::(\d+))?$/i)
  if (tcpMatch) {
    return {
      host: tcpMatch[1],
      port: clampNumber(tcpMatch[2], DEFAULT_NETWORK_PORT, 1, 65535)
    }
  }
  const hostPortMatch = raw.match(/^([a-z0-9.-]+):(\d+)$/i)
  if (hostPortMatch) {
    return {
      host: hostPortMatch[1],
      port: clampNumber(hostPortMatch[2], DEFAULT_NETWORK_PORT, 1, 65535)
    }
  }
  return null
}

/** @param {Record<string, unknown>} settings @returns {{ type: 'network', host: string, port: number } | { type: 'path', path: string } | null} */
function inferRawTarget(settings) {
  const connectionType = String(settings.escpos_connection_type || 'network').toLowerCase()
  const pathTarget = stripControl(settings.escpos_printer_path)
  const parsedPath = parseNetworkPath(pathTarget)

  if (connectionType === 'network' || parsedPath) {
    return {
      type: 'network',
      host: stripControl(settings.escpos_network_host) || parsedPath?.host || pathTarget,
      port: clampNumber(settings.escpos_network_port || parsedPath?.port, DEFAULT_NETWORK_PORT, 1, 65535)
    }
  }

  if (connectionType === 'path' || connectionType === 'share' || connectionType === 'serial') {
    return {
      type: 'path',
      path: normalizeDevicePath(pathTarget)
    }
  }

  if (pathTarget) {
    return {
      type: 'path',
      path: normalizeDevicePath(pathTarget)
    }
  }

  return null
}

/** @param {Record<string, unknown>} [settings] */
export function normalizePosHardwareSettings(settings = {}) {
  const escposEnabled = toBool(settings.escpos_enabled, false)
  const receiptPrintMode = String(settings.receipt_print_mode || (escposEnabled ? 'escpos' : 'windows')).toLowerCase()
  const paymentMode = String(settings.payment_terminal_mode || 'manual').toLowerCase()
  const barcodeMinLength = Math.max(1, Math.min(128, clampNumber(settings.barcode_scanner_min_length, 4, 1, 128)))
  const barcodeMaxLength = Math.max(barcodeMinLength, Math.min(128, clampNumber(settings.barcode_scanner_max_length, 128, 1, 128)))
  return {
    receipt_printer_name: stripControl(settings.receipt_printer_name),
    receipt_paper_width: settings.receipt_paper_width || '80mm',
    receipt_print_mode: receiptPrintMode === 'escpos' ? 'escpos' : 'windows',
    auto_print_receipts: toBool(settings.auto_print_receipts, false),
    receipt_cut_enabled: toBool(settings.receipt_cut_enabled, true),
    cash_drawer_enabled: toBool(settings.cash_drawer_enabled, false),
    cash_drawer_manual: toBool(settings.cash_drawer_manual, false),
    cash_drawer_command: settings.cash_drawer_command || 'ESC/POS kick',
    cash_drawer_open_on_cash: toBool(settings.cash_drawer_open_on_cash, false),
    cash_drawer_open_timing: settings.cash_drawer_open_timing === 'before_receipt' ? 'before_receipt' : 'after_payment',
    cash_drawer_pin: settings.cash_drawer_pin === '1' ? '1' : '0',
    cash_drawer_pulse_on_ms: clampNumber(settings.cash_drawer_pulse_on_ms, 50, 10, 2550),
    cash_drawer_pulse_off_ms: clampNumber(settings.cash_drawer_pulse_off_ms, 250, 10, 2550),
    escpos_enabled: escposEnabled || receiptPrintMode === 'escpos',
    escpos_connection_type: String(settings.escpos_connection_type || 'network').toLowerCase(),
    escpos_network_host: stripControl(settings.escpos_network_host),
    escpos_network_port: clampNumber(settings.escpos_network_port, DEFAULT_NETWORK_PORT, 1, 65535),
    escpos_printer_path: stripControl(settings.escpos_printer_path),
    escpos_codepage: settings.escpos_codepage || 'cp437',
    escpos_timeout_ms: clampNumber(settings.escpos_timeout_ms, DEFAULT_TIMEOUT_MS, 1500, 60000),
    payment_terminal_provider: stripControl(settings.payment_terminal_provider),
    payment_terminal_name: stripControl(settings.payment_terminal_name),
    payment_terminal_mode: ['manual', 'local_bridge', 'provider_api'].includes(paymentMode) ? paymentMode : 'manual',
    payment_terminal_bridge_url: stripControl(settings.payment_terminal_bridge_url),
    payment_terminal_timeout_ms: clampNumber(settings.payment_terminal_timeout_ms, DEFAULT_TIMEOUT_MS, 1500, 60000),
    barcode_scanner_enabled: toBool(settings.barcode_scanner_enabled, true),
    barcode_scanner_min_length: barcodeMinLength,
    barcode_scanner_max_length: barcodeMaxLength,
    barcode_scanner_inter_key_ms: clampNumber(settings.barcode_scanner_inter_key_ms, 120, 10, 1000),
    barcode_scanner_idle_complete_ms: clampNumber(settings.barcode_scanner_idle_complete_ms, 180, 50, 2000),
    barcode_scanner_accept_enter: toBool(settings.barcode_scanner_accept_enter, true),
    barcode_scanner_accept_tab: toBool(settings.barcode_scanner_accept_tab, true),
    barcode_scanner_prefix: normalizeScannerPrefixOrSuffix(settings.barcode_scanner_prefix),
    barcode_scanner_suffix: normalizeScannerPrefixOrSuffix(settings.barcode_scanner_suffix),
    barcode_scanner_sound_enabled: toBool(settings.barcode_scanner_sound_enabled, true),
    scanner_last_verified_at: settings.scanner_last_verified_at || null,
    scanner_last_terminator: stripControl(settings.scanner_last_terminator),
    scanner_last_character_count: Number.isFinite(Number(settings.scanner_last_character_count)) ? Number(settings.scanner_last_character_count) : null,
    scanner_last_average_inter_key_ms: Number.isFinite(Number(settings.scanner_last_average_inter_key_ms)) ? Number(settings.scanner_last_average_inter_key_ms) : null,
    customer_display_enabled: toBool(settings.customer_display_enabled, false),
    display_welcome_message: stripControl(settings.display_welcome_message).slice(0, 140),
    display_customer_display_id: stripControl(settings.display_customer_display_id).slice(0, 64),
    display_bar_display_id: stripControl(settings.display_bar_display_id).slice(0, 64),
    display_kitchen_display_id: stripControl(settings.display_kitchen_display_id).slice(0, 64),
    display_customer_auto_open: toBool(settings.display_customer_auto_open, false),
    updated_at: settings.updated_at || null
  }
}

/** @param {Record<string, unknown>} [settings] */
export function buildCashDrawerPulse(settings = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  const pin = normalized.cash_drawer_pin === '1' ? 1 : 0
  const on = Math.round(normalized.cash_drawer_pulse_on_ms / 2)
  const off = Math.round(normalized.cash_drawer_pulse_off_ms / 2)
  return commandBuffer([ESC, 0x70, pin, Math.max(1, Math.min(255, on)), Math.max(1, Math.min(255, off))])
}

/** @param {HardwareRecord} [order] */
function isCashOrder(order = {}) {
  const payments = Array.isArray(order.payment_breakdown)
    ? order.payment_breakdown
    : typeof order.payment_breakdown === 'string'
      ? (() => { try { return JSON.parse(order.payment_breakdown) } catch { return [] } })()
      : []
  return payments.some((/** @type {HardwareRecord} */ payment) => String(payment.method || '').toLowerCase() === 'cash' && normalizeMoney(payment.amount) > 0)
}

/** @param {Buffer[]} buffers @param {unknown} [value] */
function pushText(buffers, value = '') {
  buffers.push(textBuffer(`${value}\n`))
}

/** @param {Buffer[]} buffers @param {'left' | 'center' | 'right'} [align] */
function pushAlign(buffers, align = 'left') {
  const code = align === 'center' ? 1 : align === 'right' ? 2 : 0
  buffers.push(commandBuffer([ESC, 0x61, code]))
}

/** @param {Buffer[]} buffers @param {boolean} enabled */
function pushBold(buffers, enabled) {
  buffers.push(commandBuffer([ESC, 0x45, enabled ? 1 : 0]))
}

/** @param {Buffer[]} buffers @param {number} width @param {string} [value] */
function pushRule(buffers, width, value = '-') {
  pushText(buffers, value.repeat(width))
}

/** @param {unknown} currency @param {unknown} value @returns {string} */
function formatCurrency(currency, value) {
  return `${currency || 'P'} ${normalizeMoney(value).toFixed(2)}`
}

/** @param {unknown} value @returns {number | null} */
function recordedMoney(value) {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

/** @param {HardwareRecord} [item] */
function recordedItemAmount(item = {}) {
  for (const key of ['net_subtotal', 'subtotal', 'gross_subtotal']) {
    const amount = recordedMoney(item?.[key])
    if (amount !== null) return amount
  }
  return null
}

/** @param {HardwareRecord} order @returns {HardwareRecord[]} */
function receiptItems(order) {
  return Array.isArray(order?.pos_order_items) ? order.pos_order_items : Array.isArray(order?.items) ? order.items : []
}

/** @param {HardwareRecord} order @returns {HardwareRecord[]} */
function receiptPayments(order) {
  if (Array.isArray(order?.payment_breakdown)) return order.payment_breakdown
  if (typeof order?.payment_breakdown === 'string') {
    try {
      const parsed = JSON.parse(order.payment_breakdown)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * The record types describe fields this formatter already reads from POS
 * results. They are expectation types only; no runtime validation is added.
 * @param {HardwareRecord} [order]
 * @param {HardwareRecord} [business]
 * @param {Record<string, unknown>} [settings]
 * @param {{openDrawer?: 'before' | 'after' | null}} [options]
 */
export function buildEscPosReceipt(order = {}, business = {}, settings = {}, options = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  const width = paperColumns(normalized.receipt_paper_width)
  const currency = business.currency || 'P'
  const receiptNo = order.receipt_number
    || (order?._pending_sync === true ? 'PROVISIONAL — PENDING SERVER NUMBER' : 'RECEIPT NUMBER UNAVAILABLE')
  const provisional = order?._pending_sync === true
  const buffers = [
    commandBuffer([ESC, 0x40]),
    commandBuffer([ESC, 0x74, escposCodepageByte(normalized.escpos_codepage)])
  ]

  if (options.openDrawer === 'before') buffers.push(buildCashDrawerPulse(normalized))

  pushAlign(buffers, 'center')
  pushBold(buffers, true)
  pushText(buffers, business.lodge_name || business.company_name || ECOSYSTEM_BRAND.name)
  pushBold(buffers, false)
  for (const line of [business.company_name, business.address, business.city, business.country].filter(Boolean)) {
    for (const wrapped of wrapText(line, width)) pushText(buffers, wrapped)
  }
  if (business.phone || business.email) {
    for (const wrapped of wrapText([business.phone, business.email].filter(Boolean).join(' / '), width)) pushText(buffers, wrapped)
  }
  if (business.vat_number) pushText(buffers, `VAT No: ${business.vat_number}`)

  pushAlign(buffers, 'left')
  pushRule(buffers, width)
  if (provisional) {
    pushText(buffers, 'PROVISIONAL — PENDING SERVER CONFIRMATION')
    pushText(buffers, 'Amounts remain estimates until the server confirms this sale.')
    pushRule(buffers, width)
  }
  pushText(buffers, `Receipt: ${receiptNo}`)
  // POS rows expose created_at as a timestamp string; retain the original
  // Date constructor behavior without adding a runtime parse/validity guard.
  pushText(buffers, `Date: ${new Date(/** @type {string | number} */ (order.created_at) || Date.now()).toLocaleString('en-GB')}`)
  if (order.cashier_name) pushText(buffers, `Cashier: ${order.cashier_name}`)
  if (order.outlet_name) pushText(buffers, `Outlet: ${order.outlet_name}`)
  if (order.table_name) pushText(buffers, `Table: ${order.table_name}`)
  if (order.walk_in_name) pushText(buffers, `Guest: ${order.walk_in_name}`)
  if (order.room_id) pushText(buffers, 'Guest: Room guest')
  pushRule(buffers, width)

  for (const item of receiptItems(order)) {
    const quantity = normalizeMoney(item.quantity || 0)
    const unitPrice = recordedMoney(item.unit_price ?? item.price)
    const total = recordedItemAmount(item)
    for (const line of wrapText(item.item_name || item.name || 'Item', width)) pushText(buffers, line)
    const unitLabel = unitPrice === null ? 'Unit price unavailable' : `${quantity} x ${formatCurrency(currency, unitPrice)}`
    const amountLabel = total === null ? 'Amount unavailable' : formatCurrency(currency, total)
    pushText(buffers, twoColumn(unitLabel, amountLabel, width)[0])
    const modifierText = [
      ...(Array.isArray(item.modifiers) ? item.modifiers.map((/** @type {HardwareRecord} */ mod) => mod.name).filter(Boolean) : []),
      item.item_notes
    ].filter(Boolean).join(', ')
    if (modifierText) {
      for (const line of wrapText(`  ${modifierText}`, width)) pushText(buffers, line)
    }
  }

  pushRule(buffers, width)
  const totals = [
    ['Gross', order.gross_total],
    ['Discount', recordedMoney(order.discount_total) !== null && Number(order.discount_total) > 0 ? -Math.abs(Number(order.discount_total)) : null],
    ['Tax/VAT', order.tax_total],
    ['Tip', order.tip_total]
  ].filter(([, value]) => recordedMoney(value) !== null && Number(value) !== 0)
  for (const [label, value] of totals) {
    for (const line of twoColumn(label, formatCurrency(currency, value), width)) pushText(buffers, line)
  }
  pushBold(buffers, true)
  const totalAmount = recordedMoney(order.total)
  const totalLabel = totalAmount === null ? 'Amount unavailable' : formatCurrency(currency, totalAmount)
  for (const line of twoColumn('TOTAL', totalLabel, width)) pushText(buffers, line)
  pushBold(buffers, false)

  const payments = receiptPayments(order)
  if (payments.length) {
    pushRule(buffers, width)
    pushText(buffers, 'Payments')
    for (const payment of payments) {
      const paymentAmount = recordedMoney(payment.amount)
      for (const line of twoColumn(payment.method || 'Tender unavailable', paymentAmount === null ? 'Amount unavailable' : formatCurrency(currency, paymentAmount), width)) pushText(buffers, line)
      if (payment.reference) pushText(buffers, `Ref: ${payment.reference}`)
    }
  } else {
    pushText(buffers, `Method: ${order.payment_method || 'Tender unavailable'}`)
  }

  pushRule(buffers, width)
  pushAlign(buffers, 'center')
  pushText(buffers, 'Thank you for your business')
  pushText(buffers, `Generated by ${ECOSYSTEM_BRAND.name}`)
  pushAlign(buffers, 'left')
  buffers.push(textBuffer('\n\n\n'))

  if (options.openDrawer === 'after') buffers.push(buildCashDrawerPulse(normalized))
  if (normalized.receipt_cut_enabled) buffers.push(commandBuffer([GS, 0x56, 0x42, 0x00]))
  return Buffer.concat(buffers)
}

/** @param {Record<string, unknown>} [settings] @param {Buffer | Uint8Array | number[] | string} [payload] */
export async function sendRawEscPos(settings = {}, payload) {
  const normalized = normalizePosHardwareSettings(settings)
  if (!normalized.escpos_enabled && normalized.receipt_print_mode !== 'escpos') {
    return { success: false, error: 'ESC/POS direct mode is not enabled.' }
  }
  const target = inferRawTarget(normalized)
  if (!target || (target.type === 'network' && !target.host) || (target.type === 'path' && !target.path)) {
    return { success: false, error: 'Set an ESC/POS network host, device path, or Windows printer share first.' }
  }

  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || [])
  try {
    if (target.type === 'network') {
      await sendTcp(target.host, target.port, bytes, normalized.escpos_timeout_ms || DEFAULT_TIMEOUT_MS)
      return { success: true, verified: true, transport: 'network', target: `${target.host}:${target.port}` }
    }
    await sendPath(target.path, bytes)
    return { success: true, verified: true, transport: 'path', target: target.path }
  } catch (error) {
    // Both sendTcp and fs.WriteStream reject with Node system Errors.
    const sendError = /** @type {Error} */ (error)
    return { success: false, error: sendError?.message || 'Could not send ESC/POS command.' }
  }
}

/** @param {string} host @param {number} port @param {Buffer} payload @param {number} [timeoutMs] @returns {Promise<void>} */
function sendTcp(host, port, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    const socket = net.createConnection({ host, port })
    /** @param {Error | null} [error] */
    const finish = (error) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      socket.write(payload, (/** @type {Error | null | undefined} */ error) => {
        if (error) finish(error)
        else socket.end()
      })
    })
    socket.once('error', finish)
    socket.once('timeout', () => finish(new Error(`Timed out connecting to ${host}:${port}.`)))
    socket.once('close', () => finish())
  })
}

/** @param {string} targetPath @param {Buffer} payload @returns {Promise<void>} */
function sendPath(targetPath, payload) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(targetPath)
    stream.once('error', reject)
    stream.once('finish', resolve)
    stream.end(payload)
  })
}

/** @param {{order?: HardwareRecord, business?: HardwareRecord, settings?: Record<string, unknown>, openDrawer?: boolean}} [input] */
export async function printEscPosReceipt({ order = {}, business = {}, settings = {}, openDrawer = false } = {}) {
  if (!order?.receipt_number && order?._pending_sync !== true) {
    return { success: false, error: 'Printing is blocked until the server-issued receipt number is available.' }
  }
  const normalized = normalizePosHardwareSettings(settings)
  const drawerTiming = openDrawer && normalized.cash_drawer_enabled && !normalized.cash_drawer_manual && isCashOrder(order)
    ? normalized.cash_drawer_open_timing
    : null
  const receipt = buildEscPosReceipt(order, business, normalized, {
    openDrawer: drawerTiming === 'before_receipt' ? 'before' : null
  })
  const payload = drawerTiming === 'after_payment'
    ? Buffer.concat([receipt, buildCashDrawerPulse(normalized)])
    : receipt
  const result = await sendRawEscPos(normalized, payload)
  return result.success
    ? { ...result, message: 'Receipt sent to ESC/POS printer.' }
    : result
}

/** @param {{labels?: HardwareRecord[], settings?: Record<string, unknown>}} [input] */
export async function printBarcodeLabels({ labels = [], settings = {} } = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  const pathTarget = String(normalized.escpos_printer_path || '').trim()
  if (!normalized.escpos_enabled || normalized.receipt_print_mode !== 'escpos') {
    return { success: false, error: 'Barcode labels require ESC/POS direct printing to be enabled.' }
  }
  if (normalized.escpos_connection_type !== 'path' || !pathTarget) {
    return { success: false, error: 'Barcode labels require a configured local printer output path. Configure and test the ESC/POS device first.' }
  }
  try {
    if (!fs.existsSync(pathTarget)) {
      return { success: false, error: `The configured printer output path does not exist: ${pathTarget}. Reconnect the printer and test it before printing labels.` }
    }
  } catch {
    return { success: false, error: 'The configured printer output path could not be verified. Reconnect the printer and try again.' }
  }
  const rows = Array.isArray(labels) ? labels.slice(0, 500) : []
  if (!rows.length) return { success: false, error: 'Select at least one stock item with a barcode.' }
  const validRows = rows.filter((row) => {
    const barcode = String(row?.barcode || '').trim()
    return Boolean(barcode) && !/[^\x20-\x7e]/.test(barcode) && barcode.length <= 80
  })
  if (!validRows.length) return { success: false, error: 'No selected stock item has a printable barcode.' }
  const buffers = [commandBuffer([ESC, 0x40]), commandBuffer([ESC, 0x61, 0x01])]
  for (const row of validRows) {
    const name = String(row?.name || 'Stock item').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 42)
    const barcode = String(row?.barcode || '').trim()
    if (!barcode || /[^\x20-\x7e]/.test(barcode) || barcode.length > 80) continue
    buffers.push(textBuffer(`${name}\n`))
    // Code 128, subset B.  The output is sent only to the verified configured
    // path; labels contain no financial or supplier information.
    const data = Buffer.from(`{B${barcode}`, 'ascii')
    buffers.push(commandBuffer([GS, 0x68, 0x50, GS, 0x77, 0x02, GS, 0x6b, 0x49, data.length]), data, textBuffer('\n\n'))
  }
  buffers.push(commandBuffer([ESC, 0x64, 0x03]), commandBuffer([ESC, 0x40]))
  const result = await sendRawEscPos({ ...normalized, escpos_connection_type: 'path' }, Buffer.concat(buffers))
  return result.success ? { ...result, printed: validRows.length, message: 'Barcode labels sent to the verified printer output path.' } : result
}

/** @param {Record<string, unknown>} [settings] */
export async function openCashDrawer(settings = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  if (!normalized.cash_drawer_enabled) {
    return { success: false, error: 'Cash drawer is not enabled in POS hardware settings.' }
  }
  if (normalized.cash_drawer_manual) {
    return { success: false, error: 'This drawer is set to manual (key open) — no electronic kick is attempted.' }
  }
  const result = await sendRawEscPos(normalized, buildCashDrawerPulse(normalized))
  return result.success
    ? { ...result, message: 'Cash drawer pulse sent.' }
    : result
}

/** @param {string} [kind] @param {Record<string, unknown>} [settings] @param {HardwareRecord} [business] */
export async function testPosHardwareDevice(kind = 'receipt', settings = {}, business = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  if (kind === 'drawer') return openCashDrawer(normalized)
  if (kind === 'payment-terminal') {
    return sendPaymentTerminalTotal(normalized, {
      amount: 1,
      currency: business.currency || 'BWP',
      reference: `TEST-${Date.now()}`,
      test: true
    })
  }
  if (kind === 'escpos' || (kind === 'receipt' && normalized.receipt_print_mode === 'escpos')) {
    const testOrder = {
      id: `TEST-${Date.now()}`,
      receipt_number: 'TEST-RECEIPT',
      walk_in_name: 'Hardware Test',
      payment_method: 'cash',
      pos_order_items: [{ item_name: 'Printer test item', quantity: 1, unit_price: 1 }],
      gross_total: 1,
      total: 1,
      created_at: new Date().toISOString()
    }
    return printEscPosReceipt({ order: testOrder, business, settings: normalized, openDrawer: false })
  }
  return {
    success: true,
    verified: false,
    kind,
    message: 'Windows printer mode is configured, but no receipt was sent. Use Print Receipt to perform and verify a real printer test.'
  }
}

/**
 * `data` is supplied by existing POS callers; this expectation type does not
 * validate provider responses or alter the bridge's existing JSON handling.
 * @param {Record<string, unknown>} [settings]
 * @param {{amount?: unknown, test?: unknown, currency?: unknown, reference?: unknown, request_id?: unknown, id?: unknown, metadata?: unknown}} [data]
 */
export async function sendPaymentTerminalTotal(settings = {}, data = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  const mode = normalized.payment_terminal_mode
  const amount = normalizeMoney(data.amount)
  if (mode === 'manual' || !normalized.payment_terminal_provider) {
    return {
      success: false,
      manual: true,
      error: 'Payment terminal is in manual mode. Charge the card machine manually and enter the approval code.'
    }
  }
  if (!normalized.payment_terminal_bridge_url) {
    return {
      success: false,
      error: `Provider ${normalized.payment_terminal_provider} is saved, but no local bridge/API URL is configured.`
    }
  }

  const payload = {
    type: data.test ? 'test_sale' : 'sale',
    provider: normalized.payment_terminal_provider,
    terminal: normalized.payment_terminal_name || null,
    amount,
    currency: data.currency || 'BWP',
    reference: data.reference || `POS-${Date.now()}`,
    request_id: data.request_id || data.id || cryptoRandomId(),
    metadata: data.metadata || {}
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), normalized.payment_terminal_timeout_ms)
  try {
    const response = await fetch(normalized.payment_terminal_bridge_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    const text = await response.text()
    /** @type {Record<string, unknown>} */
    let body = {}
    // The bridge contract is expected to return an object; JSON.parse itself
    // does not validate that expectation and this assertion preserves the
    // existing property access/failure behavior for malformed responses.
    try { body = text ? /** @type {Record<string, unknown>} */ (JSON.parse(text)) : {} } catch { body = { raw: text } }
    if (!response.ok) {
      return { success: false, error: body.error || body.message || `Terminal bridge returned ${response.status}.` }
    }
    const approved = body.approved === true || body.success === true || String(body.status || '').toLowerCase() === 'approved'
    if (!approved) {
      return {
        success: false,
        declined: true,
        error: body.error || body.message || body.status || 'Payment was not approved by the terminal.',
        terminal: body
      }
    }
    return {
      success: true,
      verified: true,
      approved: true,
      message: body.message || 'Payment approved by terminal.',
      approval_code: body.approval_code || body.approvalCode || body.auth_code || null,
      reference: body.reference || body.transaction_id || body.transactionId || payload.reference,
      terminal: body
    }
  } catch (error) {
    // fetch/Response failures here are native Error or DOMException objects.
    const requestError = /** @type {Error} */ (error)
    return {
      success: false,
      error: requestError?.name === 'AbortError'
        ? 'Timed out waiting for the payment terminal.'
        : requestError?.message || 'Could not reach payment terminal bridge.'
    }
  } finally {
    clearTimeout(timer)
  }
}

function cryptoRandomId() {
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function localPrinterSubnet() {
  const interfaces = os.networkInterfaces() || {};
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address?.family === 'IPv4' && address?.internal !== true && address?.address && address?.netmask === '255.255.255.0') {
        const parts = String(address.address).split('.');
        if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
          return { base: parts.slice(0, 3).join('.'), self: address.address };
        }
      }
    }
  }
  return null;
}

/** @param {string} host @param {number} [port] @param {number} [timeoutMs] @returns {Promise<boolean>} */
function probePrinterPort(host, port = DEFAULT_NETWORK_PORT, timeoutMs = 600) {
  return new Promise((resolve) => {
    let settled = false;
    /** @param {boolean} open */
    const finish = (open) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* best-effort close */ }
      resolve(open);
    };
    const socket = net.createConnection({ host, port });
    const guard = setTimeout(() => finish(false), timeoutMs + 250);
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => { clearTimeout(guard); finish(true); });
    socket.once('error', () => { clearTimeout(guard); finish(false); });
    socket.once('timeout', () => { clearTimeout(guard); finish(false); });
  });
}

/** @param {{port?: number, timeoutMs?: number, concurrency?: number}} [options] */
export async function scanNetworkPrinters({ port = DEFAULT_NETWORK_PORT, timeoutMs = 600, concurrency = 48 } = {}) {
  // Connect-only probe: no bytes are ever sent, so tills, routers, and PCs
  // answer (or refuse) without printing anything.
  const targetPort = clampNumber(port, DEFAULT_NETWORK_PORT, 1, 65535);
  const subnet = localPrinterSubnet();
  if (!subnet) {
    return { success: false, error: 'No bar network found on this computer. Connect to the bar WiFi or LAN first.' };
  }
  const hosts = [];
  for (let last = 1; last <= 254; last += 1) {
    const host = `${subnet.base}.${last}`;
    if (host !== subnet.self) hosts.push(host);
  }
  const found = [];
  const batchSize = Math.max(8, Math.min(64, Math.round(Number(concurrency) || 48)));
  for (let index = 0; index < hosts.length; index += batchSize) {
    const batch = hosts.slice(index, index + batchSize);
    const results = await Promise.all(batch.map(async (host) => ({ host, open: await probePrinterPort(host, targetPort, timeoutMs) })));
    for (const result of results) {
      if (result.open) found.push({ host: result.host, port: targetPort });
    }
  }
  return {
    success: true,
    subnet: `${subnet.base}.0/24`,
    port: targetPort,
    found,
    message: found.length
      ? `Found ${found.length} device${found.length === 1 ? '' : 's'} answering on printer port ${targetPort}. Print a test page before saving — only your till printer belongs here.`
      : `No printers answered on ${subnet.base}.0/24 port ${targetPort}. Check the printer is on and on the same WiFi, then try again.`
  };
}
