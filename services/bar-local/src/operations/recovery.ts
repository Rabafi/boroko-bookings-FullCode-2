import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { createServer } from 'node:net'
import type { ServiceConfig } from '../config.js'
import { decryptFile, encryptFile, loadEncryptionKey, verifyRestoredDatabase } from './backup.js'
import type { EncryptionKey } from './backup.js'
import { recoveryCopyDestination } from './recoveryDestination.js'

type FileProof = { path: string; encrypted: string; sha256: string; plaintextSha256: string; bytes: number; plaintextBytes: number }
export type RecoveryManifest = { version: 1; id: string; created_at: string; database: string; postgres_major: '17'; system_identifier: string; timeline: number; start_lsn: string; end_lsn: string; directories: string[]; files: FileProof[]; signature: string }
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function recoveryRoot(config: ServiceConfig) { return path.join(config.backup.dir, 'physical-recovery') }
const MIB = 1024n ** 2n
const GIB = 1024n ** 3n

/** A physical base exists in plaintext and encrypted form together until publication. */
export function recoveryBaseRequiredBytes(sourceBytes: bigint) {
  const copyPeak = sourceBytes * 2n
  const workingMargin = sourceBytes / 4n > 512n * MIB ? sourceBytes / 4n : 512n * MIB
  return copyPeak + workingMargin
}

/** The isolated PITR database needs the uncompressed base plus replay/bootstrap room. */
export function recoveryDrillRequiredBytes(baseBytes: bigint) {
  const replayMargin = baseBytes / 4n > GIB ? baseBytes / 4n : GIB
  return baseBytes + replayMargin
}

async function directoryBytes(root: string): Promise<bigint> {
  let total = 0n
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error('Storage sizing stopped at a linked database path; no backup was started.')
    if (info.isDirectory()) total += await directoryBytes(target)
    else if (info.isFile()) total += BigInt(info.size)
  }
  return total
}

function gibibytes(bytes: bigint, roundUp = false) {
  const value = Number(bytes) / Number(GIB) * 10
  return (roundUp ? Math.max(0.1, Math.ceil(value)) : Math.floor(value)) / 10
}

export function safeRecoveryPath(root: string, name: string): string {
  if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..') || name.includes(':') || /[\x00-\x1f]/.test(name)) throw new Error('Unsafe recovery file path.')
  const target = path.resolve(root, ...name.split('/'))
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Recovery path escapes its package.')
  return target
}

function sign(manifest: RecoveryManifest, key: EncryptionKey) {
  return createHmac('sha256', key.material).update(JSON.stringify({ ...manifest, signature: '' })).digest('hex')
}
export function verifyRecoveryManifest(manifest: RecoveryManifest, key: EncryptionKey): void {
  if (manifest.version !== 1 || !ID.test(manifest.id) || manifest.postgres_major !== '17' || !/^\d+$/.test(manifest.system_identifier) || !Number.isInteger(manifest.timeline) || manifest.timeline < 1 || !/^[0-9A-F]+\/[0-9A-F]+$/i.test(manifest.start_lsn) || !/^[0-9A-F]+\/[0-9A-F]+$/i.test(manifest.end_lsn) || !Number.isFinite(Date.parse(manifest.created_at)) || !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 500000) throw new Error('Recovery manifest is invalid.')
  const expected = sign(manifest, key)
  if (!/^[a-f0-9]{64}$/.test(manifest.signature) || !timingSafeEqual(Buffer.from(expected), Buffer.from(manifest.signature))) throw new Error('Recovery manifest authentication failed. Do not restore this package.')
  const files = new Set<string>()
  if (!Array.isArray(manifest.directories) || manifest.directories.length > 500000) throw new Error('Recovery directory inventory is invalid.')
  for (const directory of manifest.directories) safeRecoveryPath('/bounded', directory)
  for (const file of manifest.files) {
    safeRecoveryPath('/bounded', file.path); safeRecoveryPath('/bounded', file.encrypted)
    if (files.has(file.path) || !file.encrypted.endsWith('.gcm') || !/^[a-f0-9]{64}$/.test(file.sha256) || !/^[a-f0-9]{64}$/.test(file.plaintextSha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !Number.isSafeInteger(file.plaintextBytes) || file.plaintextBytes < 0) throw new Error('Recovery file inventory is invalid.')
    files.add(file.path)
  }
  for (const required of ['PG_VERSION', 'global/pg_control', 'backup_manifest']) if (!files.has(required)) throw new Error(`Recovery package is missing ${required}.`)
}

async function walk(root: string, relative = '', directories: string[] = []): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error('Recovery packages with linked tablespaces or files require a separately supported recovery procedure.')
    if (entry.isDirectory()) { directories.push(name); result.push(...await walk(root, name, directories)) }
    else if (entry.isFile()) result.push(name)
    else throw new Error('Recovery contains an unsupported special file.')
  }
  return result.sort()
}

async function tool(binary: string, args: string[], env: NodeJS.ProcessEnv, timeout = 900000) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let diagnostic = ''
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-3000) })
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(binary)} timed out; the incomplete package is not usable.`)) }, timeout)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${path.basename(binary)} failed (${code}). ${diagnostic.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[protected connection]').replace(/[a-f0-9]{64,}/gi, '[redacted]')} The recovery point is not verified.`)) })
  })
}
function binary(config: ServiceConfig, name: string) {
  if (!config.replication.pgBin) throw new Error('Packaged PostgreSQL tools are not configured.')
  return path.join(config.replication.pgBin, name + (process.platform === 'win32' ? '.exe' : ''))
}
async function lock(root: string) {
  await mkdir(root, { recursive: true })
  const file = path.join(root, 'recovery.lock')
  const handle = await open(file, 'wx', 0o600).catch(() => { throw new Error('A recovery operation is already active. Check its outcome before retrying.') })
  await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }))
  return async () => { await handle.close(); await rm(file, { force: true }) }
}
export function acquireRecoveryLock(config: ServiceConfig) { return lock(recoveryRoot(config)) }

/** Retire a dead worker lock only when no retained drill database is running. */
export async function repairRecoveryLock(config: ServiceConfig) {
  const root = recoveryRoot(config), file = path.join(root, 'recovery.lock')
  const saved = JSON.parse(await readFile(file, 'utf8')) as { pid?: number; started_at?: string }
  if (!Number.isSafeInteger(saved.pid) || saved.pid! < 1 || !saved.started_at) throw new Error('Recovery lock identity is invalid; preserve it for support.')
  try { process.kill(saved.pid!, 0); throw new Error('The recovery worker is still present. Do not clear its lock.') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
  for (const entry of await readdir(root)) {
    if (!/^drill-[a-f0-9-]{36}$/.test(entry)) continue
    if (await lstat(path.join(root, entry, 'data', 'postmaster.pid')).then(() => true, () => false)) throw new Error('A retained recovery drill may still be running. Verify and stop that owned process before clearing the lock.')
  }
  await rename(file, path.join(root, `retired-lock-${randomUUID()}.json`))
  return { repaired: true, data_removed: false }
}
async function admin(config: ServiceConfig) {
  if (!config.replication.adminDatabaseUrl || !config.replication.pgDataDir) throw new Error('The protected local recovery connection is not configured.')
  const client = new pg.Client({ connectionString: config.replication.adminDatabaseUrl, connectionTimeoutMillis: 30000, application_name: 'bar-local-recovery' })
  await client.connect()
  try {
    const row = (await client.query("SELECT current_setting('data_directory') AS directory, current_setting('port')::int AS port, current_setting('server_version_num')::int AS version")).rows[0]
    if (path.resolve(row.directory).toLowerCase() !== path.resolve(config.replication.pgDataDir).toLowerCase() || Number(row.port) !== config.db.port || row.version < 170000 || row.version >= 180000) throw new Error('Recovery connection does not match the configured dedicated PostgreSQL17 cluster.')
    return client
  } catch (error) { await client.end(); throw error }
}

export async function recoveryStatus(config: ServiceConfig) {
  const root = recoveryRoot(config)
  const entries = await readdir(root).catch(() => [])
  const packages: Array<{ id: string; created_at: string; bytes: number; authenticated: boolean }> = []
  const key = loadEncryptionKey({ keyFile: config.backup.keyFile })
  for (const id of entries.filter(name => ID.test(name))) {
    try {
      const manifest = JSON.parse(await readFile(path.join(root, id, 'manifest.json'), 'utf8')) as RecoveryManifest
      verifyRecoveryManifest(manifest, key)
      packages.push({ id, created_at: manifest.created_at, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), authenticated: true })
    } catch { packages.push({ id, created_at: '', bytes: 0, authenticated: false }) }
  }
  const client = await admin(config)
  try {
    const archive = (await client.query("SELECT current_setting('archive_mode') AS mode, current_setting('archive_command') AS command, archived_count, failed_count, last_archived_wal, last_archived_time, last_failed_time FROM pg_stat_archiver")).rows[0]
    return { packages: packages.sort((a, b) => b.created_at.localeCompare(a.created_at)), copy_destination: await recoveryCopyDestination(config), daily_base_schedule: config.recovery?.enabled === true, archive: { enabled: archive.mode === 'on' && String(archive.command).includes('wal-archive.mjs'), archived_count: archive.archived_count, failed_count: archive.failed_count, last_archived_wal: archive.last_archived_wal, last_archived_time: archive.last_archived_time, last_failed_time: archive.last_failed_time }, key_configured: true, automatic_pruning: false, message: 'Recovery packages and WAL are retained together. No archive is automatically deleted. An authenticated package is not a verified recovery point until a restore drill succeeds.' }
  } finally { await client.end() }
}

export async function createRecoveryBase(config: ServiceConfig) {
  if (config.training) throw new Error('Practice mode cannot create a live recovery chain.')
  const root = recoveryRoot(config)
  const release = await lock(root)
  const id = randomUUID()
  const stage = path.join(root, `.preparing-${id}`)
  const plain = path.join(stage, 'plain')
  try {
    const sourceBytes = await directoryBytes(config.replication.pgDataDir!)
    const requiredBytes = recoveryBaseRequiredBytes(sourceBytes)
    const volume = await statfs(root, { bigint: true })
    const freeBytes = volume.bavail * volume.bsize
    if (freeBytes < requiredBytes) {
      const shortfall = requiredBytes - freeBytes
      throw new Error(`Storage space is low for this backup. It needs about ${gibibytes(requiredBytes, true).toFixed(1)} GiB for a temporary base copy and encrypted copy; ${gibibytes(freeBytes).toFixed(1)} GiB is free. Free another ${gibibytes(shortfall, true).toFixed(1)} GiB on this backup drive and try again. No database files were changed.`)
    }
    const key = loadEncryptionKey({ keyFile: config.backup.keyFile })
    const client = await admin(config)
    let systemId: string
    try {
      const archive = (await client.query("SELECT current_setting('archive_mode') AS mode, current_setting('archive_command') AS command")).rows[0]
      if (archive.mode !== 'on' || !String(archive.command).includes('wal-archive.mjs')) throw new Error('Encrypted WAL archiving must be active before creating a recovery chain. Repair the managed server installation and restart PostgreSQL.')
      if ((await client.query("SELECT count(*)::int AS count FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')")).rows[0].count !== 0) throw new Error('Custom tablespaces are not supported by this recovery workflow.')
      systemId = String((await client.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id)
    } finally { await client.end() }
    await mkdir(stage)
    const url = new URL(config.replication.adminDatabaseUrl!)
    const env = { ...process.env, PGHOST: config.db.host, PGPORT: String(config.db.port), PGUSER: config.recovery?.replicationUser || decodeURIComponent(url.username), PGPASSWORD: config.recovery?.replicationPassword || decodeURIComponent(url.password) }
    await tool(binary(config, 'pg_basebackup'), ['-D', plain, '-Fp', '-X', 'stream', '-c', 'fast', '--no-password'], env)
    await tool(binary(config, 'pg_verifybackup'), [plain], env)
    const pgManifest = JSON.parse(await readFile(path.join(plain, 'backup_manifest'), 'utf8')) as { 'WAL-Ranges': Array<{ Timeline: number; 'Start-LSN': string; 'End-LSN': string }> }
    const range = pgManifest['WAL-Ranges'][0]
    if (!range) throw new Error('Physical backup has no WAL consistency range.')
    const manifest: RecoveryManifest = { version: 1, id, created_at: new Date().toISOString(), database: config.db.database, postgres_major: '17', system_identifier: systemId!, timeline: range.Timeline, start_lsn: range['Start-LSN'], end_lsn: range['End-LSN'], directories: [], files: [], signature: '' }
    for (const file of await walk(plain, '', manifest.directories)) {
      const encrypted = `encrypted/${file}.gcm`
      const proof = await encryptFile({ inputPath: safeRecoveryPath(plain, file), outputPath: safeRecoveryPath(stage, encrypted), key })
      manifest.files.push({ path: file, encrypted, ...proof })
    }
    manifest.signature = sign(manifest, key)
    await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 })
    await rm(plain, { recursive: true }) // Only this nonce-named plaintext staging directory.
    await rename(stage, path.join(root, id))
    return { id, created_at: manifest.created_at, start_lsn: manifest.start_lsn, end_lsn: manifest.end_lsn, files: manifest.files.length, encrypted: true, restore_verified: false }
  } finally { await release() }
}

/** Materialise only in a newly-created, caller-owned drill directory. No live target accepted. */
export async function materializeRecoveryBase(config: ServiceConfig, id: string, drillRoot: string) {
  if (!ID.test(id)) throw new Error('Choose a valid recovery package identifier.')
  const root = recoveryRoot(config)
  const packageRoot = path.join(root, id)
  if ((await lstat(packageRoot)).isSymbolicLink()) throw new Error('Linked recovery packages are refused.')
  const key = loadEncryptionKey({ keyFile: config.backup.keyFile })
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'manifest.json'), 'utf8')) as RecoveryManifest
  verifyRecoveryManifest(manifest, key)
  if (manifest.id !== id || manifest.database !== config.db.database) throw new Error('Recovery package belongs to a different database.')
  const destination = path.join(drillRoot, 'data')
  await mkdir(destination, { recursive: false }) // Existing targets are never overwritten.
  for (const directory of manifest.directories) await mkdir(safeRecoveryPath(destination, directory), { recursive: true, mode: 0o700 })
  const canonicalPackage = await realpath(packageRoot)
  for (const file of manifest.files) {
    const source = safeRecoveryPath(packageRoot, file.encrypted)
    if ((await lstat(source)).isSymbolicLink() || !(await realpath(source)).toLowerCase().startsWith(canonicalPackage.toLowerCase() + path.sep)) throw new Error('Linked encrypted files are refused.')
    await decryptFile({ encryptedPath: source, outputPath: safeRecoveryPath(destination, file.path), key, expectedSha256: file.sha256, expectedPlaintextSha256: file.plaintextSha256 })
  }
  await tool(binary(config, 'pg_verifybackup'), [destination], process.env)
  return { manifest, destination }
}

function quoteCommand(value: string): string {
  if (!value || /[%!"&|<>^\r\n]/.test(value)) throw new Error('Recovery tool paths contain unsupported command characters.')
  return `"${value.replaceAll('\\', '/')}"`
}
function literal(value: string) { return `'${value.replaceAll("'", "''")}'` }
async function unusedPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No isolated recovery port available.'))) })
  })
}

/** Prove a point in time in a NEW, loopback-only, never-promoted copy. */
export async function runPointInTimeDrill(config: ServiceConfig, id: string, targetTime: string, inspect?: (client: pg.Client) => Promise<void>) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(targetTime) || !Number.isFinite(Date.parse(targetTime)) || Date.parse(targetTime) > Date.now()) throw new Error('Choose a past ISO recovery time with its timezone.')
  if (!config.recovery?.walKeyFile) throw new Error('The protected WAL recovery key is not configured.')
  const root = recoveryRoot(config)
  const release = await lock(root)
  const drillRoot = path.join(root, `drill-${randomUUID()}`)
  await mkdir(drillRoot, { mode: 0o700 })
  let started = false
  let verified = false
  let reportToSave: { cleanup: { cluster_stopped: boolean; data_removed: boolean; message?: string } } | null = null
  const port = await unusedPort()
  const data = path.join(drillRoot, 'data')
  try {
    if (!ID.test(id)) throw new Error('Choose a valid recovery package identifier.')
    const packageRoot = path.join(recoveryRoot(config), id)
    const recoveryManifest = JSON.parse(await readFile(path.join(packageRoot, 'manifest.json'), 'utf8')) as RecoveryManifest
    verifyRecoveryManifest(recoveryManifest, loadEncryptionKey({ keyFile: config.backup.keyFile }))
    const baseBytes = recoveryManifest.files.reduce((sum, file) => sum + BigInt(file.plaintextBytes), 0n)
    const requiredBytes = recoveryDrillRequiredBytes(baseBytes)
    const volume = await statfs(root, { bigint: true })
    const freeBytes = volume.bavail * volume.bsize
    if (freeBytes < requiredBytes) {
      throw new Error(`Storage space is low for recovery verification. It needs about ${gibibytes(requiredBytes, true).toFixed(1)} GiB for the isolated database copy and WAL replay; ${gibibytes(freeBytes).toFixed(1)} GiB is free. Free another ${gibibytes(requiredBytes - freeBytes, true).toFixed(1)} GiB on this backup drive and try again.`)
    }
    const restored = await materializeRecoveryBase(config, id, drillRoot)
    if (Date.parse(targetTime) < Date.parse(restored.manifest.created_at)) throw new Error('This time is earlier than the chosen complete base backup. Choose an older base or a later time.')
    const restore = `${quoteCommand(process.execPath)} ${quoteCommand(path.join(config.service.root, 'scripts', 'wal-archive.mjs'))} restore --wal-name "%f" --archive-dir ${quoteCommand(config.recovery.walDir)} --key-file ${quoteCommand(config.recovery.walKeyFile)} --target "%p"`
    // Explicitly override every copied live bind/SSL/archive setting. Only the
    // nonce-named drill target is changed. Never promote or serve till traffic.
    const postgresTime = targetTime.replace('T', ' ').replace(/Z$/, '+00:00')
    await writeFile(path.join(data, 'postgresql.auto.conf'), `listen_addresses='127.0.0.1'\nport=${port}\nssl=off\narchive_mode=off\nhot_standby=on\nrestore_command=${literal(restore)}\nrecovery_target_time=${literal(postgresTime)}\nrecovery_target_action='pause'\nrecovery_target_timeline='latest'\n`, { mode: 0o600 })
    await writeFile(path.join(data, 'pg_hba.conf'), 'host all all 127.0.0.1/32 trust\nhost all all ::1/128 reject\n', { mode: 0o600 })
    await writeFile(path.join(data, 'recovery.signal'), '', { flag: 'wx', mode: 0o600 })
    await tool(binary(config, 'pg_ctl'), ['-D', data, '-l', path.join(drillRoot, 'postgres.log'), '-w', 'start'], process.env, 180000)
    started = true
    let client: pg.Client | null = null
    let paused = false
    for (let attempt = 0; attempt < 120; attempt++) {
      client = new pg.Client({ host: '127.0.0.1', port, database: config.db.database, user: 'postgres', connectionTimeoutMillis: 2000, application_name: 'bar-local-pitr-drill' })
      try {
        await client.connect()
        const row = (await client.query("SELECT current_setting('data_directory') AS directory, pg_is_in_recovery() AS recovering, pg_get_wal_replay_pause_state() AS state")).rows[0]
        if (path.resolve(row.directory).toLowerCase() !== path.resolve(data).toLowerCase()) throw new Error('Recovery drill identity mismatch.')
        paused = row.recovering === true && row.state === 'paused'
        if (paused) break
      } catch (error) { if (error instanceof Error && error.message.includes('identity mismatch')) throw error }
      await client.end().catch(() => {}); client = null
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (!paused || !client) throw new Error('The requested recovery point was not reached. Missing WAL or a recovery target without a later archived commit must not be treated as a successful restore.')
    try {
      const verification = await verifyRestoredDatabase({ query: async (sql, params) => client!.query(sql, params ? [...params] : undefined) }, { readOnlySnapshot: true, migrationsDir: config.backup.migrationsDir, expectedMigrationOwner: 'bar_local_migrator', runtimeRole: config.db.user, runtimeHost: '127.0.0.1', runtimePort: port, runtimeDatabase: config.db.database, runtimeUser: config.db.user, runtimePassword: config.db.password })
      if (!verification.ok) throw new Error(`Recovered financial/security invariants did not pass: ${verification.checks.filter(check => check.status === 'fail').map(check => check.name).join(', ')}. The copy remains unqualified.`)
      await inspect?.(client)
      const replay = (await client.query('SELECT pg_last_wal_replay_lsn()::text AS lsn, pg_last_xact_replay_timestamp() AS last_transaction')).rows[0]
      const report = { verified: true, promoted: false, activation_verified: false, live_data_changed: false, base_id: id, requested_time: targetTime, system_identifier: restored.manifest.system_identifier, replay_lsn: replay.lsn, last_transaction: replay.last_transaction, checks: verification.checks, completed_at: new Date().toISOString(), cleanup: { cluster_stopped: false, data_removed: false } }
      reportToSave = report
      await mkdir(path.join(root, 'reports'), { recursive: true })
      await writeFile(path.join(root, 'reports', `${path.basename(drillRoot)}.json`), JSON.stringify(report), { flag: 'wx', mode: 0o600 })
      verified = true
      return report
    } finally { await client.end() }
  } finally {
    try {
      if (await lstat(path.join(data, 'postmaster.pid')).then(() => true, () => false)) {
        const identity = (await readFile(path.join(data, 'postmaster.pid'), 'utf8')).split(/\r?\n/)
        if (path.resolve(identity[1] ?? '').toLowerCase() !== path.resolve(data).toLowerCase() || Number(identity[3]) !== port) throw new Error('Refusing to stop a recovery process whose identity changed.')
        await tool(binary(config, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], process.env, 60000)
      }
      if (reportToSave) reportToSave.cleanup.cluster_stopped = true
      if (verified && (await realpath(drillRoot)).toLowerCase() === path.resolve(drillRoot).toLowerCase()) {
        try {
          // Retain postgres.log as evidence; Windows may still hold its handle
          // briefly after pg_ctl confirms shutdown. Only remove this owned data.
          await rm(data, { recursive: true, maxRetries: 10, retryDelay: 500 })
          if (reportToSave) reportToSave.cleanup.data_removed = true
        } catch { if (reportToSave) reportToSave.cleanup.message = 'Verified copy stopped; temporary data retained because Windows still holds a file. Live data was unchanged.' }
      }
      if (reportToSave) await writeFile(path.join(root, 'reports', `${path.basename(drillRoot)}.json`), JSON.stringify(reportToSave), { mode: 0o600 })
    } finally { await release() }
  }
}

/** Portable owner-held recovery material; no plaintext key leaves this function. */
export async function exportRecoveryKeys(config: ServiceConfig, passphrase: string) {
  if (passphrase.length < 12 || passphrase.length > 1024) throw new Error('Use a recovery passphrase of12–1024 characters.')
  if (!config.recovery?.walKeyFile) throw new Error('A WAL recovery key has not been provisioned.')
  const backup = loadEncryptionKey({ keyFile: config.backup.keyFile })
  const wal = await readFile(config.recovery.walKeyFile, 'utf8')
  if (!/^[a-f0-9]{64}\s*$/i.test(wal)) throw new Error('The WAL recovery key has an unsupported format.')
  const salt = randomBytes(16), nonce = randomBytes(12)
  const derived = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', derived, nonce)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ version: 1, backup_key: backup.material.toString('hex'), wal_key: wal.trim(), created_at: new Date().toISOString() })), cipher.final()])
  return { version: 1, algorithm: 'scrypt-aes-256-gcm', salt: salt.toString('hex'), nonce: nonce.toString('hex'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('hex') }
}
export function unlockRecoveryKeys(bundle: { version: number; algorithm: string; salt: string; nonce: string; ciphertext: string; tag: string }, passphrase: string): { version: 1; backup_key: string; wal_key: string; created_at: string } {
  if (bundle.version !== 1 || bundle.algorithm !== 'scrypt-aes-256-gcm' || !/^[a-f0-9]{32}$/.test(bundle.salt) || !/^[a-f0-9]{24}$/.test(bundle.nonce) || !/^[a-f0-9]{32}$/.test(bundle.tag) || bundle.ciphertext.length > 8192) throw new Error('Recovery key bundle is invalid.')
  try {
    const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, Buffer.from(bundle.salt, 'hex'), 32), Buffer.from(bundle.nonce, 'hex'))
    decipher.setAuthTag(Buffer.from(bundle.tag, 'hex'))
    const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, 'base64')), decipher.final()]).toString('utf8'))
    if (decoded.version !== 1 || !/^[a-f0-9]{64}$/.test(decoded.backup_key) || !/^[a-f0-9]{64}$/.test(decoded.wal_key)) throw new Error('Invalid recovery key material.')
    return decoded
  } catch { throw new Error('Recovery passphrase is incorrect or the key bundle was altered.') }
}
