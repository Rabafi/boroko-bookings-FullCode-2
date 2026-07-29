function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, toNumber(value, fallback)));
}

function stripControl(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function normalizeScannerFraming(value) {
  return stripControl(value).slice(0, 16);
}

export function normalizePosHardwareSettings(settings = {}) {
  const escposEnabled = toBool(settings.escpos_enabled, false);
  const receiptPrintMode = String(
    settings.receipt_print_mode || (escposEnabled ? 'escpos' : 'windows')
  ).toLowerCase();
  const paymentMode = String(settings.payment_terminal_mode || 'manual').toLowerCase();
  const barcodeMinLength = Math.max(1, Math.min(128, Number(settings.barcode_scanner_min_length) || 4));
  const barcodeMaxLength = Math.max(barcodeMinLength, Math.min(128, Number(settings.barcode_scanner_max_length) || 128));
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
      ? 'before_receipt'
      : 'after_payment',
    cash_drawer_pin: settings.cash_drawer_pin === '1' ? '1' : '0',
    cash_drawer_pulse_on_ms: clampNumber(settings.cash_drawer_pulse_on_ms, 50, 10, 2550),
    cash_drawer_pulse_off_ms: clampNumber(settings.cash_drawer_pulse_off_ms, 250, 10, 2550),
    escpos_enabled: escposEnabled || receiptPrintMode === 'escpos',
    escpos_connection_type: String(settings.escpos_connection_type || 'network').toLowerCase(),
    escpos_network_host: stripControl(settings.escpos_network_host),
    escpos_network_port: clampNumber(settings.escpos_network_port, 9100, 1, 65535),
    escpos_printer_path: stripControl(settings.escpos_printer_path),
    escpos_codepage: settings.escpos_codepage || 'cp437',
    escpos_timeout_ms: clampNumber(settings.escpos_timeout_ms, 8000, 1500, 60000),
    payment_terminal_provider: stripControl(settings.payment_terminal_provider),
    payment_terminal_name: stripControl(settings.payment_terminal_name),
    payment_terminal_mode: ['manual', 'local_bridge', 'provider_api'].includes(paymentMode)
      ? paymentMode
      : 'manual',
    payment_terminal_bridge_url: stripControl(settings.payment_terminal_bridge_url),
    payment_terminal_timeout_ms: clampNumber(settings.payment_terminal_timeout_ms, 8000, 1500, 60000),
    barcode_scanner_enabled: toBool(settings.barcode_scanner_enabled, true),
    barcode_scanner_min_length: barcodeMinLength,
    barcode_scanner_max_length: barcodeMaxLength,
    barcode_scanner_inter_key_ms: clampNumber(settings.barcode_scanner_inter_key_ms, 120, 10, 1000),
    barcode_scanner_idle_complete_ms: clampNumber(settings.barcode_scanner_idle_complete_ms, 180, 50, 2000),
    barcode_scanner_accept_enter: toBool(settings.barcode_scanner_accept_enter, true),
    barcode_scanner_accept_tab: toBool(settings.barcode_scanner_accept_tab, true),
    barcode_scanner_prefix: normalizeScannerFraming(settings.barcode_scanner_prefix),
    barcode_scanner_suffix: normalizeScannerFraming(settings.barcode_scanner_suffix),
    barcode_scanner_sound_enabled: toBool(settings.barcode_scanner_sound_enabled, true),
    scanner_last_verified_at: settings.scanner_last_verified_at || null,
    scanner_last_terminator: stripControl(settings.scanner_last_terminator),
    scanner_last_character_count: Number.isFinite(Number(settings.scanner_last_character_count)) ? Number(settings.scanner_last_character_count) : null,
    scanner_last_average_inter_key_ms: Number.isFinite(Number(settings.scanner_last_average_inter_key_ms)) ? Number(settings.scanner_last_average_inter_key_ms) : null,
    customer_display_enabled: toBool(settings.customer_display_enabled, false),
    updated_at: settings.updated_at || null
  };
}
