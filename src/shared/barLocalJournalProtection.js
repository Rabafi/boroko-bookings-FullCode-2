// @ts-check
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
/** @typedef {{isEncryptionAvailable(): boolean, encryptString(text: string): Buffer, decryptString(data: Buffer): string}} Storage */
/** @param {Storage} storage */
export function journalProtection(storage) {
  return {
    /** @param {string} text */
    encrypt(text) {
      if (!storage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable. Staff credentials were not saved or submitted.')
      return storage.encryptString(text).toString('base64')
    },
    /** @param {string} text */
    decrypt(text) {
      if (!storage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable. Keep the original journal and recover this Windows profile.')
      return storage.decryptString(Buffer.from(text, 'base64'))
    }
  }
}

/**
 * @param {Record<string, unknown>} record
 * @param {{encrypt(text: string): string, decrypt(text: string): string}|null} protection
 */
export function encodeJournalRecord(record, protection) {
  const envelope = record.envelope !== null && typeof record.envelope === 'object' && !Array.isArray(record.envelope)
    ? /** @type {Record<string, unknown>} */ (record.envelope) : null
  const payload = envelope?.payload ?? record.payload
  if (payload && typeof payload === 'object' && Object.hasOwn(payload, 'pin')) {
    if (!protection) throw new Error('OS-protected journal storage is required before creating staff. No command was submitted.')
    return JSON.stringify({ protected_journal_record: 1, operation_id: record.operation_id, encrypted_record: protection.encrypt(JSON.stringify(record)) })
  }
  return JSON.stringify(record)
}

/** @param {Record<string, unknown>} record */
export function hasJournalSecret(record) {
  const envelope = record.envelope !== null && typeof record.envelope === 'object' && !Array.isArray(record.envelope)
    ? /** @type {Record<string, unknown>} */ (record.envelope) : null
  const payload = envelope?.payload ?? record.payload
  return payload !== null && typeof payload === 'object' && Object.hasOwn(payload, 'pin')
}

/**
 * Publish an encrypted replacement only after all original records validated.
 * A failed encrypt/write leaves the original journal and operation IDs intact.
 * @param {string} filePath
 * @param {Record<string, unknown>[]} records
 * @param {{encrypt(text: string): string, decrypt(text: string): string}|null} protection
 */
export function protectExistingJournal(filePath, records, protection) {
  if (!protection) throw new Error('OS-protected storage is required to secure the existing operation journal. Keep its original file.')
  const text = records.map(record => encodeJournalRecord(record, protection)).join('\n') + '\n'
  const staging = `${filePath}.protect-${randomUUID()}`
  let fd
  try {
    fd = openSync(staging, 'wx', 0o600)
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(staging, filePath)
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(staging) } catch {}
  }
}

/**
 * @param {Record<string, unknown>} record
 * @param {{encrypt(text: string): string, decrypt(text: string): string}|null} protection
 * @returns {Record<string, unknown>}
 */
export function decodeJournalRecord(record, protection) {
  if (record.protected_journal_record !== 1) return record
  if (!protection || typeof record.encrypted_record !== 'string') throw new Error('The protected operation journal cannot be opened. Keep its original file and recover secure storage.')
  const decoded = /** @type {unknown} */ (JSON.parse(protection.decrypt(record.encrypted_record)))
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('The protected journal record is invalid.')
  const value = /** @type {Record<string, unknown>} */ (decoded)
  if (value.operation_id !== record.operation_id) throw new Error('The protected journal record has an invalid operation identity.')
  return value
}
