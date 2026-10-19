// @ts-check
import fs from 'fs';
import path from 'path';

/**
 * Ensure a directory exists, creating it recursively when missing.
 * Falsy input is a no-op; throws propagate to the caller.
 *
 * @param {import('fs').PathLike | null | undefined} [dirPath]
 * @returns {void}
 */
export function ensureDir(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Read and parse a JSON file. There is no schema validation: a shaped
 * fallback does NOT establish the shape of successfully parsed data, so the
 * result is always unknown and callers must narrow before use. On read or
 * parse failure the caller's fallback is returned unchanged.
 *
 * @param {import('fs').PathOrFileDescriptor} filePath
 * @param {unknown} [fallback]
 * @returns {unknown}
 */
export function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

/**
 * Write a value as indented JSON (2 spaces, utf-8) after ensuring the parent
 * directory exists. Arbitrary values are not guaranteed serializable and
 * failures throw to the caller.
 *
 * @param {string} filePath
 * @param {unknown} value
 * @returns {void}
 */
export function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}
