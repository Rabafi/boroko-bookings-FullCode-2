import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { state } from '../state.js';

export const LOCAL_TIME_ZONE = 'Africa/Gaborone';
export const CRITICAL_ERROR_LOG_FILE = 'critical-errors.json';

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
  return scope === 'booking.refund' &&
  /Refund approvals require an internet connection/i.test(message);
}

export function recordCriticalError(scope, error, details = {}, { limit = 300, level = 'error' } = {}) {
  const message = error?.message || String(error || 'Unknown error');
  if (isNonCriticalOperationalError(scope, message)) return null;
  const row = {
    id: randomUUID(),
    at: new Date().toISOString(),
    scope,
    level,
    message,
    user_id: state.currentUser?.id || null,
    user_name: state.currentUser?.name || null,
    lodge_id: state.lodgeId || null,
    details
  };
  appendAuxiliaryLog(CRITICAL_ERROR_LOG_FILE, row, limit);
  const logger = level === 'warn' ? console.warn : console.error;
  logger(`[APP ${scope}]`, message, details);
  return row;
}
