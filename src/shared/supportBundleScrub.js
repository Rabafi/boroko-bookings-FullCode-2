/**
 * Support-bundle scrubbing (shared, dependency-free).
 *
 * Two layers:
 * 1. scrubSupportBundleValue — deep key/context-aware redaction. Secrets,
 *    private payroll/bank material, and customer/guest PII are replaced
 *    before a bundle leaves the device. Operator identity and record IDs
 *    stay intact so support can still locate the affected rows.
 * 2. shapeSupportBundle — minimal allowlisted export schema. Unknown
 *    top-level sections are dropped, nested bodies are reduced to IDs,
 *    counts, codes, and sanitized short strings, and free-text logs are
 *    sanitized (never trusted verbatim).
 *
 * Broad patterns alone cannot guarantee privacy; the allowlist bounds what
 * can leak even when a new field appears upstream. Retained vs removed
 * information is documented on shapeSupportBundle below.
 */

const SECRET_KEY_PATTERN = /pin|password|passwd|secret|token|authorization|api[-_]?key|card|ccv|cvv|cvc|private[-_]?key|passphrase|otp|nonce/i;
const PAYROLL_KEY_PATTERN = /salary|wage|payroll.*(amount|net|gross|pay)|bank[-_]?account[-_]?number|account[-_]?number|\biban\b|\bswift\b|sort[-_ ]?code/i;
const CUSTOMER_KEY_PATTERN = /^(customer|guest)[-_ ]?(name|email|phone|address|id[-_ ]?(number|photo)?|passport)$|^(email|phone|id[-_ ]?number|passport)$/i;
const BEARER_PATTERN = /(Bearer\s+[A-Za-z0-9\-._~+/=]{8,}|x-boroko-session["':\s]+[A-Za-z0-9\-._~+/=]{8,})/gi;

// PII record context: inside these subtrees, name/address/contact keys are
// redacted even when the key alone looks innocent (name, address, ...).
const PII_CONTEXT_PATTERN = /customer|guest|passenger|patient|contact|profile|employee|staff|payroll|payment|billing|invoice|booking|folio|reservation|\border\b/i;
// Bare `*_id` record identifiers always survive: support needs them to
// locate rows, and national IDs are labeled id_number/passport instead.
const PII_SUBKEY_PATTERN = /^(.*[_-])?(name|names|address|email|phone|mobile|tel|dob|birth|passport|photo|nationality|id[-_ ]?(number|no|doc|document|card))$/i;
const PAYROLL_SUBKEY_PATTERN = /^(.*[_-])?(gross|net|salary|wage|pay|overtime|bonus|deduction|iban|account)$/i;

// Free-text secrets: labeled credentials, emails, and token assignments in
// URLs or log lines. Labeled card/bank references are redacted with their
// value; bare numbers are left alone (amounts and IDs must survive).
const FREE_TEXT_PATTERNS = [
  /(\bpin\s*[:=]\s*)\S+/gi,
  /(\bpassword\s*[:=]\s*)\S+/gi,
  /(\b(passwd|passphrase|secret|otp)\s*[:=]\s*)\S+/gi,
  /((?:api[_-]?key|access[_-]?token|client[_-]?secret|session[_-]?token)\s*[:=]\s*)\S+/gi,
  /((?:card|ccv|cvv|cvc|iban|account)\s*[:=]?\s*)[A-Za-z0-9][A-Za-z0-9\s-]{7,}/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
];

const MAX_STRING_LENGTH = 8192;
const MAX_DEPTH = 12;

export function sanitizeSupportText(value) {
  if (typeof value !== 'string') return value;
  let next = value;
  for (const pattern of FREE_TEXT_PATTERNS) {
    pattern.lastIndex = 0;
    // NOTE: patterns without a capture group receive the numeric match
    // offset as the second replacer argument — only a string is a label.
    next = next.replace(pattern, (match, label) => (typeof label === 'string' && label ? `${label}[REDACTED]` : '[REDACTED]'));
  }
  patternReset();
  if (next.length > MAX_STRING_LENGTH) {
    return `${next.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED ${next.length - MAX_STRING_LENGTH} chars omitted]`;
  }
  return next;
}

function patternReset() {
  for (const pattern of FREE_TEXT_PATTERNS) pattern.lastIndex = 0;
}

function isBinary(value) {
  return (
    (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) ||
    (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) ||
    (typeof DataView !== 'undefined' && value instanceof DataView)
  );
}

export function scrubSupportBundleValue(value, depth = 0, context = null, seen = null) {
  const active = seen || new WeakSet();
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') {
    return sanitizeSupportText(value.replace(BEARER_PATTERN, '[REDACTED]'));
  }
  if (isBinary(value)) return '[BINARY omitted]';
  if (Array.isArray(value)) {
    if (active.has(value)) return '[CYCLE omitted]';
    active.add(value);
    return value.map((entry) => scrubSupportBundleValue(entry, depth + 1, context, active));
  }
  if (value && typeof value === 'object') {
    if (active.has(value)) return '[CYCLE omitted]';
    active.add(value);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (SECRET_KEY_PATTERN.test(key) || PAYROLL_KEY_PATTERN.test(key) || CUSTOMER_KEY_PATTERN.test(key)) {
        return [key, '[REDACTED]'];
      }
      const childContext = PII_CONTEXT_PATTERN.test(key) ? key : context;
      if (childContext || PII_CONTEXT_PATTERN.test(key)) {
        if (PII_SUBKEY_PATTERN.test(key) || PAYROLL_SUBKEY_PATTERN.test(key)) {
          return [key, '[REDACTED]'];
        }
      }
      return [key, scrubSupportBundleValue(entry, depth + 1, childContext, active)];
    }));
  }
  return value;
}

// Safe short-string keys retained inside shaped record bodies (values are
// still sanitized). Everything else that is a non-empty string is dropped
// to keep raw free-text bodies out of the bundle by default.
const RETAINED_STRING_KEYS = new Set([
  'code', 'status', 'state', 'type', 'action', 'scope', 'category', 'level',
  'trigger_source', 'reason', 'description', 'message', 'summary', 'error',
  'lastError', 'note', 'table', 'route', 'feature', 'invoice_number', 'reference'
]);
const MAX_RETAINED_STRING = 280;

function shapeRecord(value, depth = 0, seen = null, context = null) {
  const active = seen || new WeakSet();
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'string') {
    const clean = sanitizeSupportText(value);
    return clean.length > MAX_RETAINED_STRING ? `${clean.slice(0, MAX_RETAINED_STRING)}…[TRUNCATED]` : clean;
  }
  if (depth > 6 || active.has(value)) return '[OMITTED]';
  if (isBinary(value)) return '[BINARY omitted]';
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => shapeRecord(entry, depth + 1, active, context));
  if (typeof value !== 'object') return '[OMITTED]';
  active.add(value);
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key) || PAYROLL_KEY_PATTERN.test(key) || CUSTOMER_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    // PII context flows downward: once inside a customer/payroll/payment
    // subtree, name/address/contact/pay-figure keys are redacted even when
    // the bare key looks innocent.
    const keyStartsContext = PII_CONTEXT_PATTERN.test(key);
    const inContext = context !== null || keyStartsContext;
    if (inContext && (PII_SUBKEY_PATTERN.test(key) || PAYROLL_SUBKEY_PATTERN.test(key))) {
      out[key] = '[REDACTED]';
      continue;
    }
    const childContext = keyStartsContext ? key : context;
    if (entry === null || entry === undefined || typeof entry === 'number' || typeof entry === 'boolean') {
      out[key] = Number.isFinite(entry) ? entry : entry;
      continue;
    }
    if (typeof entry === 'string') {
      if (/id$|_id$|^id$/i.test(key) || /_at$|date/i.test(key) || RETAINED_STRING_KEYS.has(key)) {
        const clean = sanitizeSupportText(entry);
        out[key] = clean.length > MAX_RETAINED_STRING ? `${clean.slice(0, MAX_RETAINED_STRING)}…[TRUNCATED]` : clean;
      }
      // Any other free-text string is omitted, not trusted.
      continue;
    }
    if (Array.isArray(entry)) {
      out[key] = entry.slice(0, 50).map((item) => shapeRecord(item, depth + 1, active, childContext));
      if (entry.length > 50) out[`${key}_omitted_count`] = entry.length - 50;
      continue;
    }
    if (typeof entry === 'object') {
      out[key] = shapeRecord(entry, depth + 1, active, childContext);
      continue;
    }
  }
  return out;
}

function shapeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
}

/**
 * Minimal allowlisted export schema.
 *
 * Retained: product/version identity, timestamps, lodge and operator IDs,
 * pending/failed operation counts, per-section summaries, record IDs,
 * numeric amounts, codes/states, and sanitized short diagnostics.
 *
 * Intentionally removed: unknown top-level sections; raw request/response
 * and queue payload bodies; PINs/tokens/passwords/card material anywhere
 * (keys, nested PII contexts, and free text); private payroll figures and
 * bank numbers; customer/guest names, addresses, emails, phones, and
 * documents; unsanitized free-text logs; binary attachments; cycles.
 *
 * Operator user_name is retained (staff identity support needs to contact
 * the right operator); customer identity is never retained.
 */
export function shapeSupportBundle(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { generated_at: new Date().toISOString(), shape: 'empty' };
  const pending = raw.pending_operations && typeof raw.pending_operations === 'object' ? raw.pending_operations : {};
  const shaped = {
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : new Date().toISOString(),
    product: typeof raw.product === 'string' ? raw.product : 'unknown',
    app_version: typeof raw.app_version === 'string' ? raw.app_version : 'unknown',
    lodge_id: raw.lodge_id || null,
    user_id: raw.user_id || null,
    user_name: typeof raw.user_name === 'string' ? sanitizeSupportText(raw.user_name).slice(0, 120) : null,
    app_online: raw.app_online === true,
    pending_operations: {
      pending: shapeCount(pending.pending),
      failed: shapeCount(pending.failed)
    }
  };
  const sections = [
    'system_health', 'sync_status', 'sync_details', 'syncMeta', 'healthFaults',
    'financial_reconciliation', 'financial_validation',
    'financial_validation_runs', 'financial_validation_alerts', 'critical_errors'
  ];
  for (const section of sections) {
    if (raw[section] === undefined) continue;
    shaped[section] = shapeRecord(raw[section]);
  }
  return shaped;
}
