/**
 * Keyboard-wedge barcode scanner decoding.
 *
 * Most USB/Bluetooth scanners expose themselves as a keyboard.  This module
 * intentionally has no DOM dependencies so Till, stock setup and Legacy POS
 * can use the same normalization and timing contract.
 */

export const BARCODE_SCANNER_DEFAULTS = Object.freeze({
  minLength: 4,
  maxLength: 128,
  interKeyMs: 120,
  idleCompleteMs: 180,
  prefix: "",
  suffix: "",
  acceptEnter: true,
  acceptTab: true,
});

const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

export function normalizeBarcode(value, options = {}) {
  const maxLength = Math.max(1, Math.min(128, Number(options.maxLength || BARCODE_SCANNER_DEFAULTS.maxLength)));
  const prefix = String(options.prefix || "");
  const suffix = String(options.suffix || "");
  let barcode = String(value ?? "").trim();
  if (prefix && barcode.startsWith(prefix)) barcode = barcode.slice(prefix.length);
  if (suffix && barcode.endsWith(suffix)) barcode = barcode.slice(0, -suffix.length);
  barcode = barcode.trim();
  if (!barcode || barcode.length > maxLength || CONTROL_CHARACTER_RE.test(barcode)) return null;
  return barcode;
}

function makeFailure(code, extras = {}) {
  return { success: false, code, ...extras };
}

function makeScanResult(raw, terminator, startedAt, completedAt, options) {
  const barcode = normalizeBarcode(raw, options);
  if (!barcode) return makeFailure("empty_scan");
  if (barcode.length < Number(options.minLength)) {
    return makeFailure("scan_too_short", { barcode, characterCount: barcode.length });
  }
  const durationMs = Math.max(0, completedAt - startedAt);
  return {
    success: true,
    barcode,
    terminator,
    characterCount: barcode.length,
    durationMs,
    averageInterKeyMs: barcode.length > 1 ? durationMs / (barcode.length - 1) : durationMs,
  };
}

/**
 * Create an incremental scanner decoder.
 *
 * consumeKey accepts a KeyboardEvent-like object ({key, repeat, timeStamp})
 * and returns a small event object.  A caller may call flush() after the idle
 * completion timeout when its scanner has no suffix configured.
 */
export function createBarcodeScannerDecoder(config = {}) {
  const configuredMin = Math.max(1, Math.min(128, Number(config.minLength ?? BARCODE_SCANNER_DEFAULTS.minLength) || BARCODE_SCANNER_DEFAULTS.minLength));
  const configuredMax = Math.max(configuredMin, Math.min(128, Number(config.maxLength ?? BARCODE_SCANNER_DEFAULTS.maxLength) || BARCODE_SCANNER_DEFAULTS.maxLength));
  const options = {
    ...BARCODE_SCANNER_DEFAULTS,
    ...config,
    minLength: configuredMin,
    maxLength: configuredMax,
  };
  let buffer = "";
  let startedAt = 0;
  let lastAt = 0;

  const reset = () => {
    buffer = "";
    startedAt = 0;
    lastAt = 0;
  };

  const nowFrom = (event) => {
    const candidate = Number(event?.timeStamp);
    return Number.isFinite(candidate) && candidate >= 0 ? candidate : Date.now();
  };

  const flush = (terminator = "idle") => {
    if (!buffer) return { type: "ignored" };
    const completedAt = lastAt || Date.now();
    const result = makeScanResult(buffer, terminator, startedAt || completedAt, completedAt, options);
    const rawLength = buffer.length;
    reset();
    if (!result.success && result.code === "empty_scan") return { type: "ignored" };
    return { type: "completed", result: { ...result, rawLength } };
  };

  const consumeKey = (event = {}) => {
    const key = String(event.key || "");
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
      return { type: "ignored" };
    }
    const at = nowFrom(event);
    if (buffer && lastAt && at - lastAt > Number(options.interKeyMs)) {
      reset();
      // The key belongs to a new scan; continue below.
    }
    const isEnter = key === "Enter" || key === "NumpadEnter";
    const isTab = key === "Tab";
    if ((isEnter && options.acceptEnter) || (isTab && options.acceptTab)) {
      return flush(isEnter ? "Enter" : "Tab");
    }
    if (key.length !== 1 || CONTROL_CHARACTER_RE.test(key)) return { type: "ignored" };
    if (!buffer) startedAt = at;
    if (buffer.length >= Number(options.maxLength)) {
      reset();
      return { type: "completed", result: makeFailure("scan_too_long") };
    }
    buffer += key;
    lastAt = at;
    return { type: "buffered", length: buffer.length, barcode: buffer };
  };

  return {
    consumeKey,
    flush,
    reset,
    getBuffer: () => buffer,
    getOptions: () => ({ ...options }),
  };
}

export function isScannerEditableTarget(target, searchElement = null) {
  if (!target) return false;
  if (searchElement && target === searchElement) return true;
  const tag = String(target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}
