import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createReadStream, readFileSync } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs
} from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import type { Readable, Writable } from 'node:stream'

const { Client: PgClient } = pg

const BACKUP_MAGIC = Buffer.from('BLBKUP01', 'ascii')
const BACKUP_FORMAT_VERSION = 1
const KEY_KDF_RAW = 0
const KEY_KDF_SCRYPT = 1
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = BACKUP_MAGIC.length + 2 + SALT_BYTES + IV_BYTES + TAG_BYTES
const TAG_OFFSET = BACKUP_MAGIC.length + 2 + SALT_BYTES + IV_BYTES
const AES_ALGORITHM = 'aes-256-gcm'
const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_MAXMEM = 64 * 1024 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const TEST_DB_RE = /^bar_local_test(?:_|$)/
const LIVE_DB_RE = /^bar_local(?:_|$)/
const SHA256_RE = /^[0-9a-f]{64}$/
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const FORBIDDEN_CHILD_ENV = [
  'DATABASE_URL',
  'SUPABASE_DB_URL',
  'SUPABASE_POOLER_URL',
  'BAR_LOCAL_BACKUP_KEY',
  'BAR_LOCAL_BACKUP_KEY_FILE'
]

export class BackupToolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BackupToolError'
    this.code = code
  }
}

export interface EncryptionKey {
  readonly material: Buffer
  readonly kdf: 'raw' | 'scrypt'
  readonly fingerprint: string
}

export interface LoadEncryptionKeyOptions {
  keyFile?: string | null
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
}

export interface PostgresTarget {
  readonly host: string
  readonly port: number
  readonly database: string
  readonly user: string
  readonly password?: string | null
}

export interface BackupManifest {
  readonly format: 'bar-local-backup'
  readonly format_version: 1
  readonly kind: 'postgres_custom_dump' | 'postgres_base_backup'
  readonly created_at: string
  readonly label: string | null
  readonly source: {
    readonly engine: 'postgresql'
    readonly host: string
    readonly port: number
    readonly database: string
  }
  readonly dump: {
    readonly format: 'custom'
    readonly tool: string
  }
  readonly encryption: {
    readonly algorithm: typeof AES_ALGORITHM
    readonly kdf: 'raw' | 'scrypt'
    readonly key_fingerprint: string
    readonly header_bytes: number
  }
  readonly file: {
    readonly name: string
    readonly bytes: number
    readonly plaintext_bytes: number
    readonly sha256: string
    readonly plaintext_sha256: string
  }
  readonly verification: {
    readonly restore_verified: false
    readonly message: string
  }
}

export interface CommandSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly env?: NodeJS.ProcessEnv
  readonly cwd?: string
  readonly timeoutMs?: number
}

export interface CommandResult {
  readonly exitCode: number
  readonly stderr: string
}

export interface SpawnedCommand {
  readonly child: ChildProcess
  readonly stdout: Readable
  readonly completion: Promise<CommandResult>
  readonly kill: () => void
}

export interface BackupReport {
  readonly ok: true
  readonly command: 'backup'
  readonly generated_at: string
  readonly backup: {
    readonly file_name: string
    readonly file_path: string
    readonly bytes: number
    readonly sha256: string
    readonly plaintext_sha256: string
    readonly manifest_path: string
    readonly manifest_sha256: string
  }
  readonly source: {
    readonly engine: 'postgresql'
    readonly host: string
    readonly port: number
    readonly database: string
  }
  readonly encryption: {
    readonly algorithm: typeof AES_ALGORITHM
    readonly kdf: 'raw' | 'scrypt'
    readonly key_fingerprint: string
  }
  readonly tool: { readonly command: string; readonly exit_code: 0 }
  readonly copy: null | {
    readonly directory: string
    readonly file_path: string
    readonly manifest_path: string
    readonly already_present: boolean
  }
  readonly retention: null | RetentionReport
}

export interface CreateBackupOptions {
  readonly target: PostgresTarget
  readonly destinationDir: string
  readonly encryptionKey: EncryptionKey
  readonly label?: string | null
  readonly command?: CommandSpec
  readonly allowTestDatabase?: boolean
  readonly copyToDir?: string | null
  readonly retention?: RetentionPolicy | null
  readonly now?: Date
}

export interface RetentionPolicy {
  readonly hourly?: number
  readonly daily?: number
  readonly weekly?: number
}

export interface RetentionEntry {
  readonly manifestPath: string
  readonly backupPath: string
  readonly fileName: string
  readonly createdAt: Date
}

export interface RetentionReport {
  readonly ok: boolean
  readonly kept: readonly string[]
  readonly deleted: readonly string[]
  readonly errors: readonly string[]
}

export interface BackupScheduleOptions {
  readonly intervalMs: number
  readonly signal: AbortSignal
  readonly runOnce: () => Promise<BackupReport>
  readonly maxRuns?: number
  readonly onResult?: (report: BackupReport) => void | Promise<void>
  readonly onError?: (error: unknown) => void | Promise<void>
}

export interface BackupScheduleReport {
  readonly runs: number
  readonly failures: number
  readonly stopped: 'aborted' | 'max_runs'
}

export interface VerificationTarget {
  readonly host: string
  readonly port: number
  readonly database: string
  readonly user: string
  readonly password?: string | null
  readonly testOptIn: boolean
  readonly sourceDatabase?: string | null
  readonly liveDatabases?: readonly string[]
}

export interface VerificationClient {
  query(text: string, params?: readonly unknown[]): Promise<{
    rows: Array<Record<string, unknown>>
    rowCount: number | null
  }>
}

export interface RestoreVerificationOptions {
  /** Paused PITR snapshot only; this does not qualify writable activation. */
  readonly readOnlySnapshot?: boolean
  readonly migrationsDir: string
  readonly database?: string | null
  readonly expectedAuthorityId?: string | null
  readonly expectedAuthorityEpoch?: string | null
  readonly allowOlderSchema?: boolean
  readonly runtimeRole?: string | null
  readonly expectedMigrationOwner?: string | null
  readonly runtimeProbe?: RuntimeProbeOptions | null
  readonly runtimeHost?: string | null
  readonly runtimePort?: number | null
  readonly runtimeDatabase?: string | null
  readonly runtimeUser?: string | null
  readonly runtimePassword?: string | null
}

export interface VerificationCheck {
  readonly name: string
  readonly status: 'pass' | 'fail'
  readonly violations: number
  readonly detail?: string
  readonly evidence?: readonly string[]
}

export interface RuntimeProbeOptions {
  readonly connect: () => Promise<VerificationClient>
  readonly expectedAuthorityId?: string | null
}

export interface RestoreAuthorization {
  readonly authorized_by: string
  readonly reason: string
  readonly target_database: string
  readonly confirmed: true
}

export interface RestoreRuntimeSecurityOptions {
  readonly readOnlySnapshot?: boolean
  readonly runtimeRole?: string
  readonly migrationOwner?: string
  readonly schema?: string
  readonly runtimeProbe?: RuntimeProbeOptions | null
}

export interface RestoreRuntimeSecurityReport {
  readonly ok: true
  readonly runtime_role: string
  readonly migration_owner: string
  readonly schema: string
  readonly statements_executed: number
}

export interface RestoreVerificationReport {
  readonly ok: boolean
  readonly status: 'verified' | 'failed'
  readonly generated_at: string
  readonly database: string | null
  readonly schema: {
    readonly applied_count: number
    readonly local_count: number
    readonly checksums_verified: boolean
    readonly missing_local: readonly string[]
    readonly unknown_applied: readonly string[]
    readonly mismatched: readonly string[]
  }
  readonly authority: null | {
    readonly authority_id: string
    readonly authority_epoch: string
    readonly business_id: string
    readonly commissioned_at: string | null
    readonly catalogue_version: string | null
    readonly entitlement_version: string | null
    readonly entitlement_features: readonly string[]
  }
  readonly runtime: null | {
    readonly role: string
    readonly schema: string
  }
  readonly counters: {
    readonly commit_sequence: string
    readonly receipt_sequence: string
    /** Legacy aliases for the highest observed batch sequence, not a contiguous checkpoint. */
    readonly acknowledged_watermark: string
    readonly exported_watermark: string
    readonly highest_acknowledged_sequence: string
    readonly highest_exported_sequence: string
    /** Restore evidence cannot establish a contiguous cloud checkpoint from batch maxima. */
    readonly acknowledged_contiguous_checkpoint: null
    readonly pending_outbox: number
  }
  readonly checks: readonly VerificationCheck[]
  readonly failures: readonly string[]
}

export interface RestoreBackupOptions {
  readonly manifestPath: string
  readonly encryptionKey: EncryptionKey
  readonly target: PostgresTarget
  readonly verification: VerificationTarget
  readonly authorization: RestoreAuthorization
  readonly preflightClient: VerificationClient
  readonly securityClient: VerificationClient
  readonly security?: RestoreRuntimeSecurityOptions | null
  readonly pgRestoreCommand?: string
  readonly timeoutMs?: number
}

export interface RestoreBackupReport {
  readonly manifest: BackupManifest
  readonly backup_sha256: string
  readonly plaintext_sha256: string
  readonly dump_bytes: number
  readonly authorization: {
    readonly authorized_by: string
    readonly reason: string
    readonly target_database: string
  }
  readonly security: RestoreRuntimeSecurityReport
  readonly restored_to: {
    readonly host: string
    readonly port: number
    readonly database: string
  }
}

interface AtomicFile {
  readonly tempPath: string
  readonly stream: Writable
  finish(finalPath: string): Promise<void>
  abort(): Promise<void>
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeName(value: string): string {
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)
}

function assertFiniteInteger(value: unknown, field: string, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new BackupToolError('BACKUP_CONFIG_INVALID', `${field} must be an integer between ${min} and ${max}.`)
  }
  return number
}

function fingerprintKey(material: Buffer): string {
  return sha256Hex(Buffer.concat([Buffer.from('bar-local-backup-key-v1\0', 'utf8'), material])).slice(0, 32)
}

function decodeKeyMaterial(raw: string): { material: Buffer; kdf: 'raw' | 'scrypt' } {
  const value = raw.trim()
  if (value.length < 16) {
    throw new BackupToolError('ENCRYPTION_KEY_INVALID', 'The backup encryption key material is too short.')
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return { material: Buffer.from(value, 'hex'), kdf: 'raw' }
  }
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    const decoded = Buffer.from(value, 'base64')
    if (decoded.length === 32) return { material: decoded, kdf: 'raw' }
  }
  return { material: Buffer.from(value, 'utf8'), kdf: 'scrypt' }
}

export function loadEncryptionKey(options: LoadEncryptionKeyOptions = {}): EncryptionKey {
  const env = options.env ?? process.env
  const explicitFile = options.keyFile ? path.resolve(options.keyFile) : null
  const envFile = env.BAR_LOCAL_BACKUP_KEY_FILE ? path.resolve(env.BAR_LOCAL_BACKUP_KEY_FILE) : null
  const direct = env.BAR_LOCAL_BACKUP_KEY?.trim()
  if (explicitFile && direct) {
    throw new BackupToolError('ENCRYPTION_KEY_INVALID', 'Supply the backup key from either a file or the environment, not both.')
  }
  if (direct && envFile) {
    throw new BackupToolError('ENCRYPTION_KEY_INVALID', 'BAR_LOCAL_BACKUP_KEY and BAR_LOCAL_BACKUP_KEY_FILE cannot both be set.')
  }
  let sourceText: string | null = null
  if (explicitFile) {
    try {
      sourceText = requireKeyFileSync(explicitFile)
    } catch {
      throw new BackupToolError('ENCRYPTION_KEY_INVALID', `The backup key file could not be read: ${explicitFile}`)
    }
  } else if (envFile) {
    try {
      sourceText = requireKeyFileSync(envFile)
    } catch {
      throw new BackupToolError('ENCRYPTION_KEY_INVALID', `BAR_LOCAL_BACKUP_KEY_FILE could not be read: ${envFile}`)
    }
  } else if (direct) {
    sourceText = direct
  }
  if (!sourceText) {
    throw new BackupToolError('ENCRYPTION_KEY_MISSING', 'Set BAR_LOCAL_BACKUP_KEY or BAR_LOCAL_BACKUP_KEY_FILE, or pass --key-file.')
  }
  const decoded = decodeKeyMaterial(sourceText)
  return Object.freeze({
    material: decoded.material,
    kdf: decoded.kdf,
    fingerprint: fingerprintKey(decoded.material)
  })
}

function requireKeyFileSync(filePath: string): string {
  const value = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim()
  if (!value) throw new Error('empty key file')
  return value
}

function deriveKey(key: EncryptionKey, salt: Buffer): Buffer {
  if (key.kdf === 'raw') return key.material
  return scryptSync(key.material, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  })
}

function headerFor(key: EncryptionKey, salt: Buffer, iv: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_BYTES)
  BACKUP_MAGIC.copy(header, 0)
  header.writeUInt8(BACKUP_FORMAT_VERSION, BACKUP_MAGIC.length)
  header.writeUInt8(key.kdf === 'scrypt' ? KEY_KDF_SCRYPT : KEY_KDF_RAW, BACKUP_MAGIC.length + 1)
  salt.copy(header, BACKUP_MAGIC.length + 2)
  iv.copy(header, BACKUP_MAGIC.length + 2 + SALT_BYTES)
  return header
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | null = null
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch {
    // Windows and some network filesystems do not permit directory fsync.
    // File data has already been flushed before rename in that case.
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function openAtomicFile(finalPath: string, mode = 0o600): Promise<AtomicFile> {
  await mkdir(path.dirname(finalPath), { recursive: true })
  const tempPath = `${finalPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  const file = await open(tempPath, 'wx', mode)
  const stream = file.createWriteStream({ autoClose: true })
  let settled = false
  return {
    tempPath,
    stream,
    async finish(target) {
      if (settled) return
      try {
        const handle = await open(tempPath, 'r+')
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
        settled = true
        await rename(tempPath, target)
        await fsyncDirectory(path.dirname(target))
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => {})
        throw error
      }
    },
    async abort() {
      if (settled) return
      settled = true
      stream.destroy()
      await rm(tempPath, { force: true }).catch(() => {})
    }
  }
}

async function writeFileAtomic(filePath: string, data: string | Buffer, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  const file = await open(tempPath, 'wx', mode)
  try {
    await file.writeFile(data)
    await file.sync()
    await file.close()
    await rename(tempPath, filePath)
    await fsyncDirectory(path.dirname(filePath))
  } catch (error) {
    await file.close().catch(() => {})
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

export interface EncryptFileOptions {
  readonly inputPath: string
  readonly outputPath: string
  readonly key: EncryptionKey
  readonly mode?: number
}

export async function encryptFile(options: EncryptFileOptions): Promise<{
  sha256: string
  plaintextSha256: string
  plaintextBytes: number
  bytes: number
}> {
  return encryptReadableToFile({
    input: createReadStream(options.inputPath),
    outputPath: options.outputPath,
    key: options.key,
    mode: options.mode
  })
}

interface EncryptReadableOptions {
  readonly input: Readable
  readonly outputPath: string
  readonly key: EncryptionKey
  readonly mode?: number
}

async function encryptReadableToFile(options: EncryptReadableOptions): Promise<{
  sha256: string
  plaintextSha256: string
  plaintextBytes: number
  bytes: number
}> {
  const salt = options.key.kdf === 'scrypt' ? randomBytes(SALT_BYTES) : Buffer.alloc(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(AES_ALGORITHM, deriveKey(options.key, salt), iv)
  const plaintextHash = createHash('sha256')
  let plaintextBytes = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      plaintextHash.update(chunk)
      plaintextBytes += chunk.length
      callback(null, chunk)
    }
  })
  const target = await openAtomicFile(options.outputPath, options.mode ?? 0o600)
  try {
    target.stream.write(headerFor(options.key, salt, iv))
    await pipeline(options.input, meter, cipher, target.stream)
    const tag = cipher.getAuthTag()
    const handle = await open(target.tempPath, 'r+')
    try {
      await handle.write(tag, 0, tag.length, TAG_OFFSET)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await target.finish(options.outputPath)
    const bytes = (await stat(options.outputPath)).size
    return {
      sha256: await hashFile(options.outputPath),
      plaintextSha256: plaintextHash.digest('hex'),
      plaintextBytes,
      bytes
    }
  } catch (error) {
    await target.abort()
    throw error
  }
}

export interface DecryptFileOptions {
  readonly encryptedPath: string
  readonly outputPath: string
  readonly key: EncryptionKey
  readonly expectedSha256?: string | null
  readonly expectedPlaintextSha256?: string | null
  readonly mode?: number
}

export async function decryptFile(options: DecryptFileOptions): Promise<{
  sha256: string
  plaintextSha256: string
  plaintextBytes: number
}> {
  const encryptedSha256 = await hashFile(options.encryptedPath)
  if (options.expectedSha256 && encryptedSha256 !== options.expectedSha256.toLowerCase()) {
    throw new BackupToolError('BACKUP_TAMPERED', 'Encrypted backup SHA-256 does not match its manifest.')
  }
  const handle = await open(options.encryptedPath, 'r')
  try {
    const header = Buffer.alloc(HEADER_BYTES)
    const headerRead = await handle.read(header, 0, HEADER_BYTES, 0)
    if (headerRead.bytesRead !== HEADER_BYTES || !header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
      throw new BackupToolError('BACKUP_FORMAT_INVALID', 'The encrypted backup header is not a Bar local backup.')
    }
    if (header.readUInt8(BACKUP_MAGIC.length) !== BACKUP_FORMAT_VERSION) {
      throw new BackupToolError('BACKUP_FORMAT_INVALID', 'The encrypted backup format version is not supported.')
    }
    const kdfByte = header.readUInt8(BACKUP_MAGIC.length + 1)
    if (kdfByte !== KEY_KDF_RAW && kdfByte !== KEY_KDF_SCRYPT) {
      throw new BackupToolError('BACKUP_FORMAT_INVALID', 'The encrypted backup key-derivation identifier is invalid.')
    }
    if ((kdfByte === KEY_KDF_SCRYPT ? 'scrypt' : 'raw') !== options.key.kdf) {
      throw new BackupToolError('BACKUP_KEY_MISMATCH', 'The supplied key type does not match the encrypted backup.')
    }
    const salt = header.subarray(BACKUP_MAGIC.length + 2, BACKUP_MAGIC.length + 2 + SALT_BYTES)
    const iv = header.subarray(BACKUP_MAGIC.length + 2 + SALT_BYTES, TAG_OFFSET)
    const tag = header.subarray(TAG_OFFSET, TAG_OFFSET + TAG_BYTES)
    const decipher = createDecipheriv(AES_ALGORITHM, deriveKey(options.key, salt), iv)
    decipher.setAuthTag(tag)
    const plaintextHash = createHash('sha256')
    let plaintextBytes = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        plaintextHash.update(chunk)
        plaintextBytes += chunk.length
        callback(null, chunk)
      }
    })
    const target = await openAtomicFile(options.outputPath, options.mode ?? 0o600)
    try {
      const input = handle.createReadStream({ start: HEADER_BYTES, autoClose: false })
      await pipeline(input, decipher, meter, target.stream)
      const plaintextSha256 = plaintextHash.digest('hex')
      if (options.expectedPlaintextSha256 && plaintextSha256 !== options.expectedPlaintextSha256.toLowerCase()) {
        throw new BackupToolError('BACKUP_TAMPERED', 'Decrypted backup SHA-256 does not match its manifest.')
      }
      await target.finish(options.outputPath)
      return { sha256: encryptedSha256, plaintextSha256, plaintextBytes }
    } catch (error) {
      await target.abort()
      if (error instanceof BackupToolError) throw error
      throw new BackupToolError('BACKUP_DECRYPT_FAILED', 'Backup decryption failed: authentication tag mismatch or corrupt content.')
    }
  } finally {
    await handle.close().catch(() => {})
  }
}

export function createPgDumpSpec(target: PostgresTarget, options: { timeoutMs?: number; command?: string } = {}): CommandSpec {
  const args = [
    '--format=custom',
    '--no-password',
    '--no-owner',
    '--no-privileges',
    '--lock-wait-timeout=15000',
    `--host=${target.host}`,
    `--port=${target.port}`,
    `--username=${target.user}`,
    `--dbname=${target.database}`
  ]
  return {
    command: options.command ?? 'pg_dump',
    args,
    env: buildToolEnv(target.password),
    timeoutMs: options.timeoutMs ?? 30 * 60 * 1000
  }
}

function buildToolEnv(password: string | null | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of FORBIDDEN_CHILD_ENV) delete env[name]
  if (password) env.PGPASSWORD = password
  else delete env.PGPASSWORD
  return env
}

function redactCommandText(value: string): string {
  return value
    .replace(/(password|secret|token|key)\s*=\s*\S+/gi, '$1=[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-connection-string]')
    .slice(-4000)
}

export function spawnCommand(spec: CommandSpec): SpawnedCommand {
  const childEnv: NodeJS.ProcessEnv = { ...(spec.env ?? process.env) }
  for (const name of FORBIDDEN_CHILD_ENV) delete childEnv[name]
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  if (!child.stdout) {
    child.kill()
    throw new BackupToolError('BACKUP_COMMAND_FAILED', 'The backup command did not expose a stdout stream.')
  }
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8000)
  })
  let timedOut = false
  let settled = false
  let timer: NodeJS.Timeout | null = null
  const completion = new Promise<CommandResult>((resolve, reject) => {
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(error)
    }
    child.once('error', (error: NodeJS.ErrnoException) => {
      fail(new BackupToolError(
        'BACKUP_COMMAND_FAILED',
        `The backup command could not be started (${error.code ?? 'UNKNOWN'}): ${spec.command}`
      ))
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (timedOut) {
        reject(new BackupToolError('BACKUP_COMMAND_TIMEOUT', 'The backup command exceeded its timeout.'))
        return
      }
      if (code !== 0) {
        reject(new BackupToolError(
          'BACKUP_COMMAND_FAILED',
          `The backup command exited with code ${code ?? 'unknown'}${stderr ? `: ${redactCommandText(stderr)}` : '.'}`
        ))
        return
      }
      resolve({ exitCode: 0, stderr: redactCommandText(stderr) })
    })
    if (spec.timeoutMs && spec.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill()
        // Never wait for a close event to report a timeout. A grandchild
        // process can hold the inherited pipes open after the direct child has
        // exited or been killed, which would otherwise hang the caller forever.
        fail(new BackupToolError('BACKUP_COMMAND_TIMEOUT', 'The backup command exceeded its timeout.'))
      }, spec.timeoutMs)
      timer.unref?.()
    }
  })
  return {
    child,
    stdout: child.stdout,
    completion,
    kill: () => {
      if (!child.killed) child.kill()
    }
  }
}

function assertBackupSource(target: PostgresTarget, allowTestDatabase: boolean): void {
  if (!target.host || !target.host.trim()) {
    throw new BackupToolError('BACKUP_TARGET_INVALID', 'A PostgreSQL host is required.')
  }
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65_535) {
    throw new BackupToolError('BACKUP_TARGET_INVALID', 'The PostgreSQL port must be an integer between 1 and 65535.')
  }
  if (!target.database || !LIVE_DB_RE.test(target.database)) {
    throw new BackupToolError('BACKUP_TARGET_INVALID', 'The backup source must be a dedicated bar_local database.')
  }
  if (TEST_DB_RE.test(target.database) && !allowTestDatabase) {
    throw new BackupToolError('BACKUP_TARGET_INVALID', 'Refusing to back up bar_local_test data without --allow-test-database.')
  }
  if (!target.user || !target.user.trim()) {
    throw new BackupToolError('BACKUP_TARGET_INVALID', 'A PostgreSQL user is required.')
  }
  if (/^(admin|root|service_role)$/i.test(target.user)) {
    throw new BackupToolError('BACKUP_TARGET_INVALID', `The database user ${target.user} is not permitted for Bar backups.`)
  }
}

function safeFileComponent(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'bar-local'
}

function timestampFor(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function manifestFileNameFor(backupFileName: string): string {
  return `${backupFileName.replace(/\.blb$/i, '')}.manifest.json`
}

function buildManifest(options: {
  target: PostgresTarget
  key: EncryptionKey
  label: string | null
  fileName: string
  proof: { sha256: string; plaintextSha256: string; plaintextBytes: number; bytes: number }
  tool: string
  now: Date
}): BackupManifest {
  return {
    format: 'bar-local-backup',
    format_version: 1,
    kind: 'postgres_custom_dump',
    created_at: options.now.toISOString(),
    label: options.label,
    source: {
      engine: 'postgresql',
      host: options.target.host,
      port: options.target.port,
      database: options.target.database
    },
    dump: { format: 'custom', tool: path.basename(options.tool) },
    encryption: {
      algorithm: AES_ALGORITHM,
      kdf: options.key.kdf,
      key_fingerprint: options.key.fingerprint,
      header_bytes: HEADER_BYTES
    },
    file: {
      name: options.fileName,
      bytes: options.proof.bytes,
      plaintext_bytes: options.proof.plaintextBytes,
      sha256: options.proof.sha256,
      plaintext_sha256: options.proof.plaintextSha256
    },
    verification: {
      restore_verified: false,
      message: 'This encrypted pg_dump snapshot does not include a WAL/PITR archive chain. Package integrity alone is not restore evidence; run verify-restore on an isolated target before relying on it.'
    }
  }
}

export async function createEncryptedBackup(options: CreateBackupOptions): Promise<BackupReport> {
  const now = options.now ?? new Date()
  assertBackupSource(options.target, options.allowTestDatabase ?? false)
  const destination = path.resolve(options.destinationDir)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const fileName = `bar-local-${safeFileComponent(options.target.database)}-${timestampFor(now)}-${randomBytes(4).toString('hex')}.blb`
  const backupPath = path.join(destination, fileName)
  const manifestPath = path.join(destination, manifestFileNameFor(fileName))
  const spec = options.command ?? createPgDumpSpec(options.target)
  const spawned = spawnCommand(spec)
  let proof: { sha256: string; plaintextSha256: string; plaintextBytes: number; bytes: number }
  try {
    proof = await encryptReadableToFile({
      input: spawned.stdout,
      outputPath: backupPath,
      key: options.encryptionKey
    })
    await spawned.completion
  } catch (error) {
    spawned.kill()
    await spawned.completion.catch(() => {})
    await rm(backupPath, { force: true }).catch(() => {})
    await rm(manifestPath, { force: true }).catch(() => {})
    throw error
  }

  const manifest = buildManifest({
    target: options.target,
    key: options.encryptionKey,
    label: options.label ? normalizeName(options.label) : null,
    fileName,
    proof,
    tool: spec.command,
    now
  })
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  const manifestSha256 = sha256Hex(Buffer.from(manifestText, 'utf8'))
  try {
    await writeFileAtomic(manifestPath, manifestText)
  } catch (error) {
    await rm(backupPath, { force: true }).catch(() => {})
    throw error
  }

  let copy: BackupReport['copy'] = null
  if (options.copyToDir) {
    copy = await copyBackupPackage({
      manifestPath,
      destinationDir: options.copyToDir,
      encryptionKey: options.encryptionKey
    })
  }

  let retention: RetentionReport | null = null
  if (options.retention) {
    retention = await applyRetention({
      directory: destination,
      policy: options.retention,
      now
    })
    if (!retention.ok) {
      throw new BackupToolError(
        'BACKUP_RETENTION_FAILED',
        `The backup package was created at ${backupPath} but retention did not complete. Preserve the package and correct the destination errors: ${retention.errors.join('; ') || 'unknown retention error'}`
      )
    }
  }

  return {
    ok: true,
    command: 'backup',
    generated_at: now.toISOString(),
    backup: {
      file_name: fileName,
      file_path: backupPath,
      bytes: proof.bytes,
      sha256: proof.sha256,
      plaintext_sha256: proof.plaintextSha256,
      manifest_path: manifestPath,
      manifest_sha256: manifestSha256
    },
    source: {
      engine: 'postgresql',
      host: options.target.host,
      port: options.target.port,
      database: options.target.database
    },
    encryption: {
      algorithm: AES_ALGORITHM,
      kdf: options.encryptionKey.kdf,
      key_fingerprint: options.encryptionKey.fingerprint
    },
    tool: { command: path.basename(spec.command), exit_code: 0 },
    copy,
    retention
  }
}

export function parseBackupManifest(value: unknown): BackupManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest is not a JSON object.')
  }
  const record = value as Record<string, unknown>
  if (record.format !== 'bar-local-backup' || record.format_version !== 1) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest format is not supported.')
  }
  const source = record.source
  const file = record.file
  const encryption = record.encryption
  if (typeof source !== 'object' || source === null || Array.isArray(source)
    || typeof file !== 'object' || file === null || Array.isArray(file)
    || typeof encryption !== 'object' || encryption === null || Array.isArray(encryption)) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest is missing source, file or encryption metadata.')
  }
  const sourceRecord = source as Record<string, unknown>
  const fileRecord = file as Record<string, unknown>
  const encryptionRecord = encryption as Record<string, unknown>
  const name = typeof fileRecord.name === 'string' ? fileRecord.name : ''
  if (!name || path.basename(name) !== name || !/\.blb$/i.test(name)) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest file name is invalid.')
  }
  if (typeof fileRecord.sha256 !== 'string' || !SHA256_RE.test(fileRecord.sha256)
    || typeof fileRecord.plaintext_sha256 !== 'string' || !SHA256_RE.test(fileRecord.plaintext_sha256)) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest hashes are invalid.')
  }
  const bytes = fileRecord.bytes
  const plaintextBytes = fileRecord.plaintext_bytes
  if (!Number.isSafeInteger(bytes) || Number(bytes) < HEADER_BYTES
    || !Number.isSafeInteger(plaintextBytes) || Number(plaintextBytes) < 0) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest file sizes are invalid.')
  }
  const port = sourceRecord.port
  if (sourceRecord.engine !== 'postgresql'
    || typeof sourceRecord.database !== 'string' || !sourceRecord.database
    || typeof sourceRecord.host !== 'string' || !sourceRecord.host
    || !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65_535) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest source target is invalid.')
  }
  const dump = record.dump
  if (typeof dump !== 'object' || dump === null || Array.isArray(dump)) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest dump metadata is invalid.')
  }
  const dumpRecord = dump as Record<string, unknown>
  if (dumpRecord.format !== 'custom' || typeof dumpRecord.tool !== 'string' || !dumpRecord.tool) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest dump metadata is invalid.')
  }
  const kdf = encryptionRecord.kdf
  if (encryptionRecord.algorithm !== AES_ALGORITHM
    || (kdf !== 'raw' && kdf !== 'scrypt')
    || typeof encryptionRecord.key_fingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(encryptionRecord.key_fingerprint)
    || encryptionRecord.header_bytes !== HEADER_BYTES) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest encryption metadata is invalid.')
  }
  const verification = record.verification
  if (typeof verification !== 'object' || verification === null || Array.isArray(verification)) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest verification metadata is invalid.')
  }
  const verificationRecord = verification as Record<string, unknown>
  if (verificationRecord.restore_verified !== false || typeof verificationRecord.message !== 'string') {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest verification metadata is invalid.')
  }
  const label = record.label
  if (label !== null && typeof label !== 'string') {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest label is invalid.')
  }
  const createdAt = typeof record.created_at === 'string' ? new Date(record.created_at) : null
  if (!createdAt || Number.isNaN(createdAt.getTime())) {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest creation time is invalid.')
  }
  if (record.kind !== 'postgres_custom_dump' && record.kind !== 'postgres_base_backup') {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest kind is invalid.')
  }
  return {
    format: 'bar-local-backup',
    format_version: 1,
    kind: record.kind,
    created_at: createdAt.toISOString(),
    label,
    source: {
      engine: 'postgresql',
      host: sourceRecord.host,
      port: Number(port),
      database: sourceRecord.database
    },
    dump: { format: 'custom', tool: dumpRecord.tool },
    encryption: {
      algorithm: AES_ALGORITHM,
      kdf,
      key_fingerprint: encryptionRecord.key_fingerprint,
      header_bytes: HEADER_BYTES
    },
    file: {
      name,
      bytes: Number(bytes),
      plaintext_bytes: Number(plaintextBytes),
      sha256: fileRecord.sha256,
      plaintext_sha256: fileRecord.plaintext_sha256
    },
    verification: {
      restore_verified: false,
      message: verificationRecord.message
    }
  }
}

export async function readBackupManifest(manifestPath: string): Promise<BackupManifest> {
  let text: string
  try {
    text = await readFile(manifestPath, 'utf8')
  } catch {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', `The backup manifest could not be read: ${manifestPath}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupToolError('BACKUP_MANIFEST_INVALID', 'The backup manifest is not valid JSON.')
  }
  return parseBackupManifest(parsed)
}

export async function verifyBackupPackage(manifestPath: string): Promise<{
  manifest: BackupManifest
  backupPath: string
  sha256: string
  bytes: number
}> {
  const manifest = await readBackupManifest(manifestPath)
  const backupPath = path.resolve(path.dirname(manifestPath), manifest.file.name)
  const stats = await stat(backupPath).catch(() => null)
  if (!stats || !stats.isFile()) {
    throw new BackupToolError('BACKUP_FILE_MISSING', 'The encrypted backup file is missing.')
  }
  if (stats.size !== manifest.file.bytes) {
    throw new BackupToolError('BACKUP_TAMPERED', 'Encrypted backup size does not match its manifest.')
  }
  const sha256 = await hashFile(backupPath)
  if (sha256 !== manifest.file.sha256) {
    throw new BackupToolError('BACKUP_TAMPERED', 'Encrypted backup SHA-256 does not match its manifest.')
  }
  return { manifest, backupPath, sha256, bytes: stats.size }
}

async function copyFileAtomic(sourcePath: string, targetPath: string, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  try {
    await copyFile(sourcePath, tempPath)
    const file = await open(tempPath, 'r+')
    try {
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(tempPath, targetPath)
    await fsyncDirectory(path.dirname(targetPath))
    await chmod(targetPath, mode).catch(() => {})
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function copyBackupPackage(options: {
  manifestPath: string
  destinationDir: string
  encryptionKey?: EncryptionKey | null
}): Promise<NonNullable<BackupReport['copy']>> {
  const verified = await verifyBackupPackage(options.manifestPath)
  const destination = path.resolve(options.destinationDir)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const targetBackup = path.join(destination, path.basename(verified.backupPath))
  const targetManifest = path.join(destination, path.basename(options.manifestPath))
  const existing = await stat(targetBackup).catch(() => null)
  const existingHash = existing?.isFile() ? await hashFile(targetBackup) : null
  const alreadyPresent = existingHash === verified.sha256
  if (!alreadyPresent) {
    await copyFileAtomic(verified.backupPath, targetBackup)
    const copiedHash = await hashFile(targetBackup)
    if (copiedHash !== verified.sha256) {
      throw new BackupToolError('BACKUP_COPY_FAILED', 'The copied backup did not verify against its SHA-256 manifest.')
    }
  }
  const manifestHash = await hashFile(options.manifestPath)
  const existingManifestHash = await hashFile(targetManifest).catch(() => null)
  if (existingManifestHash !== manifestHash) {
    await copyFileAtomic(options.manifestPath, targetManifest)
  }
  return {
    directory: destination,
    file_path: targetBackup,
    manifest_path: targetManifest,
    already_present: alreadyPresent
  }
}

function utcHourKey(date: Date): string {
  return date.toISOString().slice(0, 13)
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function utcWeekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const weekday = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() - weekday + 1)
  return day.toISOString().slice(0, 10)
}

function retainedByBucket(
  entries: readonly RetentionEntry[],
  keyFor: (date: Date) => string,
  limit: number,
  maxAgeMs: number,
  now: Date
): Set<string> {
  const keep = new Set<string>()
  if (limit <= 0) return keep
  const seen = new Set<string>()
  for (const entry of entries) {
    const age = now.getTime() - entry.createdAt.getTime()
    if (age > maxAgeMs) continue
    const key = keyFor(entry.createdAt)
    if (seen.has(key)) continue
    seen.add(key)
    keep.add(entry.manifestPath)
    if (seen.size >= limit) break
  }
  return keep
}

export function selectRetentionEntries(
  entries: readonly RetentionEntry[],
  policy: RetentionPolicy,
  now: Date = new Date()
): Set<string> {
  const sorted = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const keep = new Set<string>()
  if (sorted.length === 0) return keep
  keep.add(sorted[0].manifestPath)
  const hourly = policy.hourly ?? 0
  const daily = policy.daily ?? 0
  const weekly = policy.weekly ?? 0
  for (const entry of retainedByBucket(sorted, utcHourKey, hourly, hourly * 3_600_000, now)) keep.add(entry)
  for (const entry of retainedByBucket(sorted, utcDayKey, daily, daily * 86_400_000, now)) keep.add(entry)
  for (const entry of retainedByBucket(sorted, utcWeekKey, weekly, weekly * 7 * 86_400_000, now)) keep.add(entry)
  return keep
}

export async function applyRetention(options: {
  directory: string
  policy: RetentionPolicy
  now?: Date
}): Promise<RetentionReport> {
  const directory = path.resolve(options.directory)
  const now = options.now ?? new Date()
  const entries: RetentionEntry[] = []
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    return { ok: false, kept: [], deleted: [], errors: [`Cannot read backup destination: ${error instanceof Error ? error.message : 'unknown error'}`] }
  }
  const errors: string[] = []
  const referencedFiles = new Set<string>()
  const sourceDatabases = new Set<string>()
  for (const name of names.filter((value) => value.endsWith('.manifest.json'))) {
    const manifestPath = path.join(directory, name)
    try {
      const { manifest, backupPath } = await verifyBackupPackage(manifestPath)
      const fileKey = process.platform === 'win32' ? manifest.file.name.toLowerCase() : manifest.file.name
      if (referencedFiles.has(fileKey)) throw new Error('multiple manifests refer to the same package')
      referencedFiles.add(fileKey)
      sourceDatabases.add(manifest.source.database)
      entries.push({
        manifestPath,
        backupPath,
        fileName: manifest.file.name,
        createdAt: new Date(manifest.created_at)
      })
    } catch (error) {
      errors.push(`Cannot verify ${name}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  if (sourceDatabases.size > 1) errors.push('Backup destination contains packages from multiple source databases; use separate destinations before applying retention.')
  // A damaged or ambiguous package must never displace a known-good recovery
  // point. Stop the entire deletion pass and require an operator to investigate.
  if (errors.length > 0) return { ok: false, kept: entries.map((entry) => path.basename(entry.manifestPath)), deleted: [], errors }
  const keep = selectRetentionEntries(entries, options.policy, now)
  const kept: string[] = []
  const deleted: string[] = []
  for (const entry of entries) {
    if (keep.has(entry.manifestPath)) {
      kept.push(path.basename(entry.manifestPath))
      continue
    }
    try {
      await rm(entry.backupPath, { force: true })
      await rm(entry.manifestPath, { force: true })
      deleted.push(path.basename(entry.manifestPath))
    } catch (error) {
      errors.push(`Could not delete ${path.basename(entry.manifestPath)}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  return { ok: errors.length === 0, kept, deleted, errors }
}

function abortError(): Error {
  const error = new Error('The backup schedule was stopped.')
  error.name = 'AbortError'
  return error
}

function delayWithSignal(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runBackupSchedule(options: BackupScheduleOptions): Promise<BackupScheduleReport> {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 60_000) {
    throw new BackupToolError('BACKUP_SCHEDULE_INVALID', 'The backup schedule interval must be at least 60000 milliseconds.')
  }
  let runs = 0
  let failures = 0
  let stopped: BackupScheduleReport['stopped'] = 'aborted'
  while (!options.signal.aborted) {
    runs += 1
    try {
      const report = await options.runOnce()
      await options.onResult?.(report)
    } catch (error) {
      failures += 1
      await options.onError?.(error)
    }
    if (options.maxRuns && runs >= options.maxRuns) {
      stopped = 'max_runs'
      break
    }
    try {
      await delayWithSignal(options.intervalMs, options.signal)
    } catch {
      break
    }
  }
  return { runs, failures, stopped }
}

export function assertVerificationTarget(target: VerificationTarget): VerificationTarget {
  if (!target.testOptIn) {
    throw new BackupToolError('RESTORE_TARGET_REJECTED', 'Restore verification requires explicit BAR_LOCAL_TEST_DB=1 opt-in.')
  }
  const host = target.host.trim().toLowerCase()
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new BackupToolError('RESTORE_TARGET_REJECTED', 'Restore verification target must be a loopback PostgreSQL host.')
  }
  if (!Number.isInteger(target.port) || target.port < 1024 || target.port > 65_535 || target.port === 5432) {
    throw new BackupToolError('RESTORE_TARGET_REJECTED', 'Restore verification target must use an explicit non-default TCP port.')
  }
  if (!TEST_DB_RE.test(target.database)) {
    throw new BackupToolError('RESTORE_TARGET_REJECTED', 'Restore verification requires a dedicated bar_local_test database name.')
  }
  if (target.sourceDatabase && target.database === target.sourceDatabase) {
    throw new BackupToolError('RESTORE_TARGET_REJECTED', 'Restore verification cannot target the source database.')
  }
  if ((target.liveDatabases ?? []).includes(target.database)) {
    throw new BackupToolError('RESTORE_TARGET_REJECTED', 'Restore verification cannot target a live database.')
  }
  if (/^(admin|root|service_role)$/i.test(target.user)) {
    throw new BackupToolError('RESTORE_TARGET_REJECTED', `The database user ${target.user} is not permitted for restore verification.`)
  }
  return { ...target, host }
}

export function assertRestoreAuthorization(
  authorization: RestoreAuthorization | null | undefined,
  targetDatabase: string
): RestoreAuthorization {
  if (!authorization || authorization.confirmed !== true) {
    throw new BackupToolError(
      'RESTORE_AUTHORIZATION_REQUIRED',
      'Restoring a database requires explicit owner/authority intent: supply --authorized-by, --reason and --confirm-database.'
    )
  }
  const authorizedBy = typeof authorization.authorized_by === 'string' ? authorization.authorized_by.trim() : ''
  const reason = typeof authorization.reason === 'string' ? authorization.reason.trim() : ''
  if (authorizedBy.length < 3) {
    throw new BackupToolError('RESTORE_AUTHORIZATION_REQUIRED', 'The authorising owner/authority name must be at least 3 characters.')
  }
  if (reason.length < 8) {
    throw new BackupToolError('RESTORE_AUTHORIZATION_REQUIRED', 'A restore reason of at least 8 characters is required for audit evidence.')
  }
  if (authorization.target_database !== targetDatabase) {
    throw new BackupToolError(
      'RESTORE_AUTHORIZATION_MISMATCH',
      `The authorisation confirms ${authorization.target_database} but the restore target is ${targetDatabase}.`
    )
  }
  return { authorized_by: authorizedBy, reason, target_database: targetDatabase, confirmed: true }
}

export async function assertRestoreTargetEmpty(client: VerificationClient, database?: string | null): Promise<void> {
  let row: Record<string, unknown> | undefined
  try {
    const result = await client.query(
      `/* check:restore_target_empty */
       SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'bar_local') AS has_schema,
              to_regclass('bar_local.schema_migrations') IS NOT NULL AS has_migrations,
              to_regclass('bar_local.authority') IS NOT NULL AS has_authority,
              to_regclass('bar_local.sales') IS NOT NULL AS has_sales`
    )
    row = result.rows[0]
  } catch {
    throw new BackupToolError(
      'RESTORE_TARGET_PREFLIGHT_FAILED',
      `The restore target ${database ?? 'database'} could not be inspected for existing Bar data.`
    )
  }
  const occupied = Boolean(
    rowValue(row, 'has_schema') ||
    rowValue(row, 'has_migrations') ||
    rowValue(row, 'has_authority') ||
    rowValue(row, 'has_sales')
  )
  if (occupied) {
    throw new BackupToolError(
      'RESTORE_TARGET_NOT_EMPTY',
      `Refusing to restore into ${database ?? 'the target database'}: it already contains a bar_local schema or Bar data. Restore must target a new, verified-empty database.`
    )
  }
}

function assertRuntimeIdentifier(value: string, field: string): string {
  const normalized = value.trim()
  if (!IDENTIFIER_RE.test(normalized)) {
    throw new BackupToolError('RESTORE_SECURITY_INVALID', `${field} must be a plain PostgreSQL identifier.`)
  }
  return normalized
}

export function buildRuntimeSecurityStatements(options: RestoreRuntimeSecurityOptions = {}): string[] {
  const schema = assertRuntimeIdentifier(options.schema ?? 'bar_local', 'schema')
  const runtimeRole = assertRuntimeIdentifier(options.runtimeRole ?? 'bar_local_runtime', 'runtime role')
  const owner = options.migrationOwner ? assertRuntimeIdentifier(options.migrationOwner, 'migration owner') : null
  if (owner && owner === runtimeRole) {
    throw new BackupToolError('RESTORE_SECURITY_INVALID', 'The runtime role must not own the migration schema or objects.')
  }
  const schemaId = `"${schema}"`
  const runtimeId = `"${runtimeRole}"`
  const statements = [
    `REVOKE ALL ON SCHEMA ${schemaId} FROM PUBLIC`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaId} FROM PUBLIC`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schemaId} FROM PUBLIC`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schemaId} FROM PUBLIC`,
    `REVOKE ALL ON SCHEMA ${schemaId} FROM ${runtimeId}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaId} FROM ${runtimeId}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schemaId} FROM ${runtimeId}`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schemaId} FROM ${runtimeId}`,
    `REVOKE CREATE ON SCHEMA ${schemaId} FROM ${runtimeId}`,
    `GRANT USAGE ON SCHEMA ${schemaId} TO ${runtimeId}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaId} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaId} REVOKE ALL ON TABLES FROM PUBLIC`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaId} REVOKE ALL ON SEQUENCES FROM PUBLIC`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaId} REVOKE EXECUTE ON FUNCTIONS FROM ${runtimeId}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaId} REVOKE ALL ON TABLES FROM ${runtimeId}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaId} REVOKE ALL ON SEQUENCES FROM ${runtimeId}`,
    `DO $bar_local_role$
     DECLARE
       v_role pg_roles%ROWTYPE;
     BEGIN
       SELECT * INTO v_role FROM pg_roles WHERE rolname = '${runtimeRole}';
       IF NOT FOUND THEN
         RAISE EXCEPTION 'The runtime role % is missing; refusing to secure the restored schema.', '${runtimeRole}';
       END IF;
       IF v_role.rolsuper OR v_role.rolcreatedb OR v_role.rolcreaterole OR v_role.rolreplication OR v_role.rolbypassrls THEN
         EXECUTE format('ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', '${runtimeRole}');
       END IF;
     END;
     $bar_local_role$`,
    ...(owner ? [`DO $bar_local_owner$
     DECLARE
       v_obj record;
       v_owner name;
     BEGIN
       SELECT pg_get_userbyid(nspowner) INTO v_owner FROM pg_namespace WHERE nspname = '${schema}';
       IF v_owner IS NULL THEN
         RAISE EXCEPTION 'The restored schema % is missing; refusing to reassign ownership.', '${schema}';
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${owner}') THEN
         RAISE EXCEPTION 'The migration owner role % is missing; refusing to reassign ownership.', '${owner}';
       END IF;
       IF v_owner <> '${owner}' THEN
         EXECUTE format('ALTER SCHEMA %I OWNER TO %I', '${schema}', '${owner}');
       END IF;
       FOR v_obj IN
         SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS object_owner
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = '${schema}'
            AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
       LOOP
         IF v_obj.object_owner <> '${owner}' THEN
           EXECUTE format('ALTER %s %I.%I OWNER TO %I',
             CASE WHEN v_obj.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
             '${schema}', v_obj.relname, '${owner}');
         END IF;
       END LOOP;
       FOR v_obj IN
         SELECT p.oid::regprocedure AS signature, pg_get_userbyid(p.proowner) AS object_owner
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = '${schema}'
       LOOP
         IF v_obj.object_owner <> '${owner}' THEN
           EXECUTE format('ALTER FUNCTION %s OWNER TO %I', v_obj.signature, '${owner}');
         END IF;
       END LOOP;
     END;
     $bar_local_owner$`] : []),
    `     DO $bar_local_security$
     DECLARE
       v_fn regprocedure;
       v_missing text;
     BEGIN
       SELECT a.function_name INTO v_missing
         FROM ${schemaId}.runtime_function_allowlist a
        WHERE NOT EXISTS (
          SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = '${schema}'
             AND p.proname = a.function_name
        )
        ORDER BY a.function_name
        LIMIT 1;
       IF v_missing IS NOT NULL THEN
         RAISE EXCEPTION 'Allowlisted runtime function % is missing from the restored schema.', v_missing;
       END IF;
       FOR v_fn IN
         SELECT p.oid::regprocedure
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = '${schema}'
            AND p.proname IN (SELECT function_name FROM ${schemaId}.runtime_function_allowlist)
       LOOP
         EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', v_fn);
         EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, ${schema}', v_fn);
         EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
         EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, '${runtimeRole}');
         EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', v_fn, '${runtimeRole}');
       END LOOP;
     END;
     $bar_local_security$`,
    `DO $bar_local_connect$
     BEGIN
       EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
       EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), '${runtimeRole}');
       EXECUTE format('REVOKE CREATE ON DATABASE %I FROM %I', current_database(), '${runtimeRole}');
       EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), '${runtimeRole}');
     END;
     $bar_local_connect$`
  ]
  return statements
}

export async function restoreRuntimeSecurity(
  client: VerificationClient,
  options: RestoreRuntimeSecurityOptions = {}
): Promise<RestoreRuntimeSecurityReport> {
  const schema = assertRuntimeIdentifier(options.schema ?? 'bar_local', 'schema')
  const runtimeRole = assertRuntimeIdentifier(options.runtimeRole ?? 'bar_local_runtime', 'runtime role')
  const migrationOwner = assertRuntimeIdentifier(options.migrationOwner ?? 'bar_local_migrator', 'migration owner')
  const identity = await client.query(
    `SELECT current_user AS current_user, pg_get_userbyid(nspowner) AS schema_owner
       FROM pg_namespace WHERE nspname = $1`,
    [schema]
  )
  if (identity.rows.length !== 1) {
    throw new BackupToolError('RESTORE_SECURITY_FAILED', `The restored database has no ${schema} schema to secure.`)
  }
  const currentUser = asText(rowValue(identity.rows[0], 'current_user'))
  const schemaOwner = asText(rowValue(identity.rows[0], 'schema_owner'))
  if (currentUser !== migrationOwner || schemaOwner !== migrationOwner) {
    throw new BackupToolError(
      'RESTORE_SECURITY_OWNER_MISMATCH',
      `The restored schema owner is ${schemaOwner || 'unknown'} and the restoring role is ${currentUser || 'unknown'}; expected migration owner ${migrationOwner}. Refusing to grant runtime access.`
    )
  }
  const statements = buildRuntimeSecurityStatements({ schema, runtimeRole, migrationOwner })
  for (const statement of statements) {
    await client.query(statement)
  }
  return {
    ok: true,
    runtime_role: runtimeRole,
    migration_owner: migrationOwner,
    schema,
    statements_executed: statements.length
  }
}

async function runtimeSecurityCheck(
  client: VerificationClient,
  name: string,
  sql: string,
  params: readonly unknown[],
  detail: string
): Promise<VerificationCheck> {
  try {
    const result = await client.query(sql, params)
    const violations = asInteger(rowValue(result.rows[0], 'violations'))
    return { name, status: violations === 0 ? 'pass' : 'fail', violations, detail }
  } catch (error) {
    return { name, status: 'fail', violations: 1, detail: `${detail} The privilege query could not be completed: ${errorDetail(error)}` }
  }
}

function isPermissionDenied(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '42501')
}

function errorDetail(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown error'
  const record = error as { code?: unknown; detail?: unknown; message?: unknown }
  const code = typeof record.code === 'string' ? record.code : 'unknown'
  const detail = typeof record.detail === 'string' ? record.detail : null
  const message = typeof record.message === 'string' ? record.message : null
  return [code, detail, message].filter(Boolean).join(' / ')
}

function normalizeEvidence(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => asText(entry)).filter(Boolean).slice(0, 10)
  }
  const single = asText(value)
  return single ? [single] : []
}

async function inspectViolations(
  client: VerificationClient,
  name: string,
  sql: string,
  detail: string,
  params: readonly unknown[] = []
): Promise<VerificationCheck> {
  try {
    const result = await client.query(sql, params)
    const violations = asInteger(rowValue(result.rows[0], 'violations'))
    const evidence = normalizeEvidence(rowValue(result.rows[0], 'evidence'))
    return { name, status: violations === 0 ? 'pass' : 'fail', violations, detail, ...(evidence.length ? { evidence } : {}) }
  } catch {
    return { name, status: 'fail', violations: 1, detail: `${detail} The invariant query could not be completed.` }
  }
}

export async function probeRuntimeSecurity(
  connect: () => Promise<VerificationClient>,
  runtimeRole = 'bar_local_runtime',
  schema = 'bar_local'
): Promise<VerificationCheck[]> {
  const role = assertRuntimeIdentifier(runtimeRole, 'runtime role')
  assertRuntimeIdentifier(schema, 'schema')
  let client: VerificationClient & { end?: () => Promise<void> } | null = null
  try {
    client = await connect()
  } catch (error) {
    return [{
      name: 'runtime_authenticated_connectivity',
      status: 'fail',
      violations: 1,
      detail: `The runtime role could not authenticate against the restored database: ${errorDetail(error)}.`
    }]
  }
  const checks: VerificationCheck[] = []
  try {
    let authority: Record<string, unknown> | null = null
    try {
      const read = await client.query(
        `SELECT current_user::text AS current_user, bar_local.service_authority() AS authority`
      )
      const row = read.rows[0]
      const currentUser = asText(rowValue(row, 'current_user'))
      const rawAuthority = rowValue(row, 'authority')
      authority = rawAuthority && typeof rawAuthority === 'object' && !Array.isArray(rawAuthority)
        ? rawAuthority as Record<string, unknown>
        : null
      if (currentUser !== role) {
        checks.push({
          name: 'runtime_authenticated_connectivity',
          status: 'fail',
          violations: 1,
          detail: `The authenticated runtime user is ${currentUser || 'unknown'}, not ${role}.`
        })
      } else if (!authority) {
        checks.push({
          name: 'runtime_authenticated_connectivity',
          status: 'fail',
          violations: 1,
          detail: 'The runtime role connected but could not read the commissioned authority.'
        })
      } else {
        checks.push({
          name: 'runtime_authenticated_connectivity',
          status: 'pass',
          violations: 0,
          detail: `The runtime role authenticated and read the restored authority as ${role}.`
        })
      }
    } catch (error) {
      checks.push({
        name: 'runtime_authenticated_connectivity',
        status: 'fail',
        violations: 1,
        detail: `The runtime role could not read the restored authority: ${errorDetail(error)}.`
      })
    }

    if (authority) {
      const authorityId = asText(rowValue(authority, 'authority_id'))
      const businessId = asText(rowValue(authority, 'business_id'))
      const epoch = asText(rowValue(authority, 'authority_epoch'))
      const envelope = {
        contract_version: 1,
        operation_id: randomUUID(),
        command: 'sale.commit',
        authority_id: authorityId,
        authority_epoch: Number(epoch) || 1,
        business_id: businessId,
        outlet_id: randomUUID(),
        device_id: randomUUID(),
        payload: {}
      }
      try {
        await client.query(
          `SELECT bar_local.cmd_sale_commit($1::text, $2::uuid, $3::jsonb, $4::text, $5::text)`,
          [createHash('sha256').update(randomBytes(32)).digest('hex'), randomUUID(), JSON.stringify(envelope), 'a'.repeat(64), null]
        )
        checks.push({
          name: 'runtime_allowlisted_command_access',
          status: 'fail',
          violations: 1,
          detail: 'The runtime role executed the allowlisted commit command without an authenticated session.'
        })
      } catch (error) {
        const record = error && typeof error === 'object' ? error as { code?: unknown; detail?: unknown } : {}
        if (isPermissionDenied(error)) {
          checks.push({
            name: 'runtime_allowlisted_command_access',
            status: 'fail',
            violations: 1,
            detail: 'The runtime role was denied the allowlisted commit command.'
          })
        } else if (record.code === 'BL001' && record.detail === 'AUTH_INVALID') {
          checks.push({
            name: 'runtime_allowlisted_command_access',
            status: 'pass',
            violations: 0,
            detail: 'The runtime role reached the allowlisted commit command and the invalid session was rejected without a privilege error.'
          })
        } else {
          checks.push({
            name: 'runtime_allowlisted_command_access',
            status: 'fail',
            violations: 1,
            detail: `The allowlisted commit command did not behave as expected: ${errorDetail(error)}.`
          })
        }
      }
    }

    try {
      await client.query('SELECT 1 FROM bar_local.sales LIMIT 1')
      checks.push({ name: 'runtime_table_read_denied', status: 'fail', violations: 1, detail: 'The runtime role can read Bar tables directly.' })
    } catch (error) {
      checks.push(isPermissionDenied(error)
        ? { name: 'runtime_table_read_denied', status: 'pass', violations: 0, detail: 'Direct Bar table reads are denied to the runtime role.' }
        : { name: 'runtime_table_read_denied', status: 'fail', violations: 1, detail: `Direct table read was not denied cleanly: ${errorDetail(error)}.` })
    }

    try {
      await client.query('BEGIN')
      let wrote = false
      try {
        await client.query("INSERT INTO bar_local.runtime_function_allowlist (function_name) VALUES ('__bar_restore_probe')")
        wrote = true
      } catch {
        wrote = false
      } finally {
        await client.query('ROLLBACK').catch(() => {})
      }
      checks.push(wrote
        ? { name: 'runtime_table_write_denied_live', status: 'fail', violations: 1, detail: 'The runtime role can write Bar tables directly.' }
        : { name: 'runtime_table_write_denied_live', status: 'pass', violations: 0, detail: 'Direct Bar table writes are denied to the runtime role.' })
    } catch (error) {
      checks.push({ name: 'runtime_table_write_denied_live', status: 'fail', violations: 1, detail: `Direct table write could not be proven denied: ${errorDetail(error)}.` })
    }

    try {
      await client.query('BEGIN')
      let created = false
      try {
        await client.query('CREATE TABLE bar_local.__bar_restore_probe (id integer)')
        created = true
      } catch {
        created = false
      } finally {
        await client.query('ROLLBACK').catch(() => {})
      }
      checks.push(created
        ? { name: 'runtime_ddl_denied', status: 'fail', violations: 1, detail: 'The runtime role can create tables in the Bar schema.' }
        : { name: 'runtime_ddl_denied', status: 'pass', violations: 0, detail: 'DDL in the Bar schema is denied to the runtime role.' })
    } catch (error) {
      checks.push({ name: 'runtime_ddl_denied', status: 'fail', violations: 1, detail: `DDL denial could not be proven: ${errorDetail(error)}.` })
    }

    try {
      await client.query("SELECT bar_local.sha256_hex('restore-probe')")
      checks.push({ name: 'runtime_helper_function_denied_live', status: 'fail', violations: 1, detail: 'The runtime role can execute internal helper functions.' })
    } catch (error) {
      checks.push(isPermissionDenied(error)
        ? { name: 'runtime_helper_function_denied_live', status: 'pass', violations: 0, detail: 'Internal helper function execution is denied to the runtime role.' }
        : { name: 'runtime_helper_function_denied_live', status: 'fail', violations: 1, detail: `Helper function denial was not a privilege error: ${errorDetail(error)}.` })
    }
  } finally {
    if (client?.end) await client.end().catch(() => {})
  }
  return checks
}

/** Read-only snapshot probe: never count recovery's write prohibition as a
 * runtime permission denial. Writable restore verification remains unchanged. */
export async function probeReadonlyRuntimeSecurity(connect: () => Promise<VerificationClient>, runtimeRole = 'bar_local_runtime'): Promise<VerificationCheck[]> {
  let client: (VerificationClient & { end?: () => Promise<void> }) | null = null
  try {
    client = await connect()
    const row = (await client.query("SELECT current_user::text AS role, pg_is_in_recovery() AS recovering, current_setting('transaction_read_only') AS read_only, bar_local.service_authority() AS authority")).rows[0]
    const valid = row?.role === runtimeRole && row.recovering === true && row.read_only === 'on' && row.authority !== null && typeof row.authority === 'object'
    const checks: VerificationCheck[] = [{ name: 'runtime_readonly_snapshot_connectivity', status: valid ? 'pass' : 'fail', violations: valid ? 0 : 1, detail: 'Runtime authenticates to a paused read-only copy. Writable command probes and activation remain unqualified.' }]
    try {
      await client.query('SELECT 1 FROM bar_local.sales LIMIT 1')
      checks.push({ name: 'runtime_snapshot_table_read_denied', status: 'fail', violations: 1 })
    } catch (error) { checks.push({ name: 'runtime_snapshot_table_read_denied', status: isPermissionDenied(error) ? 'pass' : 'fail', violations: isPermissionDenied(error) ? 0 : 1 }) }
    return checks
  } catch (error) { return [{ name: 'runtime_readonly_snapshot_connectivity', status: 'fail', violations: 1, detail: errorDetail(error) }] }
  finally { await client?.end?.().catch(() => {}) }
}

async function createRuntimeProbeClient(options: {
  host: string
  port: number
  database: string
  user: string
  password: string
}): Promise<VerificationClient> {
  const client = new PgClient({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password: options.password,
    application_name: 'bar-local-restore-probe',
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000
  })
  await client.connect()
  return {
    query: (text: string, params?: readonly unknown[]) => client.query(text, params as unknown[] | undefined),
    end: () => client.end()
  } as VerificationClient & { end: () => Promise<void> }
}

function resolveRuntimeProbe(options: RestoreVerificationOptions): RuntimeProbeOptions | null {
  if (options.runtimeProbe) return options.runtimeProbe
  const env = process.env
  const host = (options.runtimeHost ?? env.BAR_LOCAL_DB_HOST ?? '').trim()
  const portValue = options.runtimePort ?? Number(env.BAR_LOCAL_DB_PORT ?? 0)
  const port = Number.isInteger(portValue) ? Number(portValue) : 0
  const database = (options.runtimeDatabase ?? options.database ?? env.BAR_LOCAL_DB_NAME ?? '').trim()
  const user = (options.runtimeUser ?? env.BAR_LOCAL_RUNTIME_USER ?? 'bar_local_runtime').trim()
  const password = options.runtimePassword ?? env.BAR_LOCAL_RUNTIME_PASSWORD ?? env.BAR_LOCAL_DB_PASSWORD ?? ''
  if (!host || port < 1 || port > 65_535 || !database || !user || !password.trim()) return null
  return {
    connect: () => createRuntimeProbeClient({ host, port, database, user, password })
  }
}

export async function verifyRuntimeSecurity(
  client: VerificationClient,
  options: RestoreRuntimeSecurityOptions = {}
): Promise<VerificationCheck[]> {
  const schema = assertRuntimeIdentifier(options.schema ?? 'bar_local', 'schema')
  const runtimeRole = assertRuntimeIdentifier(options.runtimeRole ?? 'bar_local_runtime', 'runtime role')
  const params = [runtimeRole, schema] as const
  const checks: VerificationCheck[] = []
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_schema_usage',
    `/* check:runtime_schema_usage */
     SELECT CASE WHEN has_schema_privilege($1, $2, 'USAGE') THEN 0 ELSE 1 END::int AS violations`,
    params,
    'The runtime role must have USAGE on the Bar schema.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_schema_create_denied',
    `/* check:runtime_schema_create_denied */
     SELECT CASE WHEN has_schema_privilege($1, $2, 'CREATE') THEN 1 ELSE 0 END::int AS violations`,
    params,
    'The runtime role must not have CREATE on the Bar schema.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_database_connect',
    `/* check:runtime_database_connect */
     SELECT CASE WHEN has_database_privilege($1, current_database(), 'CONNECT') THEN 0 ELSE 1 END::int AS violations`,
    [runtimeRole],
    'The runtime role must retain CONNECT on the restored database.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_database_create_denied',
    `/* check:runtime_database_create_denied */
     SELECT CASE WHEN has_database_privilege($1, current_database(), 'CREATE') THEN 1 ELSE 0 END::int AS violations`,
    [runtimeRole],
    'The runtime role must not have CREATE on the restored database.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_table_write_denied',
    `/* check:runtime_table_write_denied */
     SELECT count(*)::int AS violations
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $2
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (has_table_privilege($1, c.oid, 'SELECT')
          OR has_table_privilege($1, c.oid, 'INSERT')
          OR has_table_privilege($1, c.oid, 'UPDATE')
          OR has_table_privilege($1, c.oid, 'DELETE')
          OR has_table_privilege($1, c.oid, 'TRUNCATE'))`,
    params,
    'The runtime role must not have direct table read or write privileges.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_sequence_write_denied',
    `/* check:runtime_sequence_write_denied */
     SELECT count(*)::int AS violations
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $2
        AND c.relkind = 'S'
        AND (has_sequence_privilege($1, c.oid, 'USAGE')
          OR has_sequence_privilege($1, c.oid, 'SELECT')
          OR has_sequence_privilege($1, c.oid, 'UPDATE'))`,
    params,
    'The runtime role must not have direct sequence privileges.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_allowlisted_function_access',
    `/* check:runtime_allowlisted_function_access */
     SELECT count(*)::int AS violations
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $2
        AND p.proname IN (SELECT function_name FROM "${schema}".runtime_function_allowlist)
        AND NOT has_function_privilege($1, p.oid, 'EXECUTE')`,
    [runtimeRole, schema],
    'Every allowlisted command/service function must be executable by the runtime role.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_helper_function_denied',
    `/* check:runtime_helper_function_denied */
     SELECT count(*)::int AS violations
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $2
        AND p.proname NOT IN (SELECT function_name FROM "${schema}".runtime_function_allowlist)
        AND has_function_privilege($1, p.oid, 'EXECUTE')`,
    [runtimeRole, schema],
    'Internal helper functions must not be executable by the runtime role.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'allowlisted_functions_security_definer',
    `/* check:allowlisted_functions_security_definer */
     SELECT count(*)::int AS violations
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1
        AND p.proname IN (SELECT function_name FROM "${schema}".runtime_function_allowlist)
        AND (
          NOT p.prosecdef
          OR NOT EXISTS (
            SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS setting
             WHERE setting LIKE 'search_path=%'
               AND setting LIKE '%pg_catalog%'
               AND setting LIKE '%bar_local%'
          )
        )`,
    [schema],
    'Allowlisted functions must be SECURITY DEFINER with a fixed pg_catalog, bar_local search path.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_role_not_object_owner',
    `/* check:runtime_role_not_object_owner */
     SELECT count(*)::int AS violations
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $2
        AND pg_get_userbyid(c.relowner) = $1`,
    params,
    'The runtime role must not own restored database objects.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_schema_owner_not_runtime',
    `/* check:runtime_schema_owner_not_runtime */
     SELECT COALESCE((
       SELECT CASE WHEN pg_get_userbyid(nspowner) = $1 THEN 1 ELSE 0 END
         FROM pg_namespace WHERE nspname = $2
     ), 1)::int AS violations`,
    params,
    'The runtime role must not own the Bar schema.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_role_not_superuser',
    `/* check:runtime_role_not_superuser */
     SELECT COALESCE((
       SELECT CASE WHEN rolsuper THEN 1 ELSE 0 END FROM pg_roles WHERE rolname = $1
     ), 1)::int AS violations`,
    [runtimeRole],
    'The runtime role must not be a PostgreSQL superuser.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_role_attributes_safe',
    `/* check:runtime_role_attributes_safe */
     SELECT COALESCE((
       SELECT CASE WHEN rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls THEN 1 ELSE 0 END
         FROM pg_roles WHERE rolname = $1
     ), 1)::int AS violations`,
    [runtimeRole],
    'The runtime role must not create databases or roles, replicate, or bypass row level security.'
  ))
  checks.push(await runtimeSecurityCheck(
    client,
    'runtime_default_privileges_denied',
    `/* check:runtime_default_privileges_denied */
     SELECT count(*)::int AS violations
       FROM pg_default_acl d
       JOIN pg_namespace n ON n.oid = d.defaclnamespace
       CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       LEFT JOIN pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = $2
        AND (a.grantee = 0 OR r.rolname = $1)`,
    params,
    'Default privileges in the Bar schema must not grant PUBLIC or the runtime role any access.'
  ))
  if (options.migrationOwner) {
    const owner = assertRuntimeIdentifier(options.migrationOwner, 'migration owner')
    checks.push(await runtimeSecurityCheck(
      client,
      'runtime_role_not_member_of_owner',
      `/* check:runtime_role_not_member_of_owner */
       SELECT CASE WHEN pg_has_role($1, $2, 'MEMBER') THEN 1 ELSE 0 END::int AS violations`,
      [runtimeRole, owner],
      'The runtime role must not inherit the migration owner role.'
    ))
    checks.push(await runtimeSecurityCheck(
      client,
      'objects_owned_by_migration_owner',
      `/* check:objects_owned_by_migration_owner */
       SELECT (
         (SELECT count(*) FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $2 AND pg_get_userbyid(c.relowner) <> $1)
         +
         (SELECT count(*) FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = $2 AND pg_get_userbyid(p.proowner) <> $1)
       )::int AS violations`,
       [owner, schema],
       'Restored tables and functions must be owned by the migration owner, not the runtime role.'
     ))
   }
  if (options.runtimeProbe) {
    checks.push(...await (options.readOnlySnapshot ? probeReadonlyRuntimeSecurity(options.runtimeProbe.connect, runtimeRole) : probeRuntimeSecurity(options.runtimeProbe.connect, runtimeRole, schema)))
  } else {
    checks.push({
      name: 'runtime_authenticated_connectivity',
      status: 'fail',
      violations: 1,
      detail: 'Authenticated runtime connectivity was not proven; supply runtime credentials or a runtime probe before activation.'
    })
  }
  return checks
}

export function createPgRestoreSpec(
  target: PostgresTarget,
  dumpPath: string,
  options: { timeoutMs?: number; command?: string } = {}
): CommandSpec {
  return {
    command: options.command ?? 'pg_restore',
    args: [
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      `--host=${target.host}`,
      `--port=${target.port}`,
      `--username=${target.user}`,
      `--dbname=${target.database}`,
      dumpPath
    ],
    env: buildToolEnv(target.password),
    timeoutMs: options.timeoutMs ?? 60 * 60 * 1000
  }
}

export async function restoreBackupPackageToDatabase(options: RestoreBackupOptions): Promise<RestoreBackupReport> {
  const verification = assertVerificationTarget(options.verification)
  const targetHost = options.target.host.trim().toLowerCase()
  if (targetHost !== verification.host
    || options.target.port !== verification.port
    || options.target.database !== verification.database
    || options.target.user !== verification.user) {
    throw new BackupToolError('RESTORE_TARGET_REJECTED', 'The restore connection target does not match the verified isolated target.')
  }
  const authorization = assertRestoreAuthorization(options.authorization, options.target.database)
  if (!options.preflightClient) {
    throw new BackupToolError(
      'RESTORE_PREFLIGHT_REQUIRED',
      'A restore requires a connected preflight client so the target can be proven empty before writing.'
    )
  }
  if (!options.securityClient) {
    throw new BackupToolError(
      'RESTORE_SECURITY_REQUIRED',
      'A restore requires a connected security client so least-privilege ownership and grants are restored before verification.'
    )
  }
  await assertRestoreTargetEmpty(options.preflightClient, options.target.database)
  const verified = await verifyBackupPackage(options.manifestPath)
  if (verified.manifest.source.database === options.target.database) {
    throw new BackupToolError('RESTORE_TARGET_REJECTED', 'Restore verification cannot target the source database.')
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bar-local-restore-'))
  const dumpPath = path.join(directory, 'backup.pgcustom')
  try {
    const proof = await decryptFile({
      encryptedPath: verified.backupPath,
      outputPath: dumpPath,
      key: options.encryptionKey,
      expectedSha256: verified.manifest.file.sha256,
      expectedPlaintextSha256: verified.manifest.file.plaintext_sha256
    })
    const spawned = spawnCommand(createPgRestoreSpec(options.target, dumpPath, {
      command: options.pgRestoreCommand,
      timeoutMs: options.timeoutMs
    }))
    spawned.stdout.resume()
    try {
      await spawned.completion
    } catch (error) {
      await spawned.completion.catch(() => {})
      throw new BackupToolError(
        'RESTORE_COMMAND_FAILED',
        `The database restore did not complete: ${error instanceof Error ? error.message : 'unknown restore error'}`
      )
    }
    const security = await restoreRuntimeSecurity(options.securityClient, {
      ...options.security,
      migrationOwner: options.security?.migrationOwner ?? options.target.user
    })
    return {
      manifest: verified.manifest,
      backup_sha256: verified.sha256,
      plaintext_sha256: proof.plaintextSha256,
      dump_bytes: proof.plaintextBytes,
      authorization: {
        authorized_by: authorization.authorized_by,
        reason: authorization.reason,
        target_database: authorization.target_database
      },
      security,
      restored_to: {
        host: options.target.host,
        port: options.target.port,
        database: options.target.database
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

function rowValue(row: Record<string, unknown> | undefined, key: string): unknown {
  return row ? row[key] : undefined
}

function asInteger(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'bigint' || typeof value === 'number') return String(value)
  return ''
}

function asBigIntOrNull(value: unknown): bigint | null {
  try {
    return BigInt(asText(value) || '0')
  } catch {
    return null
  }
}

async function readMigrationChecksums(directory: string): Promise<Array<{ version: string; checksum: string }>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const result: Array<{ version: string; checksum: string }> = []
  for (const file of files) {
    const text = await readFile(path.join(directory, file), 'utf8')
    result.push({ version: file, checksum: sha256Hex(Buffer.from(text, 'utf8')) })
  }
  return result
}

async function countViolations(
  client: VerificationClient,
  name: string,
  sql: string,
  detail?: string
): Promise<VerificationCheck> {
  const result = await client.query(sql)
  const violations = asInteger(rowValue(result.rows[0], 'violations'))
  return { name, status: violations === 0 ? 'pass' : 'fail', violations, ...(detail ? { detail } : {}) }
}

export async function verifyRestoredDatabase(
  client: VerificationClient,
  options: RestoreVerificationOptions
): Promise<RestoreVerificationReport> {
  const generatedAt = new Date().toISOString()
  const checks: VerificationCheck[] = []
  const localMigrations = await readMigrationChecksums(options.migrationsDir)

  let appliedRows: Array<Record<string, unknown>>
  try {
    const result = await client.query('SELECT version, checksum FROM bar_local.schema_migrations ORDER BY version')
    appliedRows = result.rows
  } catch {
    throw new BackupToolError('RESTORE_VERIFICATION_FAILED', 'The restored database has no readable bar_local.schema_migrations table.')
  }
  const applied = appliedRows.map((row) => ({
    version: asText(rowValue(row, 'version')),
    checksum: asText(rowValue(row, 'checksum'))
  }))
  const localMap = new Map(localMigrations.map((entry) => [entry.version, entry.checksum]))
  const appliedMap = new Map(applied.map((entry) => [entry.version, entry.checksum]))
  const missingLocal = localMigrations.filter((entry) => !appliedMap.has(entry.version)).map((entry) => entry.version)
  const unknownApplied = applied.filter((entry) => !localMap.has(entry.version)).map((entry) => entry.version)
  const mismatched = applied
    .filter((entry) => localMap.has(entry.version) && localMap.get(entry.version) !== entry.checksum)
    .map((entry) => entry.version)
  const schemaFails = mismatched.length > 0
    || unknownApplied.length > 0
    || (missingLocal.length > 0 && !options.allowOlderSchema)
  checks.push({
    name: 'schema_migrations_match_local',
    status: schemaFails ? 'fail' : 'pass',
    violations: mismatched.length + unknownApplied.length + (options.allowOlderSchema ? 0 : missingLocal.length),
    detail: schemaFails
      ? 'Applied migration bytes or version set do not match local migration files.'
      : options.allowOlderSchema && missingLocal.length > 0
        ? `Older schema accepted; local migrations not present in backup: ${missingLocal.join(', ')}`
        : 'All applied migrations match local files.'
  })

  let authority: RestoreVerificationReport['authority'] = null
  let authorityFailures = 0
  try {
    const result = await client.query(
      `SELECT authority_id::text AS authority_id, authority_epoch::text AS authority_epoch,
              business_id::text AS business_id, commissioned_at::text AS commissioned_at,
              catalogue_version::text AS catalogue_version, entitlement_version::text AS entitlement_version,
              entitlement_features
         FROM bar_local.authority WHERE singleton`
    )
    if (result.rows.length !== 1) {
      authorityFailures += 1
    } else {
      const row = result.rows[0]
      const authorityId = asText(rowValue(row, 'authority_id'))
      const epoch = asText(rowValue(row, 'authority_epoch'))
      const businessId = asText(rowValue(row, 'business_id'))
      const epochValue = asBigIntOrNull(epoch)
      const features = Array.isArray(rowValue(row, 'entitlement_features'))
        ? (rowValue(row, 'entitlement_features') as unknown[]).map((value) => asText(value)).filter(Boolean)
        : []
      if (!/^[0-9a-f-]{36}$/i.test(authorityId) || !/^[0-9a-f-]{36}$/i.test(businessId)
        || epochValue === null || epochValue <= 0n) {
        authorityFailures += 1
      }
      if (options.expectedAuthorityId && authorityId !== options.expectedAuthorityId) authorityFailures += 1
      if (options.expectedAuthorityEpoch && epoch !== String(options.expectedAuthorityEpoch)) authorityFailures += 1
      authority = {
        authority_id: authorityId,
        authority_epoch: epoch,
        business_id: businessId,
        commissioned_at: asText(rowValue(row, 'commissioned_at')) || null,
        catalogue_version: asText(rowValue(row, 'catalogue_version')) || null,
        entitlement_version: asText(rowValue(row, 'entitlement_version')) || null,
        entitlement_features: features
      }
      const businessCount = await client.query('SELECT count(*)::int AS businesses FROM bar_local.business WHERE id = $1', [businessId])
      if (asInteger(rowValue(businessCount.rows[0], 'businesses')) !== 1) authorityFailures += 1
    }
  } catch {
    authorityFailures += 1
  }
  checks.push({
    name: 'authority_identity_valid',
    status: authorityFailures === 0 ? 'pass' : 'fail',
    violations: authorityFailures,
    detail: authorityFailures === 0
      ? 'Exactly one commissioned authority and its business row are present.'
      : 'Authority identity, epoch, business linkage or expected identity is invalid.'
  })

  const appliedHas = (prefix: string): boolean => applied.some((entry) => entry.version.startsWith(prefix))
  checks.push(await countViolations(
    client,
    'sales_totals_balanced',
    `SELECT count(*)::int AS violations FROM bar_local.sales
      WHERE round(total, 2) <> round(subtotal + tax + tip, 2)`
  ))
  checks.push(await countViolations(
    client,
    'sale_line_totals_balanced',
    `SELECT count(*)::int AS violations FROM bar_local.sale_lines
      WHERE round(line_total, 2) <> round(line_subtotal - line_discount + line_tax, 2)`
  ))
  checks.push(await countViolations(
    client,
    'journal_entries_balanced',
    `SELECT count(*)::int AS violations FROM (
       SELECT entry_id FROM bar_local.journal_lines
        GROUP BY entry_id
       HAVING round(sum(debit), 2) <> round(sum(credit), 2)
     ) unbalanced`
  ))
  checks.push(await countViolations(
    client,
    'cashup_variance_consistent',
    `SELECT count(*)::int AS violations FROM bar_local.cashups
      WHERE round(variance, 2) <> round(counted_cash - expected_cash, 2)`
  ))
  checks.push(await countViolations(
    client,
    'stock_balance_matches_movements',
    `SELECT count(*)::int AS violations FROM bar_local.stock_balances sb
       LEFT JOIN (
         SELECT business_id, outlet_id, product_id, sum(delta) AS delta
           FROM bar_local.stock_movements
          GROUP BY business_id, outlet_id, product_id
       ) movement ON movement.business_id = sb.business_id
                  AND movement.outlet_id = sb.outlet_id
                  AND movement.product_id = sb.product_id
      WHERE round(sb.quantity, 6) <> round(COALESCE(movement.delta, 0), 6)`
  ))
  checks.push(await countViolations(
    client,
    'voucher_balance_matches_ledger',
    `SELECT count(*)::int AS violations FROM bar_local.vouchers v
       LEFT JOIN (
         SELECT voucher_id, sum(delta) AS delta
           FROM bar_local.voucher_ledger
          GROUP BY voucher_id
       ) ledger ON ledger.voucher_id = v.id
      WHERE round(v.balance, 2) <> round(COALESCE(ledger.delta, 0), 2)`
  ))
  checks.push(await countViolations(
    client,
    'sale_tender_total_matches',
    `/* check:sale_tender_total_matches */
     SELECT count(*)::int AS violations FROM bar_local.sales s
      WHERE round(s.total, 2) <> round(COALESCE((
              SELECT sum(t.amount) FROM bar_local.sale_tenders t WHERE t.sale_id = s.id
            ), 0), 2)`
  ))
  checks.push(await inspectViolations(
    client,
    'sale_payment_status_consistent',
    `WITH problematic AS (
       SELECT s.id
         FROM bar_local.sales s
        WHERE (s.status = 'completed' AND (s.total < 0 OR s.original_sale_id IS NOT NULL))
           OR (s.status = 'returned' AND s.original_sale_id IS NULL AND s.total < 0)
           OR (s.status = 'voided' AND s.total < 0)
           OR (s.original_sale_id IS NOT NULL AND s.status NOT IN ('returned', 'voided'))
           OR (s.total <> 0 AND NOT EXISTS (SELECT 1 FROM bar_local.sale_tenders t WHERE t.sale_id = s.id))
     )
     SELECT count(*)::int AS violations,
            COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
       FROM problematic`,
    'Every financially meaningful sale must have tender evidence and a status consistent with returns and voids.'
  ))
  checks.push(await inspectViolations(
    client,
    'journal_entries_have_lines',
    `WITH problematic AS (
       SELECT j.id
         FROM bar_local.journal_entries j
         LEFT JOIN bar_local.journal_lines l ON l.entry_id = j.id
        GROUP BY j.id
       HAVING count(l.id) = 0
           OR round(sum(l.debit), 2) <> round(sum(l.credit), 2)
     )
     SELECT count(*)::int AS violations,
            COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
       FROM problematic`,
    'Every journal entry must contain lines and balance debits against credits.'
  ))
  checks.push(await inspectViolations(
    client,
    'journal_source_links_unique',
      `WITH problematic AS (
         SELECT source_type, source_id
           FROM bar_local.journal_entries
          WHERE source_id IS NOT NULL
            AND source_type IN ('sale', 'sale.return', 'sale.void', 'expense', 'expense.void', 'ap_invoice', 'payroll_run')
          GROUP BY source_type, source_id
         HAVING count(*) > 1
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(source_type || ':' || source_id::text) FROM problematic), ARRAY[]::text[]) AS evidence
        FROM problematic`,
      'A sale, expense, supplier invoice or payroll source document must not be posted to more than one journal entry.'
  ))
  checks.push(await inspectViolations(
    client,
    'journal_period_integrity',
    `WITH problematic AS (
       SELECT id FROM bar_local.journal_entries
        WHERE period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
           OR period <> to_char(entry_date, 'YYYY-MM')
     )
     SELECT count(*)::int AS violations,
            COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
       FROM problematic`,
    'Journal periods must be valid and match the entry date.'
  ))
  checks.push(await countViolations(
    client,
    'journal_accounts_exist',
    `SELECT count(*)::int AS violations
       FROM bar_local.journal_lines l
       LEFT JOIN bar_local.accounting_accounts a ON a.code = l.account_code
      WHERE a.code IS NULL`
  ))
  checks.push(await inspectViolations(
    client,
    'journal_operations_committed',
    `WITH problematic AS (
       SELECT j.id
         FROM bar_local.journal_entries j
         LEFT JOIN bar_local.operations o ON o.operation_id = j.operation_id
        WHERE o.operation_id IS NULL
           OR o.status <> 'committed'
           OR o.business_id <> j.business_id
     )
     SELECT count(*)::int AS violations,
            COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
       FROM problematic`,
    'Every journal entry must be linked to the committed operation that produced it.'
  ))
  checks.push(await countViolations(
    client,
    'stock_movements_have_balances',
    `WITH movement AS (
       SELECT business_id, outlet_id, product_id, sum(delta) AS delta
         FROM bar_local.stock_movements
        GROUP BY business_id, outlet_id, product_id
     )
     SELECT count(*)::int AS violations
       FROM movement m
       LEFT JOIN bar_local.stock_balances b
         ON b.business_id = m.business_id AND b.outlet_id = m.outlet_id AND b.product_id = m.product_id
      WHERE b.product_id IS NULL OR round(b.quantity, 6) <> round(m.delta, 6)`
  ))
  checks.push(await countViolations(
    client,
    'stock_balances_have_movements',
    `WITH movement AS (
       SELECT business_id, outlet_id, product_id
         FROM bar_local.stock_movements
        GROUP BY business_id, outlet_id, product_id
     )
     SELECT count(*)::int AS violations
       FROM bar_local.stock_balances b
       LEFT JOIN movement m
         ON m.business_id = b.business_id AND m.outlet_id = b.outlet_id AND m.product_id = b.product_id
      WHERE m.product_id IS NULL AND round(b.quantity, 6) <> 0`
  ))
  const recipeExclusion = appliedHas('0020_') ? 'AND jsonb_array_length(sl.recipe_snapshot) = 0' : ''
  checks.push(await inspectViolations(
    client,
    'stock_tracked_sales_have_movements',
    `WITH expected AS (
       SELECT sl.operation_id, sl.product_id
         FROM bar_local.sale_lines sl
         JOIN bar_local.sales s ON s.id = sl.sale_id
         JOIN bar_local.products p ON p.id = sl.product_id
        WHERE s.status IN ('completed', 'returned', 'voided')
          AND sl.quantity > 0 AND p.track_stock
          ${recipeExclusion}
        GROUP BY sl.operation_id, sl.product_id
     ), problematic AS (
       SELECT e.product_id AS id
         FROM expected e
        WHERE NOT EXISTS (
          SELECT 1 FROM bar_local.stock_movements m
           WHERE m.operation_id = e.operation_id AND m.product_id = e.product_id
             AND m.reason = 'sale.depletion'
        )
     )
     SELECT count(*)::int AS violations,
            COALESCE((SELECT array_agg(DISTINCT id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
       FROM problematic`,
    'Tracked products sold without a recipe must have a corresponding sale depletion movement.'
  ))
  checks.push(await inspectViolations(
    client,
    'stock_simple_depletion_matches',
    `WITH expected AS (
       SELECT sl.operation_id, sl.product_id, sum(sl.quantity) AS quantity
         FROM bar_local.sale_lines sl
         JOIN bar_local.sales s ON s.id = sl.sale_id
         JOIN bar_local.products p ON p.id = sl.product_id
        WHERE s.status IN ('completed', 'returned', 'voided')
          AND sl.quantity > 0 AND p.track_stock
          ${recipeExclusion}
        GROUP BY sl.operation_id, sl.product_id
     ), actual AS (
       SELECT operation_id, product_id, sum(delta) AS delta
         FROM bar_local.stock_movements
        WHERE reason = 'sale.depletion'
        GROUP BY operation_id, product_id
     ), problematic AS (
       SELECT e.operation_id AS id
         FROM expected e
         LEFT JOIN actual a ON a.operation_id = e.operation_id AND a.product_id = e.product_id
        WHERE a.product_id IS NULL OR round(a.delta, 6) <> round(-e.quantity, 6)
     )
     SELECT count(*)::int AS violations,
            COALESCE((SELECT array_agg(DISTINCT id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
       FROM problematic`,
    'Aggregate simple stock depletion must exactly equal the tracked quantity sold for the operation.'
  ))
  checks.push(await inspectViolations(
    client,
    'stock_return_restock_lineage',
    `WITH problematic AS (
       SELECT m.id
         FROM bar_local.stock_movements m
        WHERE m.reason = 'sale.return.restock'
          AND NOT EXISTS (
            SELECT 1 FROM bar_local.sales rs
             WHERE rs.operation_id = m.operation_id AND rs.original_sale_id IS NOT NULL
          )
     )
     SELECT count(*)::int AS violations,
            COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
       FROM problematic`,
    'Every return restock movement must belong to a return sale linked to its original sale.'
  ))
  checks.push(await inspectViolations(
    client,
    'stock_return_restock_within_depletion',
    `WITH restock AS (
       SELECT m.business_id, m.outlet_id, m.product_id, rs.original_sale_id, sum(m.delta) AS restocked
         FROM bar_local.stock_movements m
         JOIN bar_local.sales rs ON rs.operation_id = m.operation_id AND rs.original_sale_id IS NOT NULL
        WHERE m.reason = 'sale.return.restock'
        GROUP BY m.business_id, m.outlet_id, m.product_id, rs.original_sale_id
     ), depletion AS (
       SELECT m.business_id, m.outlet_id, m.product_id, os.id AS original_sale_id, -sum(m.delta) AS depleted
         FROM bar_local.stock_movements m
         JOIN bar_local.sales os ON os.operation_id = m.operation_id
        WHERE m.reason IN ('sale.depletion', 'sale.recipe.depletion')
        GROUP BY m.business_id, m.outlet_id, m.product_id, os.id
     ), problematic AS (
       SELECT r.original_sale_id AS id
         FROM restock r
         LEFT JOIN depletion d
           ON d.business_id = r.business_id AND d.outlet_id = r.outlet_id
          AND d.product_id = r.product_id AND d.original_sale_id = r.original_sale_id
        WHERE round(r.restocked, 6) > round(COALESCE(d.depleted, 0), 6)
     )
     SELECT count(*)::int AS violations,
            COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
       FROM problematic`,
    'Return restocks must never exceed the original immutable depletion for the same product and sale.'
  ))
  checks.push(await countViolations(
    client,
    'operation_receipt_identity',
    `SELECT count(*)::int AS violations FROM bar_local.operations o
      WHERE o.status = 'committed'
        AND (o.receipt IS NULL
          OR (o.receipt ->> 'operation_id') IS DISTINCT FROM o.operation_id::text
          OR (o.receipt ->> 'commit_sequence') IS DISTINCT FROM o.commit_sequence::text)`
  ))
  checks.push(await countViolations(
    client,
    'outbox_operation_committed',
    `SELECT count(*)::int AS violations FROM bar_local.outbox o
       LEFT JOIN bar_local.operations op ON op.operation_id = o.operation_id
      WHERE op.operation_id IS NULL
         OR op.status <> 'committed'
         OR op.commit_sequence IS DISTINCT FROM o.commit_sequence
         OR op.business_id <> o.business_id
         OR op.outlet_id <> o.outlet_id
         OR op.authority_epoch <> o.authority_epoch`
  ))
  checks.push(await countViolations(
    client,
    'acknowledged_operations_have_receipts',
    `SELECT count(*)::int AS violations FROM bar_local.operations o
      WHERE o.commit_sequence IS NOT NULL
        AND o.commit_sequence <= COALESCE((
              SELECT max(b.to_sequence) FROM bar_local.export_batches b WHERE b.acknowledged_at IS NOT NULL
            ), 0)
        AND (o.status <> 'committed' OR o.receipt IS NULL)`
  ))
  checks.push(await countViolations(
    client,
    'receipt_sequence_covers_max_receipt',
    `SELECT CASE WHEN c.receipt_sequence >= COALESCE((SELECT max(receipt_number) FROM bar_local.sales), 0) THEN 0 ELSE 1 END::int AS violations
       FROM bar_local.authority_counter c WHERE c.singleton`
  ))
  checks.push(await countViolations(
    client,
    'commit_sequence_covers_max_operation',
    `SELECT CASE WHEN c.commit_sequence >= COALESCE((SELECT max(commit_sequence) FROM bar_local.operations), 0) THEN 0 ELSE 1 END::int AS violations
       FROM bar_local.authority_counter c WHERE c.singleton`
  ))
  checks.push(await countViolations(
    client,
    'authority_counter_singleton',
    `SELECT CASE WHEN count(*) = 1 THEN 0 ELSE 1 END::int AS violations FROM bar_local.authority_counter`
  ))
  checks.push(await countViolations(
    client,
    'authority_commissioned',
    `SELECT CASE WHEN count(*) = 1 THEN 0 ELSE 1 END::int AS violations FROM bar_local.authority WHERE singleton AND commissioned_at IS NOT NULL`
  ))
  checks.push(await countViolations(
    client,
    'schema_migrations_present',
    `SELECT CASE WHEN count(*) > 0 THEN 0 ELSE 1 END::int AS violations FROM bar_local.schema_migrations`
  ))
  checks.push(await countViolations(
    client,
    'tenant_scope_integrity',
    `WITH a AS (SELECT business_id FROM bar_local.authority WHERE singleton)
     SELECT (SELECT count(*) FROM bar_local.outlets o, a WHERE o.business_id <> a.business_id)
          + (SELECT count(*) FROM bar_local.staff s, a WHERE s.business_id <> a.business_id)
          + (SELECT count(*) FROM bar_local.devices d, a WHERE d.business_id <> a.business_id)
          + (SELECT count(*) FROM bar_local.sales s, a WHERE s.business_id <> a.business_id)
          + (SELECT count(*) FROM bar_local.stock_balances sb, a WHERE sb.business_id <> a.business_id)
          + (SELECT count(*) FROM bar_local.journal_entries j, a WHERE j.business_id <> a.business_id) AS violations`
  ))
  checks.push(await inspectViolations(
    client,
    'customer_credit_tender_conservation',
    `WITH credit_tenders AS (
       SELECT t.sale_id, t.customer_id, sum(t.amount) AS tendered
         FROM bar_local.sale_tenders t
        WHERE t.method = 'customer_credit'
        GROUP BY t.sale_id, t.customer_id
     ), ledger AS (
       SELECT sale_id, customer_id, sum(delta) AS delta
         FROM bar_local.credit_ledger
        WHERE sale_id IS NOT NULL
        GROUP BY sale_id, customer_id
     ), problematic AS (
       SELECT ct.sale_id AS id
         FROM credit_tenders ct
         LEFT JOIN ledger l ON l.sale_id = ct.sale_id AND l.customer_id = ct.customer_id
        WHERE round(ct.tendered, 2) <> round(COALESCE(l.delta, 0), 2)
     )
     SELECT count(*)::int AS violations,
            COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
       FROM problematic`,
    'Customer credit tenders must be conserved by an equal and opposite customer credit ledger delta.'
  ))
  checks.push(await countViolations(
    client,
    'cashup_expected_cash_recomputes',
    `SELECT count(*)::int AS violations FROM bar_local.cashups c
      WHERE round(c.expected_cash, 2) <> round(bar_local.expected_shift_cash(c.shift_id), 2)`
  ))
  if (appliedHas('0020_')) {
    checks.push(await inspectViolations(
      client,
      'stock_recipe_depletion_matches',
      `WITH expected AS (
         SELECT sl.operation_id,
                (ingredient.value ->> 'ingredient_product_id')::uuid AS product_id,
                sum((ingredient.value ->> 'quantity_per_unit')::numeric * sl.quantity) AS quantity
           FROM bar_local.sale_lines sl
           JOIN bar_local.sales s ON s.id = sl.sale_id
           CROSS JOIN LATERAL jsonb_array_elements(sl.recipe_snapshot) AS ingredient(value)
          WHERE s.status IN ('completed', 'returned', 'voided')
            AND sl.quantity > 0
            AND jsonb_typeof(sl.recipe_snapshot) = 'array'
            AND jsonb_array_length(sl.recipe_snapshot) > 0
          GROUP BY sl.operation_id, (ingredient.value ->> 'ingredient_product_id')::uuid
       ), actual AS (
         SELECT operation_id, product_id, sum(delta) AS delta
           FROM bar_local.stock_movements
          WHERE reason = 'sale.recipe.depletion'
          GROUP BY operation_id, product_id
       ), problematic AS (
         SELECT e.operation_id AS id
           FROM expected e
           LEFT JOIN actual a ON a.operation_id = e.operation_id AND a.product_id = e.product_id
          WHERE a.product_id IS NULL OR round(a.delta, 6) <> round(-e.quantity, 6)
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(DISTINCT id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
         FROM problematic`,
      'Recipe depletions must exactly reverse the immutable recipe snapshot for the sold quantity.'
    ))
  }
  if (appliedHas('0026_')) {
    checks.push(await countViolations(
      client,
      'return_line_allocations_nonnegative',
      `/* check:return_line_allocations_nonnegative */
       SELECT count(*)::int AS violations FROM bar_local.sale_return_line_allocations
        WHERE quantity <= 0 OR gross_amount < 0 OR discount_amount < 0 OR tax_amount < 0`
    ))
    checks.push(await countViolations(
      client,
      'return_line_allocations_within_original',
      `/* check:return_line_allocations_within_original */
       SELECT count(*)::int AS violations FROM (
         SELECT a.original_sale_line_id
           FROM bar_local.sale_return_line_allocations a
           JOIN bar_local.sale_lines l ON l.id = a.original_sale_line_id
          GROUP BY a.original_sale_line_id, l.quantity, l.line_subtotal, l.line_discount, l.line_tax
         HAVING round(sum(a.quantity), 6) > round(l.quantity, 6)
             OR round(sum(a.gross_amount), 2) > round(l.line_subtotal, 2)
             OR round(sum(a.discount_amount), 2) > round(l.line_discount, 2)
             OR round(sum(a.tax_amount), 2) > round(l.line_tax, 2)
       ) over_allocated`
    ))
    checks.push(await countViolations(
      client,
      'return_tender_allocations_within_original',
      `/* check:return_tender_allocations_within_original */
       SELECT count(*)::int AS violations FROM (
         SELECT a.original_tender_id
           FROM bar_local.sale_return_tender_allocations a
           JOIN bar_local.sale_tenders t ON t.id = a.original_tender_id
          GROUP BY a.original_tender_id, t.amount
         HAVING round(sum(a.amount), 2) > round(t.amount, 2)
       ) over_allocated`
    ))
    checks.push(await countViolations(
      client,
      'return_sale_links_original',
      `/* check:return_sale_links_original */
       SELECT count(*)::int AS violations FROM bar_local.sales
        WHERE original_sale_id IS NOT NULL AND original_sale_id = id`
    ))
    checks.push(await inspectViolations(
      client,
      'return_line_allocations_match_return_lines',
      `WITH problematic AS (
         SELECT rl.id
           FROM bar_local.sale_lines rl
           JOIN bar_local.sales rs ON rs.id = rl.sale_id
           LEFT JOIN bar_local.sale_return_line_allocations a ON a.return_sale_line_id = rl.id
          WHERE rs.status = 'returned' AND rl.quantity < 0
            AND (a.id IS NULL
              OR a.quantity <> -rl.quantity
              OR a.gross_amount <> -rl.line_subtotal
              OR a.discount_amount <> -rl.line_discount
              OR a.tax_amount <> -rl.line_tax)
         UNION ALL
         SELECT a.id
           FROM bar_local.sale_return_line_allocations a
           JOIN bar_local.sale_lines rl ON rl.id = a.return_sale_line_id
          WHERE rl.quantity >= 0
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
         FROM problematic`,
      'Every return line must have exactly one allocation matching its immutable line values.'
    ))
    checks.push(await inspectViolations(
      client,
      'return_line_allocations_match_originals',
      `WITH allocated AS (
         SELECT original_sale_line_id, sum(quantity) AS quantity
           FROM bar_local.sale_return_line_allocations
          GROUP BY original_sale_line_id
       ), problematic AS (
         SELECT l.id
           FROM bar_local.sale_lines l
           LEFT JOIN allocated a ON a.original_sale_line_id = l.id
          WHERE round(l.returned_quantity, 6) <> round(COALESCE(a.quantity, 0), 6)
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
         FROM problematic`,
      'Original line returned_quantity must equal the sum of its cumulative return allocations.'
    ))
    checks.push(await inspectViolations(
      client,
      'return_line_cumulative_limits',
      `WITH grouped AS (
         SELECT a.original_sale_line_id AS id, ol.quantity, ol.line_subtotal, ol.line_discount, ol.line_tax,
                sum(a.quantity) AS allocated_quantity, sum(a.gross_amount) AS allocated_gross,
                sum(a.discount_amount) AS allocated_discount, sum(a.tax_amount) AS allocated_tax
           FROM bar_local.sale_return_line_allocations a
           JOIN bar_local.sale_lines ol ON ol.id = a.original_sale_line_id
          GROUP BY a.original_sale_line_id, ol.quantity, ol.line_subtotal, ol.line_discount, ol.line_tax
       ), problematic AS (
         SELECT id FROM grouped
          WHERE allocated_quantity > quantity
             OR allocated_gross > line_subtotal
             OR allocated_discount > line_discount
             OR allocated_tax > line_tax
             OR (allocated_quantity = quantity
               AND (allocated_gross <> line_subtotal OR allocated_discount <> line_discount OR allocated_tax <> line_tax))
             OR (allocated_gross - allocated_discount) > (line_subtotal - line_discount)
             OR (allocated_gross - allocated_discount) < 0
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
         FROM problematic`,
      'Cumulative return allocations must never exceed the original line and must land exactly on the final residual.'
    ))
    checks.push(await inspectViolations(
      client,
      'return_tender_allocations_reconcile',
      `WITH problematic AS (
         SELECT rt.id
           FROM bar_local.sale_tenders rt
           JOIN bar_local.sales rs ON rs.id = rt.sale_id
           LEFT JOIN bar_local.sale_return_tender_allocations a ON a.return_tender_id = rt.id
          WHERE rs.status = 'returned' AND rt.amount < 0
            AND (a.id IS NULL OR a.amount <> -rt.amount)
         UNION ALL
         SELECT a.id
           FROM bar_local.sale_return_tender_allocations a
           JOIN bar_local.sale_tenders rt ON rt.id = a.return_tender_id
          WHERE rt.amount >= 0
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
         FROM problematic`,
      'Every refund tender must have exactly one allocation matching the immutable refund amount.'
    ))
    checks.push(await inspectViolations(
      client,
      'return_tender_cumulative_limits',
      `WITH grouped AS (
         SELECT a.original_tender_id AS id, t.amount, sum(a.amount) AS allocated
           FROM bar_local.sale_return_tender_allocations a
           JOIN bar_local.sale_tenders t ON t.id = a.original_tender_id
          GROUP BY a.original_tender_id, t.amount
       ), problematic AS (
         SELECT id FROM grouped WHERE allocated > amount
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
         FROM problematic`,
      'Cumulative refund tender allocations must never exceed the original tender amount.'
    ))
    checks.push(await inspectViolations(
      client,
      'return_sale_totals_reconcile',
      `WITH totals AS (
         SELECT rs.id, rs.total,
                COALESCE((SELECT sum(a.amount) FROM bar_local.sale_return_tender_allocations a WHERE a.return_sale_id = rs.id), 0) AS allocated,
                COALESCE((SELECT sum(-rl.line_subtotal + rl.line_discount - rl.line_tax) FROM bar_local.sale_lines rl WHERE rl.sale_id = rs.id), 0) AS line_value
           FROM bar_local.sales rs
          WHERE rs.status = 'returned'
       ), problematic AS (
         SELECT id FROM totals
          WHERE round(-total, 2) <> round(allocated, 2) OR round(-total, 2) <> round(line_value, 2)
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
         FROM problematic`,
      'A return sale total must equal both its refund tender allocations and its immutable line values.'
    ))
    if (appliedHas('0029_')) {
      checks.push(await inspectViolations(
        client,
        'return_reconciliation_blockers',
        `WITH problematic AS (
           SELECT original_sale_id AS id FROM bar_local.return_allocation_reconciliation
         )
         SELECT count(*)::int AS violations,
                COALESCE((SELECT array_agg(DISTINCT id::text) FROM (SELECT id FROM problematic WHERE id IS NOT NULL LIMIT 10) sample), ARRAY[]::text[]) AS evidence
           FROM problematic`,
        'Unresolved return allocation reconciliation blockers must be cleared before a restore can be verified.'
      ))
    }
  }
  const accountingEnabled = Boolean(authority?.entitlement_features.includes('bar_accounting_workforce'))
  if (accountingEnabled && !appliedHas('0033_')) {
    checks.push({
      name: 'source_to_gl_coverage',
      status: 'fail',
      violations: 1,
      detail: 'Accounting is enabled but the source-to-GL contract migration is not present in the restored schema.'
    })
  } else if (accountingEnabled) {
    checks.push(await inspectViolations(
      client,
      'source_to_gl_coverage',
      `/* check:source_to_gl_coverage */
       WITH expected AS (
         SELECT s.id, CASE WHEN s.original_sale_id IS NULL THEN 'sale' ELSE 'return_or_void' END AS kind
           FROM bar_local.sales s
          WHERE s.status IN ('completed', 'returned', 'voided')
       ), postings AS (
         SELECT source_id, count(*) AS posting_count, bool_or(source_type = 'sale') AS has_sale,
                bool_or(source_type IN ('sale.return', 'sale.void')) AS has_return
           FROM bar_local.source_gl_postings
          GROUP BY source_id
       ), problematic AS (
         SELECT e.id
           FROM expected e
           LEFT JOIN postings p ON p.source_id = e.id
          WHERE p.source_id IS NULL OR p.posting_count <> 1
             OR (e.kind = 'sale' AND NOT p.has_sale)
             OR (e.kind = 'return_or_void' AND NOT p.has_return)
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
         FROM problematic`,
      'Every completed sale, return and void must be posted exactly once to the general ledger.'
    ))
    checks.push(await countViolations(
      client,
      'source_to_gl_not_vacuous',
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM bar_local.sales WHERE status IN ('completed', 'returned', 'voided'))
                    AND NOT EXISTS (SELECT 1 FROM bar_local.source_gl_postings)
              THEN 1 ELSE 0 END::int AS violations`
    ))
    checks.push(await inspectViolations(
      client,
      'source_to_gl_journal_linkage',
      `WITH problematic AS (
         SELECT p.source_type || ':' || p.source_id::text AS id
           FROM bar_local.source_gl_postings p
           JOIN bar_local.sales s ON s.id = p.source_id
           LEFT JOIN bar_local.journal_entries j ON j.id = p.journal_entry_id
          WHERE j.id IS NULL
             OR j.source_type <> p.source_type
             OR j.source_id <> p.source_id
             OR j.business_id <> p.business_id
             OR j.operation_id <> p.operation_id
             OR j.entry_date <> p.business_date
             OR s.business_id <> p.business_id
             OR s.outlet_id <> p.outlet_id
       )
       SELECT count(*)::int AS violations,
              COALESCE((SELECT array_agg(id) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
         FROM problematic`,
      'Each source-to-GL posting must link a journal entry stamped with the same source, scope, operation and business date.'
    ))
    checks.push(await countViolations(
      client,
      'source_to_gl_journal_balanced',
      `SELECT count(*)::int AS violations FROM bar_local.source_gl_postings p
         JOIN bar_local.journal_entries j ON j.id = p.journal_entry_id
         LEFT JOIN (
           SELECT entry_id, count(*) AS lines, round(sum(debit), 2) AS debits, round(sum(credit), 2) AS credits
             FROM bar_local.journal_lines GROUP BY entry_id
         ) l ON l.entry_id = j.id
        WHERE l.entry_id IS NULL OR l.lines = 0 OR l.debits <> l.credits OR l.debits = 0`
    ))
    if (appliedHas('0015_')) {
      checks.push(await inspectViolations(
        client,
        'expense_source_to_gl_coverage',
        `WITH problematic AS (
           SELECT e.id
             FROM bar_local.expenses e
             LEFT JOIN bar_local.journal_entries j ON j.id = e.journal_entry_id
             LEFT JOIN bar_local.journal_entries rj ON rj.id = e.reversal_journal_entry_id
            WHERE e.journal_entry_id IS NULL
               OR j.id IS NULL
               OR j.source_type <> 'expense'
               OR j.source_id <> e.id
               OR j.business_id <> e.business_id
               OR j.operation_id <> e.operation_id
               OR (e.status = 'voided' AND (
                 e.reversal_journal_entry_id IS NULL OR rj.id IS NULL
                 OR rj.source_type <> 'expense.void' OR rj.source_id <> e.id OR rj.business_id <> e.business_id))
               OR (e.status = 'posted' AND e.reversal_journal_entry_id IS NOT NULL)
         )
         SELECT count(*)::int AS violations,
                COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
           FROM problematic`,
        'Expenses and their voids must link the exact source journal entries.'
      ))
    }
    if (appliedHas('0024_')) {
      checks.push(await inspectViolations(
        client,
        'ap_invoice_source_to_gl_coverage',
        `WITH problematic AS (
           SELECT i.id
             FROM bar_local.ap_invoices i
             LEFT JOIN bar_local.journal_entries j ON j.id = i.journal_entry_id
            WHERE (i.status = 'approved' AND (
                i.journal_entry_id IS NULL OR j.id IS NULL
                OR i.approval_operation_id IS NULL
                OR j.source_type <> 'ap_invoice' OR j.source_id <> i.id
                OR j.business_id <> i.business_id
                OR j.operation_id <> i.approval_operation_id))
               OR (i.status = 'draft' AND i.journal_entry_id IS NOT NULL)
         )
         SELECT count(*)::int AS violations,
                COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
           FROM problematic`,
        'Approved supplier invoices must link their approval journal entry and drafts must remain unposted.'
      ))
      checks.push(await inspectViolations(
        client,
        'ap_payment_source_to_gl_coverage',
        `WITH problematic AS (
           SELECT p.id
             FROM bar_local.ap_payments p
             LEFT JOIN bar_local.journal_entries j ON j.id = p.journal_entry_id
            WHERE j.id IS NULL OR j.business_id <> p.business_id OR j.operation_id <> p.operation_id
               OR (p.status = 'posted' AND (
                 j.source_type <> 'ap_payment' OR j.source_id <> p.ap_invoice_id OR j.entry_date <> p.payment_date))
               OR (p.status = 'reversal' AND (
                 j.source_type <> 'ap_payment.reversal' OR j.source_id <> p.reverses_payment_id OR j.entry_date <> p.payment_date))
         )
         SELECT count(*)::int AS violations,
                COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
           FROM problematic`,
        'Supplier payments and reversals must link the exact source journal entries.'
      ))
      checks.push(await inspectViolations(
        client,
        'payroll_source_to_gl_coverage',
        `WITH problematic AS (
           SELECT r.id
             FROM bar_local.payroll_runs r
             LEFT JOIN bar_local.journal_entries j ON j.id = r.journal_entry_id
            WHERE (r.status = 'finalised' AND (
                r.journal_entry_id IS NULL OR j.id IS NULL
                OR r.finalise_operation_id IS NULL
                OR j.source_type <> 'payroll_run' OR j.source_id <> r.id
                OR j.business_id <> r.business_id
                OR j.operation_id <> r.finalise_operation_id))
               OR (r.status <> 'finalised' AND r.journal_entry_id IS NOT NULL)
         )
         SELECT count(*)::int AS violations,
                COALESCE((SELECT array_agg(id::text) FROM (SELECT id FROM problematic LIMIT 10) sample), ARRAY[]::text[]) AS evidence
           FROM problematic`,
        'Finalised payroll runs must link their finalisation journal entry and unfinalised runs must remain unposted.'
      ))
    }
    checks.push(await inspectViolations(
      client,
      'customer_credit_source_to_gl_unverified',
      `SELECT count(*)::int AS violations FROM bar_local.credit_ledger
        WHERE type LIKE 'payment%' OR (type = 'sale.credit' AND sale_id IS NULL)`,
      'Standalone customer credit payments have no local source-to-GL contract, so their ledger coverage cannot be verified.'
    ))
  } else {
    checks.push({
      name: 'source_to_gl_coverage',
      status: 'pass',
      violations: 0,
      detail: 'Source-to-GL coverage is not required because the Accounting/Workforce feature is not enabled.'
    })
  }
  checks.push(await countViolations(
    client,
    'operation_receipts_complete',
    `SELECT count(*)::int AS violations FROM bar_local.operations
      WHERE status = 'committed' AND (receipt IS NULL OR commit_sequence IS NULL)`
  ))
  checks.push(await countViolations(
    client,
    'operation_commit_sequences_unique',
    `SELECT count(*)::int AS violations FROM (
       SELECT commit_sequence FROM bar_local.operations
        WHERE commit_sequence IS NOT NULL
        GROUP BY commit_sequence
       HAVING count(*) > 1
     ) duplicated`
  ))
  checks.push(await countViolations(
    client,
    'receipt_numbers_within_counter',
    `SELECT count(*)::int AS violations FROM bar_local.sales s
      CROSS JOIN bar_local.authority_counter c
      WHERE s.receipt_number > c.receipt_sequence`
  ))
  checks.push(await countViolations(
    client,
    'outbox_within_commit_watermark',
    `SELECT count(*)::int AS violations FROM bar_local.outbox o
      CROSS JOIN bar_local.authority_counter c
      WHERE o.commit_sequence > c.commit_sequence`
  ))
  checks.push(await countViolations(
    client,
    'outbox_payload_hashes_valid',
    `SELECT count(*)::int AS violations FROM bar_local.outbox
      WHERE payload_hash !~ '^[0-9a-f]{64}$'`
  ))
  checks.push(await countViolations(
    client,
    'export_batches_ranges_valid',
    `SELECT count(*)::int AS violations FROM bar_local.export_batches
      WHERE from_sequence < 0 OR to_sequence < from_sequence OR event_count < 0`
  ))
  checks.push(await countViolations(
    client,
    'export_batches_event_counts_match',
    `SELECT count(*)::int AS violations FROM bar_local.export_batches b
       LEFT JOIN (
         SELECT export_batch_id, count(*) AS events
           FROM bar_local.outbox
          WHERE export_batch_id IS NOT NULL
          GROUP BY export_batch_id
       ) o ON o.export_batch_id = b.batch_id
      WHERE b.event_count <> COALESCE(o.events, 0)`
  ))
  checks.push(await countViolations(
    client,
    'outbox_before_acknowledgement_exported',
    `SELECT count(*)::int AS violations FROM bar_local.outbox
      WHERE commit_sequence <= COALESCE((
              SELECT max(to_sequence) FROM bar_local.export_batches WHERE acknowledged_at IS NOT NULL
            ), 0)
        AND export_batch_id IS NULL`
  ))

  const counterResult = await client.query(
    `SELECT c.commit_sequence::text AS commit_sequence,
            c.receipt_sequence::text AS receipt_sequence,
            COALESCE((SELECT max(b.to_sequence) FROM bar_local.export_batches b WHERE b.acknowledged_at IS NOT NULL), 0)::text AS acknowledged_watermark,
            COALESCE((SELECT max(b.to_sequence) FROM bar_local.export_batches b), 0)::text AS exported_watermark,
            (SELECT count(*) FROM bar_local.outbox o
               LEFT JOIN bar_local.export_batches b ON b.batch_id = o.export_batch_id
              WHERE o.export_batch_id IS NULL OR b.acknowledged_at IS NULL)::int AS pending_outbox
       FROM bar_local.authority_counter c
      WHERE c.singleton`
  )
  const counterRow = counterResult.rows[0]
  const commitSequence = asText(rowValue(counterRow, 'commit_sequence')) || '0'
  const receiptSequence = asText(rowValue(counterRow, 'receipt_sequence')) || '0'
  const acknowledged = asText(rowValue(counterRow, 'acknowledged_watermark')) || '0'
  const exported = asText(rowValue(counterRow, 'exported_watermark')) || '0'
  const pendingOutbox = asInteger(rowValue(counterRow, 'pending_outbox'))
  const acknowledgedValue = asBigIntOrNull(acknowledged)
  const exportedValue = asBigIntOrNull(exported)
  const commitValue = asBigIntOrNull(commitSequence)
  const watermarkFailures = acknowledgedValue === null || exportedValue === null || commitValue === null
    ? 1
    : (acknowledgedValue > commitValue || exportedValue > commitValue ? 1 : 0)
  checks.push({
    name: 'acknowledgement_watermark_valid',
    status: watermarkFailures === 0 ? 'pass' : 'fail',
    violations: watermarkFailures,
    detail: watermarkFailures === 0
      ? 'The highest exported and acknowledged batch sequences do not exceed the committed sequence; these maxima do not prove a contiguous checkpoint.'
      : 'A highest exported or acknowledged batch sequence exceeds the committed sequence.'
  })

  const runtimeRole = options.runtimeRole ?? 'bar_local_runtime'
  const runtimeChecks = await verifyRuntimeSecurity(client, {
    readOnlySnapshot: options.readOnlySnapshot,
    runtimeRole,
    migrationOwner: options.expectedMigrationOwner ?? undefined,
    runtimeProbe: resolveRuntimeProbe(options)
  })
  if (options.expectedMigrationOwner) {
    const ownerCheck = await runtimeSecurityCheck(
      client,
      'migration_owner_controls_schema',
      `/* check:migration_owner_controls_schema */
       SELECT CASE WHEN pg_get_userbyid(nspowner) = $1 THEN 0 ELSE 1 END::int AS violations
         FROM pg_namespace WHERE nspname = $2`,
      [options.expectedMigrationOwner, 'bar_local'],
      'The restored schema must be owned by the migration owner.'
    )
    runtimeChecks.push(ownerCheck)
  }
  checks.push(...runtimeChecks)

  const failures = checks.filter((check) => check.status === 'fail').map((check) => check.name)
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? 'verified' : 'failed',
    generated_at: generatedAt,
    database: options.database ?? null,
    schema: {
      applied_count: applied.length,
      local_count: localMigrations.length,
      checksums_verified: mismatched.length === 0 && unknownApplied.length === 0,
      missing_local: missingLocal,
      unknown_applied: unknownApplied,
      mismatched
    },
    authority,
    runtime: {
      role: runtimeRole,
      schema: 'bar_local'
    },
    counters: {
      commit_sequence: commitSequence,
      receipt_sequence: receiptSequence,
      acknowledged_watermark: acknowledged,
      exported_watermark: exported,
      highest_acknowledged_sequence: acknowledged,
      highest_exported_sequence: exported,
      acknowledged_contiguous_checkpoint: null,
      pending_outbox: pendingOutbox
    },
    checks,
    failures
  }
}

export function assertRestoreVerification(report: RestoreVerificationReport): void {
  if (!report.ok) {
    throw new BackupToolError(
      'RESTORE_VERIFICATION_FAILED',
      `Restore verification failed: ${report.failures.join(', ') || 'unknown invariant failure'}`
    )
  }
}
