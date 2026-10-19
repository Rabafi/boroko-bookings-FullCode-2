// @ts-check
import fs from 'fs';
import net from 'net';

/**
 * Input views at the hardware boundary describe fields read by this adapter.
 * Persisted settings and provider/cache rows are not runtime-validated here.
 * @typedef {Record<string, unknown>} HardwareSettingsExpectedData
 * @typedef {Record<string, unknown>} ReceiptOrderExpectedView
 * @typedef {Record<string, unknown>} ReceiptBusinessExpectedView
 * @typedef {Record<string, unknown>} ReceiptItemExpectedView
 * @typedef {Record<string, unknown>} ReceiptPaymentExpectedView
 * @typedef {{openDrawer?: unknown}} ReceiptBuildOptionsExpectedView
 * @typedef {{
 *   receipt_printer_name: string,
 *   receipt_paper_width: unknown,
 *   receipt_print_mode: 'escpos' | 'windows',
 *   auto_print_receipts: boolean,
 *   receipt_cut_enabled: boolean,
 *   cash_drawer_enabled: boolean,
 *   cash_drawer_command: unknown,
 *   cash_drawer_open_on_cash: boolean,
 *   cash_drawer_open_timing: 'before_receipt' | 'after_payment',
 *   cash_drawer_pin: '1' | '0',
 *   cash_drawer_pulse_on_ms: number,
 *   cash_drawer_pulse_off_ms: number,
 *   escpos_enabled: boolean,
 *   escpos_connection_type: string,
 *   escpos_network_host: string,
 *   escpos_network_port: number,
 *   escpos_printer_path: string,
 *   escpos_codepage: unknown,
 *   escpos_timeout_ms: number,
 *   payment_terminal_provider: string,
 *   payment_terminal_name: string,
 *   payment_terminal_mode: 'manual' | 'local_bridge' | 'provider_api',
 *   payment_terminal_bridge_url: string,
 *   payment_terminal_timeout_ms: number,
 *   customer_display_enabled: boolean,
 *   updated_at: unknown
 * }} NormalizedHardwareAdapterSettings
 * @typedef {{type: 'network', host: string, port: number} | {type: 'path', path: string}} RawPrinterTarget
 * @typedef {Record<string, unknown>} PaymentTerminalBridgeReplyExpectedView
 */

const ESC = 0x1b;
const GS = 0x1d;

const DEFAULT_NETWORK_PORT = 9100;
const DEFAULT_TIMEOUT_MS = 8000;

/** @param {unknown} value @param {boolean} [fallback] @returns {boolean} */
function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** @param {unknown} value @param {number} [fallback] @returns {number} */
function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max @returns {number} */
function clampNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, toNumber(value, fallback)));
}

/** @param {unknown} value @returns {number} */
function normalizeMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

/** @param {unknown} value @returns {string} */
function stripControl(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/** @param {unknown} value @returns {string} */
function sanitizeText(value) {
  return String(value || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2022\u00b7]/g, '-')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
}

/** @param {unknown} [value] @returns {Buffer} */
function textBuffer(value = '') {
  return Buffer.from(sanitizeText(value), 'latin1');
}

/** @param {number[]} [values] @returns {Buffer} */
function commandBuffer(values = []) {
  return Buffer.from(values);
}

/** @param {unknown} [codepage] @returns {number} */
function escposCodepageByte(codepage = 'cp437') {
  const normalized = String(codepage || '').toLowerCase();
  if (normalized === 'cp850') return 2;
  if (normalized === 'cp858') return 19;
  if (normalized === 'cp860') return 3;
  if (normalized === 'cp863') return 4;
  if (normalized === 'cp865') return 5;
  return 0;
}

/** @param {unknown} [width] @returns {number} */
function paperColumns(width = '80mm') {
  const normalized = String(width || '').toLowerCase();
  if (normalized.includes('58')) return 32;
  if (normalized.includes('a4')) return 48;
  return 42;
}

/** @param {unknown} value @param {number} width @returns {string[]} */
function wrapText(value, width) {
  const words = sanitizeText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= width) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** @param {unknown} left @param {unknown} right @param {number} width @returns {string[]} */
function twoColumn(left, right, width) {
  const safeRight = sanitizeText(right);
  const rightWidth = Math.min(width, safeRight.length);
  const leftWidth = Math.max(1, width - rightWidth - 1);
  const leftLines = wrapText(left, leftWidth);
  return leftLines.map((line, index) => {
    if (index > 0) return line;
    return `${line.padEnd(leftWidth, ' ')} ${safeRight.slice(0, rightWidth).padStart(rightWidth, ' ')}`;
  });
}

/** @param {unknown} pathValue @returns {string} */
function normalizeDevicePath(pathValue) {
  const raw = stripControl(pathValue);
  if (/^(com|lpt)\d+:?$/i.test(raw)) {
    return `\\\\.\\${raw.replace(/:$/, '')}`;
  }
  return raw;
}

/** @param {unknown} pathValue @returns {{host: string, port: number} | null} */
function parseNetworkPath(pathValue) {
  const raw = stripControl(pathValue);
  if (!raw) return null;
  const tcpMatch = raw.match(/^tcp:\/\/([^:/]+)(?::(\d+))?$/i);
  if (tcpMatch) {
    return {
      host: tcpMatch[1],
      port: clampNumber(tcpMatch[2], DEFAULT_NETWORK_PORT, 1, 65535)
    };
  }
  const hostPortMatch = raw.match(/^([a-z0-9.-]+):(\d+)$/i);
  if (hostPortMatch) {
    return {
      host: hostPortMatch[1],
      port: clampNumber(hostPortMatch[2], DEFAULT_NETWORK_PORT, 1, 65535)
    };
  }
  return null;
}

/** @param {HardwareSettingsExpectedData} settings @returns {RawPrinterTarget | null} */
function inferRawTarget(settings) {
  const connectionType = String(settings.escpos_connection_type || 'network').toLowerCase();
  const pathTarget = stripControl(settings.escpos_printer_path);
  const parsedPath = parseNetworkPath(pathTarget);

  if (connectionType === 'network' || parsedPath) {
    return {
      type: 'network',
      host: stripControl(settings.escpos_network_host) || parsedPath?.host || pathTarget,
      port: clampNumber(settings.escpos_network_port || parsedPath?.port, DEFAULT_NETWORK_PORT, 1, 65535)
    };
  }

  if (connectionType === 'path' || connectionType === 'share' || connectionType === 'serial') {
    return { type: 'path', path: normalizeDevicePath(pathTarget) };
  }

  if (pathTarget) {
    return { type: 'path', path: normalizeDevicePath(pathTarget) };
  }

  return null;
}

/**
 * @param {HardwareSettingsExpectedData} [settings]
 * @returns {NormalizedHardwareAdapterSettings}
 */
export function normalizePosHardwareSettings(settings = {}) {
  const escposEnabled = toBool(settings.escpos_enabled, false);
  const receiptPrintMode = String(
    settings.receipt_print_mode || (escposEnabled ? 'escpos' : 'windows')
  ).toLowerCase();
  const paymentMode = String(settings.payment_terminal_mode || 'manual').toLowerCase();
  return {
    receipt_printer_name: stripControl(settings.receipt_printer_name),
    receipt_paper_width: settings.receipt_paper_width || '80mm',
    receipt_print_mode: receiptPrintMode === 'escpos' ? 'escpos' : 'windows',
    auto_print_receipts: toBool(settings.auto_print_receipts, false),
    receipt_cut_enabled: toBool(settings.receipt_cut_enabled, true),
    cash_drawer_enabled: toBool(settings.cash_drawer_enabled, false),
    cash_drawer_command: settings.cash_drawer_command || 'ESC/POS kick',
    cash_drawer_open_on_cash: toBool(settings.cash_drawer_open_on_cash, false),
    cash_drawer_open_timing: settings.cash_drawer_open_timing === 'before_receipt'
      ? 'before_receipt' : 'after_payment',
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
    payment_terminal_mode: ['manual', 'local_bridge', 'provider_api'].includes(paymentMode)
      ? paymentMode : 'manual',
    payment_terminal_bridge_url: stripControl(settings.payment_terminal_bridge_url),
    payment_terminal_timeout_ms: clampNumber(settings.payment_terminal_timeout_ms, DEFAULT_TIMEOUT_MS, 1500, 60000),
    customer_display_enabled: toBool(settings.customer_display_enabled, false),
    updated_at: settings.updated_at || null
  };
}

export function buildCashDrawerPulse(settings = {}) {
  const normalized = normalizePosHardwareSettings(settings);
  const pin = normalized.cash_drawer_pin === '1' ? 1 : 0;
  const on = Math.round(normalized.cash_drawer_pulse_on_ms / 2);
  const off = Math.round(normalized.cash_drawer_pulse_off_ms / 2);
  return commandBuffer([ESC, 0x70, pin, Math.max(1, Math.min(255, on)), Math.max(1, Math.min(255, off))]);
}

/** @param {ReceiptOrderExpectedView} [order] @returns {boolean} */
function isCashOrder(order = {}) {
  /** @type {unknown[]} */
  const payments = Array.isArray(order.payment_breakdown)
    ? order.payment_breakdown
    : typeof order.payment_breakdown === 'string'
      ? (() => { try { const parsed = JSON.parse(order.payment_breakdown); return Array.isArray(parsed) ? /** @type {unknown[]} */ (parsed) : []; } catch { return []; } })()
      : [];
  // The pre-existing array guard does not validate persisted elements.
  return payments.some((payment) => String((/** @type {ReceiptPaymentExpectedView} */ (payment)).method || '').toLowerCase() === 'cash'
    && normalizeMoney((/** @type {ReceiptPaymentExpectedView} */ (payment)).amount) > 0);
}

/** @param {Buffer[]} buffers @param {unknown} [value] */
function pushText(buffers, value = '') {
  buffers.push(textBuffer(`${value}\n`));
}

/** @param {Buffer[]} buffers @param {string} [align] */
function pushAlign(buffers, align = 'left') {
  const code = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  buffers.push(commandBuffer([ESC, 0x61, code]));
}

/** @param {Buffer[]} buffers @param {boolean} enabled */
function pushBold(buffers, enabled) {
  buffers.push(commandBuffer([ESC, 0x45, enabled ? 1 : 0]));
}

/** @param {Buffer[]} buffers @param {number} width @param {string} [value] */
function pushRule(buffers, width, value = '-') {
  pushText(buffers, value.repeat(width));
}

/** @param {unknown} currency @param {unknown} value @returns {string} */
function formatCurrency(currency, value) {
  return `${currency || 'P'} ${normalizeMoney(value).toFixed(2)}`;
}

/** @param {unknown} value @returns {number | null} */
function recordedMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/** @param {ReceiptItemExpectedView} [item] @returns {number | null} */
function recordedItemAmount(item = {}) {
  for (const key of ['net_subtotal', 'subtotal', 'gross_subtotal']) {
    const amount = recordedMoney(item?.[key]);
    if (amount !== null) return amount;
  }
  return null;
}

/**
 * Existing Array.isArray checks retain their behavior but do not validate rows.
 * @param {ReceiptOrderExpectedView} order
 * @returns {ReceiptItemExpectedView[]}
 */
function receiptItems(order) {
  return Array.isArray(order?.pos_order_items) ? order.pos_order_items : Array.isArray(order?.items) ? order.items : [];
}

/**
 * Existing Array.isArray checks retain their behavior but do not validate rows.
 * @param {ReceiptOrderExpectedView} order
 * @returns {ReceiptPaymentExpectedView[]}
 */
function receiptPayments(order) {
  if (Array.isArray(order?.payment_breakdown)) return order.payment_breakdown;
  if (typeof order?.payment_breakdown === 'string') {
    try {
      const parsed = JSON.parse(order.payment_breakdown);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * @param {ReceiptOrderExpectedView} [order]
 * @param {ReceiptBusinessExpectedView} [business]
 * @param {HardwareSettingsExpectedData} [settings]
 * @param {ReceiptBuildOptionsExpectedView} [options]
 * @returns {Buffer}
 */
export function buildEscPosReceipt(order = {}, business = {}, settings = {}, options = {}) {
  const normalized = normalizePosHardwareSettings(settings);
  const width = paperColumns(normalized.receipt_paper_width);
  const currency = business.currency || 'P';
  const receiptNo = order.receipt_number ||
    (order?._pending_sync === true ? 'PROVISIONAL — PENDING SERVER NUMBER' : 'RECEIPT NUMBER UNAVAILABLE');
  const provisional = order?._pending_sync === true;
  const buffers = [
    commandBuffer([ESC, 0x40]),
    commandBuffer([ESC, 0x74, escposCodepageByte(normalized.escpos_codepage)])
  ];

  if (options.openDrawer === 'before') buffers.push(buildCashDrawerPulse(normalized));

  pushAlign(buffers, 'center');
  pushBold(buffers, true);
  pushText(buffers, business.lodge_name || business.company_name || 'Tsa Bonno POS Legacy');
  pushBold(buffers, false);
  for (const line of [business.company_name, business.address, business.city, business.country].filter(Boolean)) {
    for (const wrapped of wrapText(line, width)) pushText(buffers, wrapped);
  }
  if (business.phone || business.email) {
    for (const wrapped of wrapText([business.phone, business.email].filter(Boolean).join(' / '), width)) {
      pushText(buffers, wrapped);
    }
  }
  if (business.vat_number) pushText(buffers, `VAT No: ${business.vat_number}`);

  pushAlign(buffers, 'left');
  pushRule(buffers, width);
  if (provisional) {
    pushText(buffers, 'PROVISIONAL — PENDING SERVER CONFIRMATION');
    pushText(buffers, 'Amounts remain estimates until the server confirms this sale.');
    pushRule(buffers, width);
  }
  pushText(buffers, `Receipt: ${receiptNo}`);
  pushText(buffers, `Date: ${new Date(order.created_at || Date.now()).toLocaleString('en-GB')}`);
  if (order.cashier_name) pushText(buffers, `Cashier: ${order.cashier_name}`);
  if (order.outlet_name) pushText(buffers, `Outlet: ${order.outlet_name}`);
  if (order.table_name) pushText(buffers, `Table: ${order.table_name}`);
  if (order.walk_in_name) pushText(buffers, `Guest: ${order.walk_in_name}`);
  if (order.room_id) pushText(buffers, 'Guest: Room guest');
  pushRule(buffers, width);

  for (const item of receiptItems(order)) {
    const quantity = normalizeMoney(item.quantity || 0);
    const unitPrice = recordedMoney(item.unit_price ?? item.price);
    const total = recordedItemAmount(item);
    for (const line of wrapText(item.item_name || 'Item', width)) pushText(buffers, line);
    const unitLabel = unitPrice === null ? 'Unit price unavailable' : `${quantity} x ${formatCurrency(currency, unitPrice)}`;
    const amountLabel = total === null ? 'Amount unavailable' : formatCurrency(currency, total);
    pushText(buffers, twoColumn(unitLabel, amountLabel, width)[0]);
    const modifierText = [
      // The existing array test does not validate persisted modifier rows.
      ...(Array.isArray(item.modifiers) ? /** @type {unknown[]} */ (item.modifiers).map((modifier) => (/** @type {Record<string, unknown>} */ (modifier)).name).filter(Boolean) : []),
      item.item_notes
    ].filter(Boolean).join(', ');
    if (modifierText) {
      for (const line of wrapText(`  ${modifierText}`, width)) pushText(buffers, line);
    }
  }

  pushRule(buffers, width);
  /** @type {[string, unknown][]} */
  const totals = [
    ['Gross', order.gross_total],
    ['Discount', recordedMoney(order.discount_total) !== null && Number(order.discount_total) > 0 ? -Math.abs(Number(order.discount_total)) : null],
    ['Tax/VAT', order.tax_total],
    ['Tip', order.tip_total]
  ].filter(([, v]) => recordedMoney(v) !== null && Number(v) !== 0);
  for (const [label, value] of totals) {
    for (const line of twoColumn(label, formatCurrency(currency, value), width)) pushText(buffers, line);
  }
  pushBold(buffers, true);
  const totalAmount = recordedMoney(order.total);
  for (const line of twoColumn('TOTAL', totalAmount === null ? 'Amount unavailable' : formatCurrency(currency, totalAmount), width)) pushText(buffers, line);
  pushBold(buffers, false);

  const payments = receiptPayments(order);
  if (payments.length) {
    pushRule(buffers, width);
    pushText(buffers, 'Payments');
    for (const payment of payments) {
      const paymentAmount = recordedMoney(payment.amount);
      for (const line of twoColumn(payment.method || 'Tender unavailable', paymentAmount === null ? 'Amount unavailable' : formatCurrency(currency, paymentAmount), width)) {
        pushText(buffers, line);
      }
      if (payment.reference) pushText(buffers, `Ref: ${payment.reference}`);
    }
  } else {
    pushText(buffers, `Method: ${order.payment_method || 'Tender unavailable'}`);
  }

  pushRule(buffers, width);
  pushAlign(buffers, 'center');
  pushText(buffers, 'Thank you for your business');
  pushText(buffers, 'Tsa Bonno POS Legacy');
  pushAlign(buffers, 'left');
  buffers.push(textBuffer('\n\n\n'));

  if (options.openDrawer === 'after') buffers.push(buildCashDrawerPulse(normalized));
  if (normalized.receipt_cut_enabled) buffers.push(commandBuffer([GS, 0x56, 0x42, 0x00]));
  return Buffer.concat(buffers);
}

/**
 * @param {HardwareSettingsExpectedData} [settings]
 * @param {unknown} payload
 */
export async function sendRawEscPos(settings = {}, payload) {
  const normalized = normalizePosHardwareSettings(settings);
  if (!normalized.escpos_enabled && normalized.receipt_print_mode !== 'escpos') {
    return { success: false, error: 'ESC/POS direct mode is not enabled.' };
  }
  const target = inferRawTarget(normalized);
  if (!target || (target.type === 'network' && !target.host) || (target.type === 'path' && !target.path)) {
    return { success: false, error: 'Set an ESC/POS network host, device path, or Windows printer share first.' };
  }

  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(/** @type {string | ArrayLike<number>} */ (payload || []));
  try {
    if (target.type === 'network') {
      await sendTcp(target.host, target.port, bytes, normalized.escpos_timeout_ms || DEFAULT_TIMEOUT_MS);
      return { success: true, transport: 'network', target: `${target.host}:${target.port}` };
    }
    await sendPath(target.path, bytes);
    return { success: true, transport: 'path', target: target.path };
  } catch (error) {
    return { success: false, error: (/** @type {{message?: unknown} | null | undefined} */ (error))?.message || 'Could not send ESC/POS command.' };
  }
}

/** @param {string} host @param {number} port @param {Buffer} payload @param {number} [timeoutMs] @returns {Promise<void>} */
function sendTcp(host, port, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ host, port });
    /** @param {Error | undefined} [error] */
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(payload, (/** @type {Error | undefined} */ error) => {
        if (error) finish(error); else socket.end();
      });
    });
    socket.once('error', finish);
    socket.once('timeout', () => finish(new Error(`Timed out connecting to ${host}:${port}.`)));
    socket.once('close', () => finish());
  });
}

/** @param {string} targetPath @param {Buffer} payload @returns {Promise<void>} */
function sendPath(targetPath, payload) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(targetPath);
    stream.once('error', reject);
    stream.once('finish', resolve);
    stream.end(payload);
  });
}

/** @param {{order?: ReceiptOrderExpectedView, business?: ReceiptBusinessExpectedView, settings?: HardwareSettingsExpectedData, openDrawer?: boolean}} [request] */
export async function printEscPosReceipt({ order = {}, business = {}, settings = {}, openDrawer = false } = {}) {
  const normalized = normalizePosHardwareSettings(settings);
  const drawerTiming = openDrawer && normalized.cash_drawer_enabled && isCashOrder(order)
    ? normalized.cash_drawer_open_timing : null;
  const receipt = buildEscPosReceipt(order, business, normalized, {
    openDrawer: drawerTiming === 'before_receipt' ? 'before' : null
  });
  const payload = drawerTiming === 'after_payment'
    ? Buffer.concat([receipt, buildCashDrawerPulse(normalized)])
    : receipt;
  const result = await sendRawEscPos(normalized, payload);
  return result.success
    ? { ...result, message: 'Receipt sent to ESC/POS printer.' }
    : result;
}

/** @param {HardwareSettingsExpectedData} [settings] */
export async function openCashDrawer(settings = {}) {
  const normalized = normalizePosHardwareSettings(settings);
  if (!normalized.cash_drawer_enabled) {
    return { success: false, error: 'Cash drawer is not enabled in POS hardware settings.' };
  }
  const result = await sendRawEscPos(normalized, buildCashDrawerPulse(normalized));
  return result.success
    ? { ...result, message: 'Cash drawer pulse sent.' }
    : result;
}

/** @param {string} [kind] @param {HardwareSettingsExpectedData} [settings] @param {ReceiptBusinessExpectedView} [business] */
export async function testPosHardwareDevice(kind = 'receipt', settings = {}, business = {}) {
  const normalized = normalizePosHardwareSettings(settings);
  if (kind === 'drawer') return openCashDrawer(normalized);
  if (kind === 'payment-terminal') {
    return sendPaymentTerminalTotal(normalized, {
      amount: 1,
      currency: business.currency || 'BWP',
      reference: `TEST-${Date.now()}`,
      test: true
    });
  }
  if (kind === 'escpos' || kind === 'receipt') {
    const testOrder = {
      id: `TEST-${Date.now()}`,
      receipt_number: 'TEST-RECEIPT',
      walk_in_name: 'Hardware Test',
      payment_method: 'cash',
      pos_order_items: [{ item_name: 'Printer test item', quantity: 1, unit_price: 1 }],
      gross_total: 1,
      total: 1,
      created_at: new Date().toISOString()
    };
    return printEscPosReceipt({ order: testOrder, business, settings: normalized, openDrawer: false });
  }
  return {
    success: true,
    kind,
    message: 'Windows printer mode is configured. Use Print Receipt to test.'
  };
}

/** @param {HardwareSettingsExpectedData} [settings] @param {Record<string, unknown>} [data] */
export async function sendPaymentTerminalTotal(settings = {}, data = {}) {
  const normalized = normalizePosHardwareSettings(settings);
  const mode = normalized.payment_terminal_mode;
  const amount = normalizeMoney(data.amount);
  if (mode === 'manual' || !normalized.payment_terminal_provider) {
    return {
      success: false,
      manual: true,
      error: 'Payment terminal is in manual mode. Charge the card machine manually and enter the approval code.'
    };
  }
  if (!normalized.payment_terminal_bridge_url) {
    return {
      success: false,
      error: `Provider ${normalized.payment_terminal_provider} is saved, but no local bridge/API URL is configured.`
    };
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
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), normalized.payment_terminal_timeout_ms);
  try {
    const response = await fetch(normalized.payment_terminal_bridge_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    // Provider JSON is untrusted. This expected view records fields consumed
    // below without claiming the response was validated.
    let body = /** @type {PaymentTerminalBridgeReplyExpectedView} */ ({});
    try { body = /** @type {PaymentTerminalBridgeReplyExpectedView} */ (text ? JSON.parse(text) : {}); } catch { body = { raw: text }; }
    if (!response.ok) {
      return { success: false, error: body.error || body.message || `Terminal bridge returned ${response.status}.` };
    }
    const approved = body.approved === true || body.success === true || String(body.status || '').toLowerCase() === 'approved';
    if (!approved) {
      return {
        success: false,
        declined: true,
        error: body.error || body.message || body.status || 'Payment was not approved by the terminal.',
        terminal: body
      };
    }
    return {
      success: true,
      approved: true,
      message: body.message || 'Payment approved by terminal.',
      approval_code: body.approval_code || body.approvalCode || body.auth_code || null,
      reference: body.reference || body.transaction_id || body.transactionId || payload.reference,
      terminal: body
    };
  } catch (error) {
    return {
      success: false,
      error: (/** @type {{name?: unknown; message?: unknown} | null | undefined} */ (error))?.name === 'AbortError'
        ? 'Timed out waiting for the payment terminal.'
        : (/** @type {{message?: unknown} | null | undefined} */ (error))?.message || 'Could not reach payment terminal bridge.'
    };
  } finally {
    clearTimeout(timer);
  }
}

function cryptoRandomId() {
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
