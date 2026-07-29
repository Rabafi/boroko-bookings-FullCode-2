import fs from 'fs'
import net from 'net'
import { ECOSYSTEM_BRAND } from '../../shared/brandIdentity.js'

const ESC = 0x1b
const GS = 0x1d

const DEFAULT_NETWORK_PORT = 9100
const DEFAULT_TIMEOUT_MS = 8000

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return value === true || value === 'true' || value === 1 || value === '1'
}

function toNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function clampNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, toNumber(value, fallback)))
}

function normalizeMoney(value) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0
}

function stripControl(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

function normalizeScannerPrefixOrSuffix(value) {
  // Scanner framing is deliberately limited to printable ASCII.  Prefixes
  // and suffixes are configuration, not a place to store arbitrary control
  // sequences or secrets.
  return stripControl(value).slice(0, 16)
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/[–—]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?')
}

function textBuffer(value = '') {
  return Buffer.from(sanitizeText(value), 'latin1')
}

function commandBuffer(values = []) {
  return Buffer.from(values)
}

function escposCodepageByte(codepage = 'cp437') {
  const normalized = String(codepage || '').toLowerCase()
  if (normalized === 'cp850') return 2
  if (normalized === 'cp858') return 19
  if (normalized === 'cp860') return 3
  if (normalized === 'cp863') return 4
  if (normalized === 'cp865') return 5
  return 0
}

function paperColumns(width = '80mm') {
  const normalized = String(width || '').toLowerCase()
  if (normalized.includes('58')) return 32
  if (normalized.includes('a4')) return 48
  return 42
}

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

function normalizeDevicePath(pathValue) {
  const raw = stripControl(pathValue)
  if (/^(com|lpt)\d+:?$/i.test(raw)) {
    return `\\\\.\\${raw.replace(/:$/, '')}`
  }
  return raw
}

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
    updated_at: settings.updated_at || null
  }
}

export function buildCashDrawerPulse(settings = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  const pin = normalized.cash_drawer_pin === '1' ? 1 : 0
  const on = Math.round(normalized.cash_drawer_pulse_on_ms / 2)
  const off = Math.round(normalized.cash_drawer_pulse_off_ms / 2)
  return commandBuffer([ESC, 0x70, pin, Math.max(1, Math.min(255, on)), Math.max(1, Math.min(255, off))])
}

function isCashOrder(order = {}) {
  if (String(order.payment_method || '').toLowerCase() === 'cash') return true
  const payments = Array.isArray(order.payment_breakdown)
    ? order.payment_breakdown
    : typeof order.payment_breakdown === 'string'
      ? (() => { try { return JSON.parse(order.payment_breakdown) } catch { return [] } })()
      : []
  return payments.some((payment) => String(payment.method || '').toLowerCase() === 'cash' && normalizeMoney(payment.amount) > 0)
}

function pushText(buffers, value = '') {
  buffers.push(textBuffer(`${value}\n`))
}

function pushAlign(buffers, align = 'left') {
  const code = align === 'center' ? 1 : align === 'right' ? 2 : 0
  buffers.push(commandBuffer([ESC, 0x61, code]))
}

function pushBold(buffers, enabled) {
  buffers.push(commandBuffer([ESC, 0x45, enabled ? 1 : 0]))
}

function pushRule(buffers, width, value = '-') {
  pushText(buffers, value.repeat(width))
}

function formatCurrency(currency, value) {
  return `${currency || 'P'} ${normalizeMoney(value).toFixed(2)}`
}

function receiptItems(order) {
  return Array.isArray(order?.pos_order_items) ? order.pos_order_items : Array.isArray(order?.items) ? order.items : []
}

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

export function buildEscPosReceipt(order = {}, business = {}, settings = {}, options = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  const width = paperColumns(normalized.receipt_paper_width)
  const currency = business.currency || 'P'
  const receiptNo = order.receipt_number
    || (order.id ? `POS-${String(order.id).slice(0, 8).toUpperCase()}` : 'DRAFT')
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
  pushText(buffers, `Receipt: ${receiptNo}`)
  pushText(buffers, `Date: ${new Date(order.created_at || Date.now()).toLocaleString('en-GB')}`)
  if (order.cashier_name) pushText(buffers, `Cashier: ${order.cashier_name}`)
  if (order.outlet_name) pushText(buffers, `Outlet: ${order.outlet_name}`)
  if (order.table_name) pushText(buffers, `Table: ${order.table_name}`)
  if (order.walk_in_name) pushText(buffers, `Guest: ${order.walk_in_name}`)
  if (order.room_id) pushText(buffers, 'Guest: Room guest')
  pushRule(buffers, width)

  for (const item of receiptItems(order)) {
    const quantity = normalizeMoney(item.quantity || 0)
    const unitPrice = normalizeMoney(item.unit_price || item.price || 0)
    const total = normalizeMoney(quantity * unitPrice)
    for (const line of wrapText(item.item_name || item.name || 'Item', width)) pushText(buffers, line)
    pushText(buffers, twoColumn(`${quantity} x ${formatCurrency(currency, unitPrice)}`, formatCurrency(currency, total), width)[0])
    const modifierText = [
      ...(Array.isArray(item.modifiers) ? item.modifiers.map((mod) => mod.name).filter(Boolean) : []),
      item.item_notes
    ].filter(Boolean).join(', ')
    if (modifierText) {
      for (const line of wrapText(`  ${modifierText}`, width)) pushText(buffers, line)
    }
  }

  pushRule(buffers, width)
  const totals = [
    ['Gross', order.gross_total],
    ['Discount', Number(order.discount_total || 0) > 0 ? -Math.abs(Number(order.discount_total || 0)) : null],
    ['Tax/VAT', order.tax_total],
    ['Tip', order.tip_total]
  ].filter(([, value]) => value !== null && Number(value || 0) !== 0)
  for (const [label, value] of totals) {
    for (const line of twoColumn(label, formatCurrency(currency, value), width)) pushText(buffers, line)
  }
  pushBold(buffers, true)
  for (const line of twoColumn('TOTAL', formatCurrency(currency, order.total || 0), width)) pushText(buffers, line)
  pushBold(buffers, false)

  const payments = receiptPayments(order)
  if (payments.length) {
    pushRule(buffers, width)
    pushText(buffers, 'Payments')
    for (const payment of payments) {
      for (const line of twoColumn(payment.method || 'Payment', formatCurrency(currency, payment.amount || 0), width)) pushText(buffers, line)
      if (payment.reference) pushText(buffers, `Ref: ${payment.reference}`)
    }
  } else if (order.payment_method) {
    pushText(buffers, `Method: ${order.payment_method}`)
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
      return { success: true, transport: 'network', target: `${target.host}:${target.port}` }
    }
    await sendPath(target.path, bytes)
    return { success: true, transport: 'path', target: target.path }
  } catch (error) {
    return { success: false, error: error?.message || 'Could not send ESC/POS command.' }
  }
}

function sendTcp(host, port, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    const socket = net.createConnection({ host, port })
    const finish = (error) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      socket.write(payload, (error) => {
        if (error) finish(error)
        else socket.end()
      })
    })
    socket.once('error', finish)
    socket.once('timeout', () => finish(new Error(`Timed out connecting to ${host}:${port}.`)))
    socket.once('close', () => finish())
  })
}

function sendPath(targetPath, payload) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(targetPath)
    stream.once('error', reject)
    stream.once('finish', resolve)
    stream.end(payload)
  })
}

export async function printEscPosReceipt({ order = {}, business = {}, settings = {}, openDrawer = false } = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  const drawerTiming = openDrawer && normalized.cash_drawer_enabled && isCashOrder(order)
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

export async function openCashDrawer(settings = {}) {
  const normalized = normalizePosHardwareSettings(settings)
  if (!normalized.cash_drawer_enabled) {
    return { success: false, error: 'Cash drawer is not enabled in POS hardware settings.' }
  }
  const result = await sendRawEscPos(normalized, buildCashDrawerPulse(normalized))
  return result.success
    ? { ...result, message: 'Cash drawer pulse sent.' }
    : result
}

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
    kind,
    message: 'Windows printer mode is configured. Use Print Receipt to test the selected Windows printer.'
  }
}

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
    let body = {}
    try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text } }
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
      approved: true,
      message: body.message || 'Payment approved by terminal.',
      approval_code: body.approval_code || body.approvalCode || body.auth_code || null,
      reference: body.reference || body.transaction_id || body.transactionId || payload.reference,
      terminal: body
    }
  } catch (error) {
    return {
      success: false,
      error: error?.name === 'AbortError'
        ? 'Timed out waiting for the payment terminal.'
        : error?.message || 'Could not reach payment terminal bridge.'
    }
  } finally {
    clearTimeout(timer)
  }
}

function cryptoRandomId() {
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
