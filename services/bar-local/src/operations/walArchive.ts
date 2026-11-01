import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, link, lstat, mkdir, open, readFile, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MAGIC = Buffer.from('TBBARWAL', 'ascii')
const VERSION = 1
const NONCE_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + 1 + NONCE_BYTES
// PostgreSQL also archives timeline histories and base-backup history records.
// Rejecting those prevents recovery across an otherwise valid promotion.
const WAL_NAME = /^(?:[0-9A-F]{24}|[0-9A-F]{8}\.history|[0-9A-F]{24}\.[0-9A-F]{8}\.backup)$/i

export class WalArchiveError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WalArchiveError'
    this.code = code
  }
}

export interface WalArchiveOptions {
  readonly sourcePath: string
  readonly walName: string
  readonly archiveDir: string
  readonly key: Buffer
}

export interface WalRestoreOptions {
  readonly walName: string
  readonly archiveDir: string
  readonly targetPath: string
  readonly key: Buffer
}

function validateKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new WalArchiveError('WAL_KEY_INVALID', 'The WAL archive key must contain exactly 32 bytes.')
  }
}

function validateWalName(walName: string): void {
  if (!WAL_NAME.test(walName) || basename(walName) !== walName) {
    throw new WalArchiveError('WAL_NAME_INVALID', 'The PostgreSQL WAL segment name is invalid.')
  }
}

function archivePath(archiveDir: string, walName: string): string {
  validateWalName(walName)
  return join(resolve(archiveDir), `${walName.toUpperCase()}.wal.gcm`)
}

function parseWalKey(keyFile: string, raw: string): Buffer {
  const encoded = raw.replace(/\r?\n$/, '')
  if (!/^[0-9a-f]{64}$/i.test(encoded)) {
    throw new WalArchiveError('WAL_KEY_INVALID', `The WAL key file ${keyFile} must contain exactly 64 hexadecimal characters.`)
  }
  return Buffer.from(encoded, 'hex')
}

export async function readWalArchiveKey(keyFile: string): Promise<Buffer> {
  const file = resolve(keyFile)
  const metadata = await lstat(file).catch(() => null)
  if (!metadata || !metadata.isFile() || metadata.isSymbolicLink()) {
    throw new WalArchiveError('WAL_KEY_UNAVAILABLE', 'The protected WAL recovery key file is unavailable.')
  }
  if (metadata.size > 66) {
    throw new WalArchiveError('WAL_KEY_INVALID', 'The WAL key file is larger than the supported 64-character key format.')
  }
  return parseWalKey(file, await readFile(file, 'utf8'))
}

async function assertRegularFile(file: string, code: string, message: string): Promise<void> {
  const metadata = await lstat(file).catch(() => null)
  if (!metadata || !metadata.isFile() || metadata.isSymbolicLink()) {
    throw new WalArchiveError(code, message)
  }
}

async function archiveMetadata(file: string, key: Buffer): Promise<{ readonly inputOffset: number; readonly inputEnd: number; readonly nonce: Buffer; readonly tag: Buffer }> {
  validateKey(key)
  await assertRegularFile(file, 'WAL_ARCHIVE_MISSING', 'The encrypted WAL segment is missing or is not a regular file.')
  const metadata = await stat(file)
  if (metadata.size < HEADER_BYTES + TAG_BYTES) {
    throw new WalArchiveError('WAL_ARCHIVE_CORRUPT', 'The encrypted WAL segment is truncated.')
  }
  const handle = await open(file, 'r')
  try {
    const header = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, 0)
    if (bytesRead !== HEADER_BYTES || !header.subarray(0, MAGIC.length).equals(MAGIC) || header[MAGIC.length] !== VERSION) {
      throw new WalArchiveError('WAL_ARCHIVE_CORRUPT', 'The encrypted WAL segment header is invalid or unsupported.')
    }
    const tag = Buffer.alloc(TAG_BYTES)
    const tagRead = await handle.read(tag, 0, TAG_BYTES, metadata.size - TAG_BYTES)
    if (tagRead.bytesRead !== TAG_BYTES) {
      throw new WalArchiveError('WAL_ARCHIVE_CORRUPT', 'The encrypted WAL segment authentication tag is missing.')
    }
    return {
      inputOffset: HEADER_BYTES,
      inputEnd: metadata.size - TAG_BYTES - 1,
      nonce: header.subarray(MAGIC.length + 1),
      // The caller retrieves the tag separately to avoid holding the body in memory.
      tag
    }
  } finally {
    await handle.close()
  }
}

async function decryptToStream(file: string, key: Buffer, destination: NodeJS.WritableStream): Promise<void> {
  const details = await archiveMetadata(file, key)
  const decipher = createDecipheriv('aes-256-gcm', key, details.nonce)
  decipher.setAuthTag(details.tag)
  try {
    await pipeline(
      createReadStream(file, { start: details.inputOffset, end: details.inputEnd }),
      decipher,
      destination
    )
  } catch (error) {
    if (error instanceof WalArchiveError) throw error
    throw new WalArchiveError('WAL_ARCHIVE_CORRUPT', 'The encrypted WAL segment failed authenticated decryption.')
  }
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function hashArchive(file: string, key: Buffer): Promise<string> {
  const hash = createHash('sha256')
  const sink = new Writable({ write(chunk, _encoding, callback) { hash.update(chunk); callback() } })
  await decryptToStream(file, key, sink)
  return hash.digest('hex')
}

/** Authenticate a complete archived record without writing plaintext to disk. */
export async function verifyWalArchiveFile(walName: string, archiveDir: string, key: Buffer): Promise<string> {
  validateKey(key)
  const file = archivePath(archiveDir, walName)
  await assertRegularFile(file, 'WAL_ARCHIVE_MISSING', 'A complete archived WAL record is required.')
  return hashArchive(file, key)
}

async function syncFile(file: string): Promise<void> {
  const handle = await open(file, 'r+')
  try { await handle.sync() } finally { await handle.close() }
}

async function createEncryptedArchive(sourcePath: string, targetPath: string, key: Buffer): Promise<void> {
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  try {
    const handle = await open(tempPath, 'wx', 0o600)
    try {
      await handle.writeFile(Buffer.concat([MAGIC, Buffer.from([VERSION]), nonce]))
      await handle.sync()
    } finally { await handle.close() }
    await pipeline(createReadStream(sourcePath), cipher, createWriteStream(tempPath, { flags: 'a' }))
    await appendFile(tempPath, cipher.getAuthTag())
    await syncFile(tempPath)
    // A hard link publishes the complete file atomically without replacing an
    // archive another PostgreSQL process may have created for this segment.
    await link(tempPath, targetPath)
    await unlink(tempPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function archiveWalSegment(options: WalArchiveOptions): Promise<{ readonly archived: boolean; readonly path: string; readonly sha256: string }> {
  validateKey(options.key)
  validateWalName(options.walName)
  const sourcePath = resolve(options.sourcePath)
  await assertRegularFile(sourcePath, 'WAL_SOURCE_MISSING', 'PostgreSQL did not provide a regular WAL segment to archive.')
  const targetPath = archivePath(options.archiveDir, options.walName)
  await mkdir(dirname(targetPath), { recursive: true })
  const sourceHash = await hashFile(sourcePath)
  const existing = await lstat(targetPath).catch(() => null)
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new WalArchiveError('WAL_ARCHIVE_CONFLICT', 'An existing WAL archive path is not a regular file; it was left untouched.')
    }
    const archivedHash = await hashArchive(targetPath, options.key).catch((error) => {
      if (error instanceof WalArchiveError) return null
      throw error
    })
    if (archivedHash !== sourceHash) {
      throw new WalArchiveError('WAL_ARCHIVE_CONFLICT', 'An existing WAL archive has different or invalid contents; it was left untouched.')
    }
    return { archived: false, path: targetPath, sha256: sourceHash }
  }
  try {
    await createEncryptedArchive(sourcePath, targetPath, options.key)
    return { archived: true, path: targetPath, sha256: sourceHash }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
    const archivedHash = await hashArchive(targetPath, options.key).catch((archiveError) => {
      if (archiveError instanceof WalArchiveError) return null
      throw archiveError
    })
    if (archivedHash !== sourceHash) {
      throw new WalArchiveError('WAL_ARCHIVE_CONFLICT', 'A concurrently created WAL archive has different or invalid contents; it was left untouched.')
    }
    return { archived: false, path: targetPath, sha256: sourceHash }
  }
}

export async function restoreWalSegment(options: WalRestoreOptions): Promise<{ readonly restored: boolean; readonly path: string; readonly sha256: string }> {
  validateKey(options.key)
  validateWalName(options.walName)
  const sourcePath = archivePath(options.archiveDir, options.walName)
  const targetPath = resolve(options.targetPath)
  const existing = await lstat(targetPath).catch(() => null)
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new WalArchiveError('WAL_RESTORE_TARGET_CONFLICT', 'The WAL restore target exists and is not a regular file; it was left untouched.')
    }
    const archivedHash = await hashArchive(sourcePath, options.key)
    const targetHash = await hashFile(targetPath)
    if (targetHash !== archivedHash) {
      throw new WalArchiveError('WAL_RESTORE_TARGET_CONFLICT', 'The WAL restore target already contains different data; it was left untouched.')
    }
    return { restored: false, path: targetPath, sha256: targetHash }
  }
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`
  try {
    await decryptToStream(sourcePath, options.key, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }))
    await syncFile(tempPath)
    const digest = await hashFile(tempPath)
    try {
      await link(tempPath, targetPath)
      await unlink(tempPath)
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
      const targetHash = await hashFile(targetPath)
      if (targetHash !== digest) {
        throw new WalArchiveError('WAL_RESTORE_TARGET_CONFLICT', 'A concurrently created WAL restore target has different data; it was left untouched.')
      }
      await rm(tempPath, { force: true })
      return { restored: false, path: targetPath, sha256: digest }
    }
    return { restored: true, path: targetPath, sha256: digest }
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}
