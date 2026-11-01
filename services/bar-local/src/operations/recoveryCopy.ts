import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, statfs } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ServiceConfig } from '../config.js'
import { loadEncryptionKey } from './backup.js'
import { acquireRecoveryLock, recoveryRoot, safeRecoveryPath, verifyRecoveryManifest } from './recovery.js'
import type { RecoveryManifest } from './recovery.js'
import { readWalArchiveKey, verifyWalArchiveFile } from './walArchive.js'
import { recoveryCopyDestination } from './recoveryDestination.js'

type Entry = { path: string; sha256: string; bytes: number }
async function copyAuthenticated(source: string, destination: string, expected?: string): Promise<Entry> {
  if (!(await lstat(source)).isFile() || (await lstat(source)).isSymbolicLink()) throw new Error('Recovery copy accepts regular files only.')
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  const hash = createHash('sha256')
  let bytes = 0
  const meter = new Transform({ transform(chunk: Buffer, _encoding, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk) } })
  await pipeline(createReadStream(source), meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.timeout(900000) })
  const sha256 = hash.digest('hex')
  if (expected && sha256 !== expected) throw new Error('Recovery copy checksum differs from its authenticated inventory. The incomplete set is not published.')
  const file = await open(destination, 'r+')
  try { await file.sync() } finally { await file.close() }
  return { path: '', sha256, bytes }
}

/** Export an immutable encrypted set to the configured second destination.
 * No plaintext database, passphrase, key or service credential is copied. */
export async function copyRecoverySet(config: ServiceConfig) {
  const configured = await recoveryCopyDestination(config)
  if (config.training || !configured || !config.recovery?.walKeyFile) throw new Error('Choose a separate backup-copy destination and provision a WAL key before exporting recovery.')
  const source = recoveryRoot(config), destination = path.resolve(configured)
  for (const protectedPath of [source, config.backup.dir, config.replication.pgDataDir]) {
    const first = path.resolve(protectedPath).toLowerCase(), second = destination.toLowerCase()
    if (first === second || first.startsWith(second + path.sep) || second.startsWith(first + path.sep)) throw new Error('The second recovery destination must be separate from live data and primary backups.')
  }
  await mkdir(destination, { recursive: true, mode: 0o700 })
  if ((await realpath(destination)).toLowerCase() !== destination.toLowerCase()) throw new Error('Linked recovery copy destinations are refused.')
  const release = await acquireRecoveryLock(config)
  const id = randomUUID(), stage = path.join(destination, `.preparing-recovery-${id}`)
  try {
    const key = loadEncryptionKey({ keyFile: config.backup.keyFile }), walKey = await readWalArchiveKey(config.recovery.walKeyFile)
    const packages: RecoveryManifest[] = []
    for (const name of await readdir(source)) {
      if (!/^[a-f0-9-]{36}$/.test(name)) continue
      const root = path.join(source, name)
      if ((await lstat(root)).isSymbolicLink()) throw new Error('Linked recovery packages cannot be exported.')
      const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as RecoveryManifest
      verifyRecoveryManifest(manifest, key)
      if (manifest.database !== config.db.database || manifest.id !== name) throw new Error('Recovery inventory belongs to a different database.')
      packages.push(manifest)
    }
    if (!packages.length) throw new Error('Create a complete encrypted recovery base before exporting a recovery set.')
    const walFiles = (await readdir(config.recovery.walDir)).filter(name => /^(?:[A-F0-9]{24}|[A-F0-9]{8}\.history|[A-F0-9]{24}\.[A-F0-9]{8}\.backup)\.wal\.gcm$/i.test(name)).sort()
    if (!walFiles.length) throw new Error('No complete encrypted WAL files are available. Wait for archiving or repair archive health.')
    const volume = await statfs(destination, { bigint: true })
    let required = packages.reduce((total, item) => total + BigInt(item.files.reduce((sum, file) => sum + file.bytes, 0)), 256n * 1024n ** 2n)
    for (const name of walFiles) required += BigInt((await lstat(path.join(config.recovery.walDir, name))).size)
    if (volume.bavail * volume.bsize < required) throw new Error('The second recovery destination has insufficient free space. No completed copy was replaced.')
    await mkdir(stage, { mode: 0o700 })
    const files: Entry[] = []
    const copy = async (sourcePath: string, relative: string, expected?: string) => {
      const entry = await copyAuthenticated(sourcePath, safeRecoveryPath(stage, relative), expected)
      files.push({ ...entry, path: relative })
    }
    for (const manifest of packages) {
      const root = path.join(source, manifest.id)
      const canonical = (await realpath(root)).toLowerCase()
      for (const file of manifest.files) {
        const input = safeRecoveryPath(root, file.encrypted)
        if (!(await realpath(input)).toLowerCase().startsWith(canonical + path.sep)) throw new Error('A linked recovery file escaped its authenticated package.')
        await copy(input, `physical-recovery/${manifest.id}/${file.encrypted}`, file.sha256)
      }
      await copy(path.join(root, 'manifest.json'), `physical-recovery/${manifest.id}/manifest.json`)
    }
    for (const name of walFiles) {
      const originalHash = await verifyWalArchiveFile(name.slice(0, -8), config.recovery.walDir, walKey)
      await copy(path.join(config.recovery.walDir, name), `wal/${name}`)
      if (await verifyWalArchiveFile(name.slice(0, -8), path.join(stage, 'wal'), walKey) !== originalHash) throw new Error('WAL copy changed while exporting; the set is not published.')
    }
    const inventory = { version: 1, id, created_at: new Date().toISOString(), database: config.db.database, bases: packages.map(item => item.id), files, encrypted_keys_required_separately: true, restore_verified: false, independent_device_verified: false, signature: '' }
    inventory.signature = createHmac('sha256', key.material).update(JSON.stringify(inventory)).digest('hex')
    const record = await open(path.join(stage, 'recovery-set.json'), 'wx', 0o600)
    try { await record.writeFile(JSON.stringify(inventory)); await record.sync() } finally { await record.close() }
    const completed = path.join(destination, `recovery-set-${id}`)
    await rename(stage, completed)
    return { id, destination: completed, bases: packages.length, wal_records: walFiles.length, encrypted: true, keys_included: false, independent_device_verified: false, restore_verified: false }
  } finally { await release() }
}
