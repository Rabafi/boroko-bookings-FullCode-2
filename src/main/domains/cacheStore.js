import fs from 'fs';
import path from 'path';
import { state } from '../state.js';
import { appendHealthFault } from './syncStore.js';

const CACHE_FRESHNESS_FILE = 'cache-freshness.json';

export const DEBUG_CACHE_FALLBACKS = process.env.BOROKO_DEBUG_CACHE_FALLBACKS === 'true';

function getCachePath(name) {
  return path.join(state.cacheDir, `${name}.json`);
}

export function readCache(name) {
  const filePath = getCachePath(name);
  const tmpPath = filePath + '.tmp';
  // Crash recovery: if a .tmp file exists, it was written atomically just before
  // a crash-interrupted renameSync. Prefer it over the potentially stale main file.
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
      fs.renameSync(tmpPath, filePath);
      console.warn(`[Cache] Crash-recovery: promoted '${name}.tmp' to main file`);
      return tmpData;
    } catch {
      // .tmp is corrupt — discard it and fall through to main file
      try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
    }
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    if (fs.existsSync(filePath)) {
      console.warn(`[Cache] Parse failed for '${name}' — returning []. Error: ${e.message}`);
      appendHealthFault({
        type: 'cache_corrupt',
        scope: name,
        message: `Cache file '${name}.json' could not be parsed and was reset to empty. Error: ${e.message}`,
        at: new Date().toISOString()
      });
    }
    return [];
  }
}

export function writeCache(name, data, { source = 'local' } = {}) {
  const filePath = getCachePath(name);
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error(`[Cache] Write failed for '${name}':`, e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
  }
  // Track freshness metadata for each named cache write
  try {
    const freshnessPath = path.join(state.cacheDir, CACHE_FRESHNESS_FILE);
    let freshness = {};
    try {freshness = JSON.parse(fs.readFileSync(freshnessPath, 'utf-8')) || {};} catch {/* start fresh */}
    freshness[name] = {
      updatedAt: new Date().toISOString(),
      source,
      count: Array.isArray(data) ? data.length : data && typeof data === 'object' ? Object.keys(data).length : 0
    };
    fs.writeFileSync(freshnessPath, JSON.stringify(freshness, null, 2), 'utf-8');
  } catch {/* freshness tracking is non-critical */}
}

export function clearCache(name, fallback = []) {
  writeCache(name, fallback);
}

// ─── Request deduplication ───────────────────────────────────────────────────
// If two callers request the same key while a promise is already in-flight,
// the second caller waits for the first result instead of firing a duplicate.

const inFlightPromises = new Map();

export function dedupePromise(key, factory) {
  const existing = inFlightPromises.get(key);
  if (existing) return existing;
  const promise = factory().finally(() => {
    inFlightPromises.delete(key);
  });
  inFlightPromises.set(key, promise);
  return promise;
}
