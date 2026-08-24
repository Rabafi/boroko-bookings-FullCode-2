import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { state } from '../state.js';

export const LOCAL_TIME_ZONE = 'Africa/Gaborone';
export const CRITICAL_ERROR_LOG_FILE = 'critical-errors.json';
export const CRITICAL_ERROR_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const MAX_INCIDENT_MESSAGE_LENGTH = 1200;
const MAX_INCIDENT_STRING_LENGTH = 500;
const MAX_INCIDENT_KEYS = 40;
const MAX_INCIDENT_ARRAY_ITEMS = 20;
const MAX_INCIDENT_DEPTH = 4;

const SENSITIVE_KEY_PATTERN = /(password|passphrase|token|secret|authorization|api[-_]?key|private[-_]?key|credential|cookie|nonce|pin|hash)/i;

function redactIncidentText(value, maxLength = MAX_INCIDENT_STRING_LENGTH) {
  const text = String(value ?? '');
  const redacted = text
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|passphrase|token|secret|authorization|api[-_]?key|private[-_]?key|credential|cookie|nonce|pin|hash)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

function sanitizeIncidentValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactIncidentText(value);
  if (depth >= MAX_INCIDENT_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_INCIDENT_ARRAY_ITEMS).map((entry) => sanitizeIncidentValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort().slice(0, MAX_INCIDENT_KEYS)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : sanitizeIncidentValue(value[key], depth + 1);
    }
    return output;
  }
  return redactIncidentText(value);
}

function stableIncidentJson(value) {
  return JSON.stringify(sanitizeIncidentValue(value));
}

function buildIncidentFingerprint({ scope, level, message, details }) {
  return createHash('sha256')
    .update(`${scope}\n${level}\n${message}\n${stableIncidentJson(details)}`)
    .digest('hex');
}

export function getLocalDateKey(value = new Date(), timeZone = LOCAL_TIME_ZONE) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(value);
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

export function readAuxiliaryLog(filename) {
  try {
    if (!state.cacheDir) return [];
    const fullPath = path.join(state.cacheDir, filename);
    if (!fs.existsSync(fullPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeAuxiliaryLog(filename, rows) {
  try {
    if (!state.cacheDir) return;
    fs.writeFileSync(path.join(state.cacheDir, filename), JSON.stringify(rows, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Auxiliary log write failed (${filename}):`, error);
  }
}

export function appendAuxiliaryLog(filename, row, limit = 200) {
  const current = readAuxiliaryLog(filename);
  current.unshift(row);
  writeAuxiliaryLog(filename, current.slice(0, limit));
}

export function isNonCriticalOperationalError(scope, errorOrMessage = '') {
  const message = errorOrMessage?.message || String(errorOrMessage || '');
  const s = String(scope || '').toLowerCase();

  // Report RPC fallbacks degrade to local computation — not critical
  if (s.startsWith('reports.') && s.endsWith('.local')) return false;
  if (/^reports\./.test(s)) return true;

  // Customer credit reads degrade gracefully — not critical
  if (/^customercredit\.(getBalance|getHistory|getSummary)$/.test(s)) return true;

  // Financial validation warnings degrade gracefully — not critical
  if (/^financial\.(reconciliation\.timeout|validation\.audit_timeout|validation\.alerts)$/.test(s)) return true;

  // Report export RPC failures are informational — not critical
  if (/^reportexport\./.test(s)) return true;

  // ── Validation errors the system intentionally blocked ──────────────────
  // If the action was prevented, there is nothing to correct.

  // Missing required fields
  if (/(?:is required|is mandatory)/i.test(message)) return true;

  // Invalid input values
  if (/Invalid (?:date format|total|approval PIN|overpayment_action)/i.test(message)) return true;
  if (/must be (?:greater than|negative)/i.test(message)) return true;
  if (/must be at least one night/i.test(message)) return true;
  if (/cannot exceed total/i.test(message)) return true;
  if (/would result in a negative/i.test(message)) return true;
  if (/leaves nothing to refund/i.test(message)) return true;

  // Date/time validation
  if (/Check-in and check-out dates are required/i.test(message)) return true;
  if (/Check-out must be after check-in/i.test(message)) return true;
  if (/Cannot check in before/i.test(message)) return true;

  // Room conflicts — system blocked the double-booking
  if (/Room (?:is )?already booked/i.test(message)) return true;
  if (/This room is already booked/i.test(message)) return true;
  if (/fully reserved for an exclusive event/i.test(message)) return true;
  if (/No rooms available/i.test(message)) return true;
  if (/No rooms are available/i.test(message)) return true;
  if (/all rooms are under maintenance/i.test(message)) return true;
  if (/Selected room is under maintenance/i.test(message)) return true;

  // Booking state validation
  if (/Cannot (?:transition|reschedule) booking/i.test(message)) return true;
  if (/Cannot check out/i.test(message)) return true;
  if (/not (?:found|available)/i.test(message) && !/Supabase|database|RPC/i.test(message)) return true;
  if (/exceeds room maximum occupancy/i.test(message)) return true;

  // Refund validation
  if (/Refund approvals require an internet connection/i.test(message)) return true;
  if (/Refunds are not allowed while guest is checked in/i.test(message)) return true;
  if (/no paid amount available to refund/i.test(message)) return true;
  if (/unauthorized approver|Invalid approval PIN/i.test(message)) return true;
  if (/Proof reference is required/i.test(message)) return true;
  if (/Manager\/Admin approval PIN is required/i.test(message)) return true;

  // Reschedule validation
  if (/Reschedule creates an overpayment/i.test(message)) return true;
  if (/modified on another device/i.test(message)) return true;
  if (/overpayment_action must be/i.test(message)) return true;

  // Quotation validation
  if (/quotation has already been converted/i.test(message)) return true;
  if (/Quotation must be sent or accepted/i.test(message)) return true;
  if (/quotation details are incomplete/i.test(message)) return true;

  // Offline requirement blocks
  if (/requires an internet connection/i.test(message)) return true;
  if (/No internet connection/i.test(message)) return true;
  if (/Connect to the internet/i.test(message)) return true;

  // POS validation
  if (/shift_id is mandatory/i.test(message)) return true;
  if (/catalog_snapshot_id is mandatory/i.test(message)) return true;
  if (/No catalog snapshot/i.test(message)) return true;
  if (/Folio charge requires an active booking/i.test(message)) return true;
  if (/not found locally\. Sync/i.test(message)) return true;

  // Deposit warnings (booking created but deposit failed — user action needed, not system issue)
  if (/depositWarning|DEPOSIT_FAILED/i.test(message)) return true;

  return false;
}

export function recordCriticalError(scope, error, details = {}, { limit = 300, level = 'error' } = {}) {
  const safeScope = redactIncidentText(scope, 160);
  const safeLevel = level === 'warn' ? 'warn' : 'error';
  const message = redactIncidentText(error?.message || String(error || 'Unknown error'), MAX_INCIDENT_MESSAGE_LENGTH);
  if (isNonCriticalOperationalError(scope, message)) return null;
  const safeDetails = sanitizeIncidentValue(details);
  const fingerprint = buildIncidentFingerprint({
    scope: safeScope,
    level: safeLevel,
    message,
    details: safeDetails
  });
  const now = Date.now();
  const existing = readAuxiliaryLog(CRITICAL_ERROR_LOG_FILE).find((row) => {
    if (row?.fingerprint !== fingerprint) return false;
    const at = new Date(row.at || 0).getTime();
    return Number.isFinite(at) && now - at >= 0 && now - at < CRITICAL_ERROR_DEDUPE_WINDOW_MS;
  });
  if (existing) return null;

  const row = {
    id: randomUUID(),
    at: new Date().toISOString(),
    scope: safeScope,
    level: safeLevel,
    message,
    fingerprint,
    user_id: state.currentUser?.id || null,
    user_name: state.currentUser?.name ? redactIncidentText(state.currentUser.name, 240) : null,
    lodge_id: state.lodgeId ? redactIncidentText(state.lodgeId, 160) : null,
    details: safeDetails
  };
  appendAuxiliaryLog(CRITICAL_ERROR_LOG_FILE, row, limit);
  const logger = safeLevel === 'warn' ? console.warn : console.error;
  logger(`[APP ${safeScope}]`, message, safeDetails);
  return row;
}

export function logActivity(action, description) {
  try {
    const logPath = path.join(state.cacheDir, 'activity-log.json');
    let log = [];
    try {log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));} catch {/* empty */}

    log.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      action,
      description,
      user_id: state.currentUser?.id || null,
      user_name: state.currentUser?.name || 'System'
    });

    if (log.length > 500) log = log.slice(0, 500);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
  } catch (e) {
    console.error('Activity log write failed:', e);
  }
}
