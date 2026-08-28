import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { decryptBackupFile } from './backup-crypto.mjs'

const REQUIRED_FILES = Object.freeze(['roles.sql', 'schema.sql', 'data.sql', 'metadata.json', 'SHA256SUMS'])
const REQUIRED_CHECKSUM_FILES = Object.freeze(['roles.sql', 'schema.sql', 'data.sql', 'metadata.json'])
const MAX_ENCRYPTED_BYTES = 512 * 1024 * 1024
const MAX_DECOMPRESSED_BYTES = 1024 * 1024 * 1024
const TAR_BLOCK_BYTES = 512

function requireValue(value, label) {
  if (!value) throw new Error(`${label} is required.`)
  return value
}

function normalizeArchiveName(value) {
  const name = String(value || '').replaceAll('\\', '/')
  if (!name || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:\//.test(name)) {
    throw new Error('Backup archive contains an unsafe path.')
  }
  const parts = name.split('/').filter(Boolean)
  if (parts.some((part) => part === '..')) throw new Error('Backup archive contains an unsafe path.')
  const normalized = parts.filter((part) => part !== '.').join('/')
  if (!normalized) return ''
  return normalized
}

function parseTarNumber(field, label) {
  const bytes = Buffer.from(field)
  const text = bytes.toString('ascii').replace(/\0.*$/, '').trim()
  if (!text) return 0
  // GNU tar may use a base-256 number for values that do not fit in octal.
  if ((bytes[0] & 0x80) !== 0) {
    let result = BigInt(bytes[0] & 0x7f)
    for (let index = 1; index < bytes.length; index += 1) result = (result << 8n) | BigInt(bytes[index])
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is too large.`)
    return Number(result)
  }
  if (!/^[0-7]+$/.test(text)) throw new Error(`${label} is invalid.`)
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is too large.`)
  return value
}

function tarHeaderChecksum(header) {
  const copy = Buffer.from(header)
  copy.fill(0x20, 148, 156)
  let sum = 0
  for (const byte of copy) sum += byte
  return sum
}

function isZeroBlock(block) {
  for (const byte of block) if (byte !== 0) return false
  return true
}

function readTarString(header, start, length) {
  return header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '')
}

function parseTarArchive(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < TAR_BLOCK_BYTES * 3) {
    throw new Error('Backup archive is truncated.')
  }
  const entries = new Map()
  let offset = 0
  let ended = false
  while (offset + TAR_BLOCK_BYTES <= bytes.length) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_BYTES)
    if (isZeroBlock(header)) {
      const next = bytes.subarray(offset + TAR_BLOCK_BYTES, offset + TAR_BLOCK_BYTES * 2)
      if (next.length < TAR_BLOCK_BYTES || !isZeroBlock(next)) throw new Error('Backup archive has an invalid tar end marker.')
      const trailing = bytes.subarray(offset + TAR_BLOCK_BYTES * 2)
      if (trailing.some((byte) => byte !== 0)) throw new Error('Backup archive has unexpected trailing bytes.')
      ended = true
      break
    }

    const name = normalizeArchiveName(readTarString(header, 0, 100))
    const expectedChecksum = parseTarNumber(header.subarray(148, 156), 'Tar header checksum')
    if (tarHeaderChecksum(header) !== expectedChecksum) throw new Error(`Backup archive checksum failed for ${name}.`)
    const size = parseTarNumber(header.subarray(124, 136), `Tar entry size for ${name}`)
    if (size > MAX_DECOMPRESSED_BYTES || offset + TAR_BLOCK_BYTES + size > bytes.length) {
      throw new Error(`Backup archive entry is truncated or too large: ${name}.`)
    }
    const type = header[156] || 0x30
    if (type !== 0 && type !== 0x30 && type !== 0x35) {
      throw new Error(`Backup archive contains an unsupported entry type: ${name}.`)
    }
    // `tar -C <directory> ... .` emits a harmless root `./` directory entry.
    // It has no restore payload and is intentionally not represented as a
    // named archive entry.
    if (!name) {
      if (type !== 0x35 || size !== 0) throw new Error('Backup archive contains an unnamed entry.')
      const contentStart = offset + TAR_BLOCK_BYTES
      offset = contentStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
      continue
    }
    if (entries.has(name)) throw new Error(`Backup archive contains a duplicate entry: ${name}.`)
    const contentStart = offset + TAR_BLOCK_BYTES
    const content = bytes.subarray(contentStart, contentStart + size)
    entries.set(name, { name, type: type === 0x35 ? 'directory' : 'file', size, content })
    const blocks = Math.ceil(size / TAR_BLOCK_BYTES)
    offset = contentStart + blocks * TAR_BLOCK_BYTES
  }
  if (!ended) throw new Error('Backup archive is missing its tar end marker.')
  return entries
}

function safeEqualHex(left, right) {
  const a = Buffer.from(String(left || '').toLowerCase(), 'utf8')
  const b = Buffer.from(String(right || '').toLowerCase(), 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseChecksumManifest(bytes, entries) {
  const text = bytes.toString('utf8')
  if (text.includes('\0')) throw new Error('SHA256SUMS is not valid text.')
  const checksums = new Map()
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
  if (!lines.length) throw new Error('SHA256SUMS is empty.')
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})\s+([* ]?)(.+)$/i)
    if (!match) throw new Error('SHA256SUMS contains an invalid line.')
    const name = normalizeArchiveName(match[3].trim())
    if (!name || entries.get(name)?.type !== 'file') throw new Error(`SHA256SUMS references a missing file: ${name || '[empty]'}.`)
    if (checksums.has(name)) throw new Error(`SHA256SUMS contains a duplicate entry: ${name}.`)
    checksums.set(name, match[1].toLowerCase())
  }
  return checksums
}

function parseAndValidateMetadata(entry, entries, checksums) {
  let metadata
  try {
    metadata = JSON.parse(entry.content.toString('utf8'))
  } catch {
    throw new Error('metadata.json is not valid JSON.')
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata.json must contain an object.')
  if (metadata.format_version !== 1) throw new Error('metadata.json has an unsupported format_version.')
  if (typeof metadata.created_at !== 'string' || !Number.isFinite(Date.parse(metadata.created_at))) throw new Error('metadata.json has an invalid created_at.')
  for (const field of ['repository', 'commit']) {
    if (typeof metadata[field] !== 'string' || !metadata[field].trim()) throw new Error(`metadata.json is missing ${field}.`)
  }
  const hasRunId = Object.hasOwn(metadata, 'run_id')
  const hasLegacyRunId = Object.hasOwn(metadata, 'github_run_id')
  if (hasRunId && (typeof metadata.run_id !== 'string' || !metadata.run_id.trim())) {
    throw new Error('metadata.json run_id is invalid.')
  }
  if (hasLegacyRunId && (typeof metadata.github_run_id !== 'string' || !metadata.github_run_id.trim())) {
    throw new Error('metadata.json github_run_id is invalid.')
  }
  if (!hasRunId && !hasLegacyRunId) throw new Error('metadata.json is missing run_id.')
  if (hasRunId && hasLegacyRunId && metadata.run_id !== metadata.github_run_id) {
    throw new Error('metadata.json run_id conflicts with github_run_id.')
  }
  // v1 archives created before the canonical field was named `run_id` used
  // `github_run_id`. Accept that exact legacy shape, but normalize all
  // verifier output to the canonical field so callers have one contract.
  const runId = metadata.run_id || metadata.github_run_id
  if (!Array.isArray(metadata.contents) || !metadata.contents.length) throw new Error('metadata.json contents must be a non-empty array.')
  const contents = metadata.contents.map((name) => normalizeArchiveName(name))
  if (new Set(contents).size !== contents.length) throw new Error('metadata.json contents contains duplicates.')
  for (const name of contents) {
    if (entries.get(name)?.type !== 'file') throw new Error(`metadata.json references a missing file: ${name}.`)
    if (!checksums.has(name)) throw new Error(`SHA256SUMS is missing the manifest entry for ${name}.`)
  }
  return {
    format_version: metadata.format_version,
    created_at: metadata.created_at,
    repository: metadata.repository,
    commit: metadata.commit,
    run_id: runId,
    contents
  }
}

function verifyPlainArchiveBytes(bytes, options = {}) {
  const maxBytes = Number.isSafeInteger(options.maxDecompressedBytes) && options.maxDecompressedBytes > 0
    ? options.maxDecompressedBytes
    : MAX_DECOMPRESSED_BYTES
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Decrypted backup archive is empty.')
  if (bytes.length > maxBytes) throw new Error('Decrypted backup archive is too large to verify safely.')
  let tarBytes
  try {
    tarBytes = gunzipSync(bytes, { maxOutputLength: maxBytes })
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') throw new Error('Expanded backup archive is too large to verify safely.')
    throw new Error('Backup archive is not a valid gzip stream.')
  }
  if (tarBytes.length > maxBytes) throw new Error('Expanded backup archive is too large to verify safely.')
  const entries = parseTarArchive(tarBytes)
  for (const name of REQUIRED_FILES) {
    if (entries.get(name)?.type !== 'file') throw new Error(`Backup archive is missing ${name}.`)
  }
  for (const entry of entries.values()) {
    if (entry.type === 'file' && entry.size > maxBytes) throw new Error(`Backup archive file is too large: ${entry.name}.`)
  }
  const checksums = parseChecksumManifest(entries.get('SHA256SUMS').content, entries)
  for (const name of REQUIRED_CHECKSUM_FILES) {
    if (!checksums.has(name)) throw new Error(`SHA256SUMS is missing ${name}.`)
  }
  // Verify every manifest entry, not only the three legacy database files.
  // Whole-project bundles add Auth, Storage-schema, migration-history, and
  // inventory files; accepting a tampered extension would make the package
  // appear valid while silently losing its recovery evidence.
  for (const [name, expected] of checksums) {
    const actual = sha256(entries.get(name).content)
    if (!safeEqualHex(actual, expected)) throw new Error(`SHA-256 verification failed for ${name}.`)
  }
  const metadata = parseAndValidateMetadata(entries.get('metadata.json'), entries, checksums)
  const files = [...entries.values()]
    .filter((entry) => entry.type === 'file')
    .map((entry) => ({ name: entry.name, bytes: entry.size, sha256: sha256(entry.content) }))
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const name of ['roles.sql', 'schema.sql', 'data.sql']) {
    if (entries.get(name).size <= 0) throw new Error(`${name} is empty.`)
  }
  return {
    valid: true,
    metadata,
    files,
    checksums_verified: true,
    required_files: [...REQUIRED_FILES],
    archive_sha256: sha256(bytes),
    tar_sha256: sha256(tarBytes)
  }
}

async function readFileWithLimit(filePath, maxBytes, label) {
  const stats = await fs.stat(filePath)
  if (!stats.isFile()) throw new Error(`${label} is not a file.`)
  if (stats.size <= 0) throw new Error(`${label} is empty.`)
  if (stats.size > maxBytes) throw new Error(`${label} is too large to verify safely.`)
  return fs.readFile(filePath)
}

export async function verifySupabaseBackupArchive(archivePath, options = {}) {
  const target = requireValue(archivePath, 'Backup archive path')
  const bytes = options.bytes || await readFileWithLimit(target, options.maxDecompressedBytes || MAX_DECOMPRESSED_BYTES, 'Backup archive')
  const result = verifyPlainArchiveBytes(bytes, options)
  return { ...result, source_path: path.basename(target), source_bytes: bytes.length, encrypted: false }
}

export async function verifyEncryptedSupabaseBackup({ inputPath, privateKeyPem, passphrase, workDirectory, keepDecryptedArchive = false, ...options } = {}) {
  const source = requireValue(inputPath, 'Encrypted backup path')
  const encryptedStats = await fs.stat(source)
  if (!encryptedStats.isFile() || encryptedStats.size <= 0) throw new Error('Encrypted backup is not a non-empty file.')
  const maxEncryptedBytes = Number.isSafeInteger(options.maxEncryptedBytes) && options.maxEncryptedBytes > 0 ? options.maxEncryptedBytes : MAX_ENCRYPTED_BYTES
  if (encryptedStats.size > maxEncryptedBytes) throw new Error('Encrypted backup is too large to verify safely.')
  const temporaryRoot = workDirectory
    ? path.resolve(String(workDirectory))
    : await fs.mkdtemp(path.join(os.tmpdir(), 'tsa-bonno-backup-verify-'))
  await fs.mkdir(temporaryRoot, { recursive: true })
  // Use a unique path even when the caller supplies a work directory. This
  // prevents a failed attempt from deleting or overwriting a pre-existing
  // operator file with the conventional `database.tar.gz` name.
  const decryptedPath = path.join(temporaryRoot, `database-${randomUUID()}.tar.gz`)
  try {
    await decryptBackupFile({ inputPath: source, outputPath: decryptedPath, privateKeyPem, passphrase })
    const archive = await verifySupabaseBackupArchive(decryptedPath, options)
    return {
      ...archive,
      encrypted: true,
      source_path: path.basename(source),
      encrypted_bytes: encryptedStats.size,
      encrypted_sha256: sha256(await fs.readFile(source)),
      decrypted_archive_path: keepDecryptedArchive ? decryptedPath : undefined,
      verification_directory: keepDecryptedArchive ? temporaryRoot : undefined
    }
  } finally {
    if (!keepDecryptedArchive && !workDirectory) await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {})
    if (!keepDecryptedArchive && workDirectory) await fs.rm(decryptedPath, { force: true }).catch(() => {})
  }
}

export async function rehearseEncryptedSupabaseBackup(options = {}) {
  const verification = await verifyEncryptedSupabaseBackup(options)
  const report = {
    mode: 'encrypted-supabase-database-backup-rehearsal',
    rehearsal_only: true,
    restores_database: false,
    writes_database: false,
    writes_personal_data: false,
    checksums_verified: verification.checksums_verified === true,
    source_package: verification.source_path,
    encrypted_bytes: verification.encrypted_bytes,
    encrypted_sha256: verification.encrypted_sha256,
    archive_sha256: verification.archive_sha256,
    tar_sha256: verification.tar_sha256,
    metadata: verification.metadata,
    files: verification.files,
    required_files: verification.required_files,
    generated_at: new Date().toISOString(),
    next_step: 'Use the verified decrypted archive only with the official Supabase restore procedure against a newly created disposable project.'
  }
  if (options.reportPath) {
    const reportPath = path.resolve(String(options.reportPath))
    await fs.mkdir(path.dirname(reportPath), { recursive: true })
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
    report.report_path = reportPath
  }
  return report
}

function parseOptions(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const name = token.slice(2)
    const value = values[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}.`)
    result[name] = value
    index += 1
  }
  return result
}

function redactError(error, secrets = []) {
  let message = String(error?.message || 'Backup verification failed.')
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(String(secret), '[redacted]')
  }
  return message.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted-key]')
}

async function runCli() {
  const [command, ...rawOptions] = process.argv.slice(2)
  const options = parseOptions(rawOptions)
  const inputPath = requireValue(options.input, '--input')
  const privateKeyPath = requireValue(options['private-key'], '--private-key')
  const privateKeyPem = await fs.readFile(privateKeyPath, 'utf8')
  const passphrase = requireValue(process.env.TSA_BONNO_BACKUP_KEY_PASSPHRASE, 'TSA_BONNO_BACKUP_KEY_PASSPHRASE')
  if (command === 'verify') {
    const result = await verifyEncryptedSupabaseBackup({ inputPath, privateKeyPem, passphrase })
    console.log(`Encrypted Supabase backup verified: ${result.source_path} (${result.encrypted_bytes} bytes)`)
    console.log(`Archive SHA-256: ${result.archive_sha256}`)
    return
  }
  if (command === 'rehearse') {
    const result = await rehearseEncryptedSupabaseBackup({ inputPath, privateKeyPem, passphrase, reportPath: options.report })
    console.log(`Encrypted Supabase backup rehearsal passed: ${result.source_package}`)
    if (result.report_path) console.log(`Safe rehearsal report: ${result.report_path}`)
    return
  }
  throw new Error('Usage: verify-supabase-backup.mjs <verify|rehearse> --input <backup.tbbackup> --private-key <private.pem> [--report <report.json>]')
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  runCli().catch((error) => {
    console.error(`Supabase backup verification failed: ${redactError(error, [process.env.TSA_BONNO_BACKUP_KEY_PASSPHRASE])}`)
    process.exitCode = 1
  })
}

export {
  MAX_DECOMPRESSED_BYTES,
  MAX_ENCRYPTED_BYTES,
  REQUIRED_FILES,
  parseTarArchive,
  verifyPlainArchiveBytes,
  redactError
}
