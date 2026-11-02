// @ts-check

/**
 * Automatic "use this computer as the Bar server" installation and owner
 * commissioning.
 *
 * The renderer never supplies a service address, setup secret, filesystem
 * path, command line or elevated operation. It supplies only the new
 * business/owner details and a PIN. This module:
 *
 *  1. verifies the packaged server payload against its SHA-256 manifest;
 *  2. selects free loopback ports and a dedicated ProgramData root;
 *  3. generates the service secrets once and keeps them in OS-protected
 *     storage before any elevated work starts;
 *  4. launches the existing reviewed Windows installer through one guarded
 *     UAC prompt, with resumable phase/status files and a redacted log;
 *  5. waits for authenticated service readiness; and
 *  6. commits the first owner through the existing recoverable
 *     `runtime.setupOwner` contract using the same staged setup secret.
 *
 * A crash before the installer starts resumes at `prepared`; a crash after it
 * starts resumes the same installer attempt against the same directories and
 * secret files; a crash after installation resumes owner commissioning with a
 * freshly entered PIN. The workflow never creates a second authority, deletes
 * a PostgreSQL data directory, or falls back to cloud.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { connect } from 'node:net'
import { BarLocalAdapterError } from './authority.js'
import { createHttpTransport } from './client.js'

export const SERVER_SETUP_STATE_VERSION = 1
export const SERVER_SETUP_PHASES = Object.freeze([
  'prepared',
  'installing',
  'installed',
  'owner_pending',
  'complete',
  'failed'
])

const STATE_NAME = 'server-setup.bin'
const PAYLOAD_DIR_NAME = 'bar-local-server'
const REQUIRED_PAYLOAD_FILES = Object.freeze([
  'server/dist/server.js',
  'server/package.json',
  'server/scripts/provision-local.mjs',
  'server/scripts/bar-operations.mjs',
  'server/scripts/write-api-certificate.mjs',
  'server/packaging/windows/create-api-certificate.ps1',
  'server/packaging/windows/install-server.ps1',
  'server/packaging/windows/configure-postgres.ps1',
  'server/packaging/windows/install-service.ps1',
  'server/packaging/windows/install-backup-task.ps1',
  'server/packaging/windows/lib/BarLocalCommon.ps1',
  'node/node.exe',
  'postgres/bin/postgres.exe',
  'postgres/bin/initdb.exe',
  'postgres/bin/pg_ctl.exe',
  'postgres/bin/psql.exe',
  'postgres/bin/pg_dump.exe',
  'postgres/bin/pg_isready.exe',
  'postgres/bin/pg_basebackup.exe',
  'postgres/bin/pg_verifybackup.exe',
  'postgres/lib/dict_snowball.dll'
])

const INSTALL_WORKING_MARGIN_BYTES = 1024n ** 3n + 64n * 1024n ** 2n
const RECOMMENDED_OPERATIONAL_HEADROOM_BYTES = 4n * 1024n ** 3n
const GIB = 1024n ** 3n
const DEFAULT_HTTP_PORT = 8787
const DEFAULT_DB_PORT = 55432
const STATE_PHASE_LABELS = Object.freeze({
  prepared: 'Prepared - waiting for the Windows installer',
  installing: 'Installing the local Bar service',
  installed: 'Service installed - waiting for the owner sign-in',
  owner_pending: 'Creating the first owner',
  complete: 'Local Bar setup completed',
  failed: 'Setup stopped - review the error and retry'
})

/** @typedef {'prepared'|'installing'|'installed'|'owner_pending'|'complete'|'failed'} ServerSetupPhase */
/**
 * @typedef {{
 *   version: 1,
 *   attempt_id: string,
 *   phase: ServerSetupPhase,
 *   created_at: string,
 *   updated_at: string,
 *   owner: {business_name: string, outlet_name: string, owner_name: string, owner_email: string, currency: string, timezone: string, device_name: string, business_profile: Record<string, string>},
 *   install: {
 *     install_dir: string, data_dir: string, pg_data_dir: string, backup_dir: string,
 *     pg_bin: string, node_path: string, server_root: string, installer_script: string,
 *     http_port: number, db_port: number, base_url: string, upgrade: boolean,
 *     tls_cert_file?: string, tls_key_file?: string, certificate_fingerprint?: string
 *   },
 *   secrets: {setup_secret: string, backup_key: string, replication_password: string},
 *   staging: {root: string, secret_dir: string, wrapper_path: string, status_path: string, log_path: string},
 *   payload: {dir: string, manifest_sha256: string, service_version: string, postgres_version: string, node_version: string},
 *   last_error: {code: string, message: string} | null,
 *   installed_at: string | null,
 *   completed_at: string | null
 * }} ServerSetupState
 */
/** @typedef {{code: string, message: string, details?: Record<string, unknown>}} SetupBlocker */

/** @param {string} value */
function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

/** @param {string} file @param {string | Buffer} data */
function writeDurableAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const staging = `${file}.tmp-${process.pid}-${randomUUID()}`
  writeFileSync(staging, data, { mode: 0o600, flag: 'wx' })
  try { renameSync(staging, file) } catch (error) {
    try { unlinkSync(staging) } catch {}
    throw error
  }
}

/** @param {string} value */
function safeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '' || isAbsolute(value)) return false
  const normalized = value.replaceAll('\\', '/')
  if (normalized.split('/').some((part) => part === '..' || part === '')) return false
  return true
}

/** @param {unknown} value */
export function parseServerPayloadManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The server payload manifest is not an object.')
  }
  const record = /** @type {Record<string, unknown>} */ (value)
  if (record.schema !== 1) throw new Error('The server payload manifest schema is unsupported.')
  if (typeof record.service_version !== 'string' || record.service_version.trim() === '') {
    throw new Error('The server payload manifest has no service version.')
  }
  if (typeof record.postgres_version !== 'string' || !/^17\./.test(record.postgres_version)) {
    throw new Error('The server payload manifest does not describe PostgreSQL 17.')
  }
  if (typeof record.node_version !== 'string' || !/^v?(?:2[0-9]|[3-9][0-9])\./.test(record.node_version)) {
    throw new Error('The server payload manifest does not describe Node.js 20 or newer.')
  }
  if (!record.files || typeof record.files !== 'object' || Array.isArray(record.files)) {
    throw new Error('The server payload manifest has no file table.')
  }
  /** @type {Record<string, string>} */
  const files = {}
  for (const [name, hash] of Object.entries(/** @type {Record<string, unknown>} */ (record.files))) {
    if (!safeRelative(name)) throw new Error(`The server payload manifest contains an unsafe path: ${name}`)
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) {
      throw new Error(`The server payload manifest has an invalid hash for ${name}.`)
    }
    files[name] = hash.toLowerCase()
  }
  for (const required of REQUIRED_PAYLOAD_FILES) {
    if (!files[required]) throw new Error(`The server payload is missing ${required}.`)
  }
  return {
    schema: 1,
    service_version: record.service_version,
    postgres_version: record.postgres_version,
    node_version: record.node_version,
    created_at: typeof record.created_at === 'string' ? record.created_at : null,
    files
  }
}

/** @param {string} file */
export function hashFileSha256(file) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolvePromise(hash.digest('hex')))
  })
}

function measuredDirectoryBytes(root) {
  let total = 0n
  for (const name of readdirSync(root)) {
    const file = join(root, name)
    const info = lstatSync(file)
    if (info.isSymbolicLink()) throw new BarLocalAdapterError('SERVER_PAYLOAD_CORRUPT', 'The packaged local Bar server contains a linked file; reinstall the POS build.')
    if (info.isDirectory()) total += measuredDirectoryBytes(file)
    else if (info.isFile()) total += BigInt(info.size)
    else throw new BarLocalAdapterError('SERVER_PAYLOAD_CORRUPT', 'The packaged local Bar server contains an unsupported file; reinstall the POS build.')
  }
  return total
}

/**
 * Verify every file in the manifest. A missing file, symlink, directory or
 * digest mismatch refuses setup. The manifest hash is displayed but is not an
 * authenticity signature; the package itself is delivered inside the signed
 * application installer.
 * @param {{payloadDir: string, hashFile?: (file: string) => Promise<string>}} options
 */
export async function verifyServerPayload({ payloadDir, hashFile = hashFileSha256 }) {
  const manifestPath = join(payloadDir, 'manifest.json')
  let manifestBytes
  try {
    manifestBytes = readFileSync(manifestPath)
  } catch (error) {
    throw new BarLocalAdapterError('SERVER_PAYLOAD_MISSING', 'This build does not contain the local Bar server package. Install the Bar server package that matches this POS build, then retry.', { cause: error, details: { manifest_path: manifestPath } })
  }
  let manifest
  try {
    manifest = parseServerPayloadManifest(JSON.parse(manifestBytes.toString('utf8')))
  } catch (error) {
    throw new BarLocalAdapterError('SERVER_PAYLOAD_MANIFEST_INVALID', 'The packaged local Bar server manifest is invalid. Reinstall this POS build; do not run an unverified server package.', { cause: error })
  }
  const errors = []
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = resolve(payloadDir, name)
    const rel = relative(payloadDir, file)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      errors.push(`${name}: path escapes the payload directory`)
      continue
    }
    let info
    try { info = lstatSync(file) } catch { errors.push(`${name}: missing`); continue }
    if (info.isSymbolicLink()) { errors.push(`${name}: symbolic links are not allowed`); continue }
    if (!info.isFile()) { errors.push(`${name}: not a regular file`); continue }
    const actual = await hashFile(file)
    if (actual !== expected) errors.push(`${name}: SHA-256 mismatch`)
    if (errors.length >= 20) break
  }
  if (errors.length > 0) {
    throw new BarLocalAdapterError('SERVER_PAYLOAD_CORRUPT', 'The packaged local Bar server package failed its integrity check. Reinstall this POS build; do not bypass the check.', { details: { errors } })
  }
  return {
    manifest,
    manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex'),
    checked_files: Object.keys(manifest.files).length,
    payload_bytes: measuredDirectoryBytes(payloadDir).toString(),
    payload_dir: payloadDir
  }
}

export function computeSetupStorage(freeBytes, payloadBytes) {
  const free = typeof freeBytes === 'bigint' && freeBytes >= 0n ? freeBytes : null
  const payload = typeof payloadBytes === 'bigint' && payloadBytes >= 0n ? payloadBytes : null
  const required = payload === null ? null : payload + INSTALL_WORKING_MARGIN_BYTES
  const recommended = required === null ? null : required + RECOMMENDED_OPERATIONAL_HEADROOM_BYTES
  const shortfall = free === null || required === null || free >= required ? 0n : required - free
  const status = free === null ? 'unknown' : required !== null && free < required ? 'blocked' : recommended !== null && free < recommended ? 'advisory' : 'ok'
  const gib = (bytes, roundUp = false) => bytes === null ? null : roundUp
    ? Math.ceil(Number(bytes) / Number(GIB) * 10) / 10
    : Math.floor(Number(bytes) / Number(GIB) * 10) / 10
  return {
    status,
    free_bytes: free?.toString() ?? null,
    required_free_bytes: required?.toString() ?? null,
    recommended_free_bytes: recommended?.toString() ?? null,
    shortfall_bytes: shortfall.toString(),
    free_gib: gib(free),
    required_free_gib: gib(required, true),
    recommended_free_gib: gib(recommended, true),
    shortfall_gib: shortfall > 0n ? Math.max(0.1, gib(shortfall, true)) : 0
  }
}

/** @param {number} port @param {string} host */
export function probeTcpPort(port, host = '127.0.0.1') {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host })
    const done = (free) => { socket.destroy(); resolvePromise(free) }
    socket.setTimeout(750)
    socket.once('connect', () => done(false))
    socket.once('timeout', () => done(true))
    socket.once('error', () => done(true))
  })
}

/**
 * @param {{start: number, host?: string, isFree?: (port: number, host: string) => Promise<boolean>, limit?: number}} options
 */
export async function chooseFreePort({ start, host = '127.0.0.1', isFree = probeTcpPort, limit = 100 }) {
  for (let port = start; port < start + limit && port <= 65535; port += 1) {
    if (await isFree(port, host)) return port
  }
  throw new BarLocalAdapterError('NO_FREE_PORT', `No free TCP port was found from ${start} to ${Math.min(start + limit - 1, 65535)} on ${host}. Close the conflicting program or choose a different server PC.`)
}

/** @param {string} path */
function nearestExisting(path) {
  let cursor = resolve(path)
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) return cursor
    cursor = parent
  }
  return cursor
}

/** @param {string} path */
export function freeDiskBytes(path) {
  try {
    const stats = statfsSync(nearestExisting(path), { bigint: true })
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

/** @param {unknown} value */
export function normalizeOwnerDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'Owner setup details are required.')
  }
  const input = /** @type {Record<string, unknown>} */ (value)
  /** @param {string} key @param {number} max */
  const text = (key, max) => {
    const raw = input[key]
    if (typeof raw !== 'string') throw new BarLocalAdapterError('VALIDATION_FAILED', `${key} is required.`)
    const trimmed = raw.trim()
    if (trimmed.length < 1 || trimmed.length > max) throw new BarLocalAdapterError('VALIDATION_FAILED', `${key} must contain 1-${max} characters.`)
    return trimmed
  }
  const pin = typeof input.pin === 'string' ? input.pin : ''
  if (!/^\d{4,12}$/.test(pin)) throw new BarLocalAdapterError('VALIDATION_FAILED', 'The owner PIN must contain 4-12 digits.')
  const ownerEmail = typeof input.owner_email === 'string' ? input.owner_email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || ownerEmail.length > 254) throw new BarLocalAdapterError('VALIDATION_FAILED', 'Enter a valid owner email address.')
  const currency = typeof input.currency === 'string' && input.currency.trim() !== '' ? input.currency.trim().toUpperCase() : 'BWP'
  if (!/^[A-Z]{3}$/.test(currency)) throw new BarLocalAdapterError('VALIDATION_FAILED', 'Currency must be a three-letter code such as BWP.')
  const timezone = typeof input.timezone === 'string' && input.timezone.trim() !== '' ? input.timezone.trim() : 'Africa/Gaborone'
  if (timezone.length > 80 || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timezone)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'Timezone must be an IANA name such as Africa/Gaborone.')
  }
  const profileInput = input.business_profile && typeof input.business_profile === 'object' && !Array.isArray(input.business_profile)
    ? /** @type {Record<string, unknown>} */ (input.business_profile)
    : input
  const business_profile = {}
  for (const [key, max] of Object.entries({ company_name: 200, address: 240, city: 120, country: 120, phone: 80, email: 254, website: 240, vat_number: 80 })) {
    const value = profileInput[key]
    if (typeof value === 'string' && value.trim()) business_profile[key] = value.trim().slice(0, max)
  }
  return {
    business_name: text('business_name', 200),
    outlet_name: text('outlet_name', 120),
    owner_name: text('owner_name', 120),
    owner_email: ownerEmail,
    device_name: typeof input.device_name === 'string' && input.device_name.trim() !== '' ? text('device_name', 120) : 'Bar office till',
    currency,
    timezone,
    business_profile,
    pin
  }
}

/**
 * @param {ServerSetupState['install']} install
 */
export function installSecretsDir(install) {
  return join(dirname(install.data_dir), 'secrets')
}

/**
 * @param {ServerSetupState['install']} install
 */
export function buildInstallerArguments(install) {
  const secretsDir = installSecretsDir(install)
  return [
    ['InstallDir', install.install_dir],
    ['DataDir', install.data_dir],
    ['PgBin', install.pg_bin],
    ['PgDataDir', install.pg_data_dir],
    ['DbPort', String(install.db_port)],
    ['HttpPort', String(install.http_port)],
    ['NodePath', install.node_path],
    ['ServiceRoot', install.server_root],
    ['BootstrapPasswordFile', join(secretsDir, 'bootstrap-password.txt')],
    ['SetupSecretFile', join(secretsDir, 'setup-secret.txt')],
    ['BackupKeyFile', join(secretsDir, 'backup-key.txt')],
    ['ReplicationPasswordFile', join(secretsDir, 'replication-password.txt')],
    ['BackupDir', install.backup_dir],
    ['DbName', 'bar_local'],
    ...(install.tls_cert_file && install.tls_key_file ? [
      ['HttpHost', '0.0.0.0'], ['TlsCertFile', install.tls_cert_file], ['TlsKeyFile', install.tls_key_file], ['LoopbackDatabase', null], ['RequirePrivateFirewall', null]
    ] : [['HttpHost', '127.0.0.1'], ['SkipFirewall', null]]),
    [install.upgrade ? 'Upgrade' : 'InitDb', null]
  ]
}

/** @param {ServerSetupState} state */
export function buildInstallerWrapper(state) {
  const args = buildInstallerArguments(state.install)
  const secretsDir = installSecretsDir(state.install)
  const argumentLines = args.map(([name, value]) => value === null
    ? `  '-${name}'`
    : `  '-${name}', ${psQuote(value)}`).join('\n')
  const secretCopies = [
    ['setup-secret.txt', state.secrets.setup_secret],
    ['backup-key.txt', state.secrets.backup_key],
    ['replication-password.txt', state.secrets.replication_password]
  ].map(([name]) => `Copy-IfMissing ${psQuote(join(state.staging.secret_dir, String(name)))} ${psQuote(join(secretsDir, String(name)))}`).join('\n')
  return `# Generated by Tsa Bonno HospitalityOS automatic Bar server setup.
# This file contains paths only, never secrets. It is run once by the operator
# through the reviewed UAC prompt and writes a machine-readable status file.
$ErrorActionPreference = 'Stop'
$statusPath = ${psQuote(state.staging.status_path)}
$logPath = ${psQuote(state.staging.log_path)}
$secretsDir = ${psQuote(secretsDir)}
$installer = ${psQuote(state.install.installer_script)}
$payloadDir = ${psQuote(state.payload.dir)}
$pgSource = ${psQuote(join(state.payload.dir, 'postgres'))}
$pgTarget = ${psQuote(dirname(dirname(state.install.pg_bin)))}
$nodeSource = ${psQuote(join(state.payload.dir, 'node', 'node.exe'))}
$nodeTarget = ${psQuote(state.install.node_path)}
$script:certificateInfo = $null
$env:BAR_LOCAL_SETUP_PROGRESS_FILE = Join-Path (Split-Path -Parent $statusPath) 'progress.json'
$attemptMutex = New-Object System.Threading.Mutex($false, ${psQuote(`Global\\TsaBonnoBarSetup-${state.attempt_id}`)})
if (-not $attemptMutex.WaitOne(0)) { throw 'This Bar installation attempt is already running. Keep its existing window open.' }

function Write-SetupStatus {
  param([string]$Phase, [string]$Message, [string]$Code = '')
  $payload = [ordered]@{
    phase = $Phase
    message = $Message
    code = $Code
    updated_at = (Get-Date).ToUniversalTime().ToString('o')
    certificate_fingerprint = if ($null -ne $script:certificateInfo) { $script:certificateInfo.fingerprint } else { $null }
  }
  $temporary = "$statusPath.tmp"
  $json = $payload | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($temporary, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $statusPath -Force
}

function Copy-IfMissing {
  param([string]$Source, [string]$Destination)
  if (Test-Path -LiteralPath $Destination) { return }
  if (-not (Test-Path -LiteralPath $Source)) { throw "The generated service secret is missing: $Source" }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Get-TreeBytes {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path -PathType Leaf) { return [int64](Get-Item -LiteralPath $Path).Length }
  $measure = Get-ChildItem -LiteralPath $Path -File -Recurse -Force | Measure-Object -Property Length -Sum
  if ($null -eq $measure.Sum) { return [int64]0 }
  return [int64]$measure.Sum
}

function Get-FreeBytes {
  param([string]$Path)
  $root = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($Path))
  $drive = New-Object System.IO.DriveInfo($root)
  return [int64]$drive.AvailableFreeSpace
}

function Copy-RuntimeIfMissing {
  param([string]$Source, [string]$Destination, [string]$Probe)
  if (Test-Path -LiteralPath (Join-Path $Destination $Probe)) { return }
  if (-not (Test-Path -LiteralPath $Source)) { throw "The packaged server runtime is missing: $Source" }
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
  if (-not (Test-Path -LiteralPath (Join-Path $Destination $Probe))) {
    throw "The packaged server runtime could not be copied to $Destination"
  }
}

try {
  $payloadBytes = Get-TreeBytes $payloadDir
  $requiredBytes = $payloadBytes + 1GB + 64MB
  $freeBytes = Get-FreeBytes $nodeTarget
  if ($freeBytes -lt $requiredBytes) {
    $shortfall = [math]::Max(0.1, [math]::Ceiling(($requiredBytes - $freeBytes) / 1GB * 10) / 10)
    $drive = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($nodeTarget))
    throw "More storage space is needed - Free another $shortfall GiB on $drive, then select Check again."
  }
  Write-SetupStatus 'installing' 'Preparing protected service secrets'
  New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null
${secretCopies}
  Write-SetupStatus 'installing' 'Copying the pinned PostgreSQL and Node runtime'
  Copy-RuntimeIfMissing $pgSource $pgTarget 'bin\\postgres.exe'
  $nodeDirectory = Split-Path -Parent $nodeTarget
  if (-not (Test-Path -LiteralPath $nodeTarget)) {
    New-Item -ItemType Directory -Force -Path $nodeDirectory | Out-Null
    $nodeTemp = "$nodeTarget.tmp"
    Copy-Item -LiteralPath $nodeSource -Destination $nodeTemp -Force
    Move-Item -LiteralPath $nodeTemp -Destination $nodeTarget -Force
  }
  if (-not (Test-Path -LiteralPath $nodeTarget)) { throw "The packaged Node runtime could not be copied to $nodeTarget" }
${state.install.tls_cert_file ? `  Write-SetupStatus 'installing' 'Creating the protected Bar network identity'
  $certificateJson = & ${psQuote(join(state.payload.dir, 'server', 'packaging', 'windows', 'create-api-certificate.ps1'))} -NodePath $nodeTarget -OutputDir ${psQuote(dirname(state.install.tls_cert_file))}
  if ($LASTEXITCODE -ne 0) { throw 'The protected Bar network identity could not be created.' }
  $script:certificateInfo = $certificateJson | ConvertFrom-Json
  if ($script:certificateInfo.fingerprint -notmatch '^[a-f0-9]{64}$') { throw 'The Bar certificate fingerprint is invalid.' }
` : ''}
  Write-SetupStatus 'installing' 'Running the local Bar server installer'
  $arguments = @(
${argumentLines}
  )
  & $installer @arguments *>&1 | Tee-Object -FilePath $logPath
  if ($LASTEXITCODE -ne 0) { throw "The local Bar installer exited with code $LASTEXITCODE." }
  Write-SetupStatus 'installed' 'The local Bar service was installed'
  exit 0
}
catch {
  $message = $_.Exception.Message
  Write-SetupStatus 'failed' $message 'INSTALLER_FAILED'
  if (-not (Test-Path -LiteralPath $logPath)) {
    $message | Set-Content -LiteralPath $logPath -Encoding UTF8
  } else {
    Add-Content -LiteralPath $logPath -Value $message -Encoding UTF8
  }
  exit 1
}
`
}

/** @param {string} text @param {number} [maxLines] */
export function redactLogTail(text, maxLines = 40) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean).slice(-maxLines)
  return lines.map((line) => line
    .replace(/\b[a-f0-9]{64}\b/gi, '[redacted]')
    .replace(/\b(bld_[A-Za-z0-9_-]{20,})\b/g, '[redacted]')
    .replace(/(setup[_ -]?secret|password|token)\s*[:=]\s*\S+/gi, '$1: [redacted]')
  ).join('\n')
}

/** @param {ServerSetupState} state */
export function publicSetupState(state) {
  return {
    version: state.version,
    attempt_id: state.attempt_id,
    phase: state.phase,
    phase_label: STATE_PHASE_LABELS[state.phase],
    created_at: state.created_at,
    updated_at: state.updated_at,
    business_name: state.owner.business_name,
    outlet_name: state.owner.outlet_name,
    owner_name: state.owner.owner_name,
    base_url: state.install.base_url,
    install_dir: state.install.install_dir,
    data_dir: state.install.data_dir,
    http_port: state.install.http_port,
    db_port: state.install.db_port,
    service_version: state.payload.service_version,
    postgres_version: state.payload.postgres_version,
    payload_manifest_sha256: state.payload.manifest_sha256,
    can_resume: ['prepared', 'installing', 'installed', 'owner_pending', 'failed'].includes(state.phase),
    can_cancel: state.phase === 'prepared',
    pin_required: ['installed', 'owner_pending'].includes(state.phase),
    last_error: state.last_error
  }
}

/**
 * @typedef {{exitCode: number, stdout: string, stderr: string}} RunnerResult
 * @typedef {(input: {wrapperPath: string, cwd: string}) => Promise<RunnerResult>} SetupRunner
 */

/**
 * @param {string} baseUrl
 * @param {{timeoutMs?: number, intervalMs?: number, certificate_fingerprint?: string}} [options]
 */
export async function probeServiceLive(baseUrl, { timeoutMs = 60000, intervalMs = 1200, certificate_fingerprint } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const transport = createHttpTransport({ base_url: baseUrl, certificate_fingerprint, request_timeout_ms: 3000 })
      let response
      try { response = await transport.get('/v1/health/live') } finally { transport.close() }
      if (response.status === 200) {
        const body = response.body
        if (body && body.ok === true && body.status === 'live') return true
      }
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs))
  }
  return false
}

/** @type {SetupRunner} */
export async function defaultElevatedRunner({ wrapperPath, cwd }) {
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const elevationHost = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
  if (/["%\r\n]/.test(executable)) throw new Error('The Windows installation path cannot be safely used for the installer launcher.')
  // Encode the inner script: Start-Process joins ArgumentList into a native
  // command line and does not preserve quoting around a -File path.
  const inner = Buffer.from(`$ErrorActionPreference='Stop'; & ${psQuote(wrapperPath)}; exit $LASTEXITCODE`, 'utf16le').toString('base64')
  // On affected Windows hosts ShellExecute(runas, powershell.exe) fails with
  // 0xffffffff before the wrapper starts. Elevate the signed Windows command
  // host once, then run the fixed PowerShell executable in that same elevated
  // child. UAC remains required; the cashier process stays non-elevated.
  const nativeArguments = `/d /v:off /s /c ""${executable}" -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${inner}"`
  const command = [
    "$ErrorActionPreference='Stop'",
    `$p = Start-Process -FilePath ${psQuote(elevationHost)} -WorkingDirectory ${psQuote(cwd)} -ArgumentList ${psQuote(nativeArguments)} -Verb RunAs -PassThru -Wait -WindowStyle Hidden`,
    'exit $p.ExitCode'
  ].join('; ')
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout = (stdout + String(chunk)).slice(-32768) })
    child.stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-32768) })
    const timer = setTimeout(() => {
      // Do not terminate an elevated installer or PostgreSQL on a timeout.
      resolvePromise({ exitCode: 124, stdout, stderr: 'Installation is still awaiting confirmation. Preserve this attempt and inspect its progress; do not start another installation.' })
    }, 30 * 60 * 1000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); resolvePromise({ exitCode: code ?? 1, stdout, stderr }) })
  })
}

export class ServerSetupOrchestrator {
  /**
   * @param {{
   *   runtime: {status: () => Record<string, any>, assertNoSavedCloudBusiness: () => void, setupOwner: (request: Record<string, unknown>) => Promise<Record<string, any>>, recoverOwnerPassword?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>},
   *   userDataPath: string,
   *   basePath: string,
   *   isPackaged: boolean,
   *   buildProductId: string,
   *   safeStorage: {isEncryptionAvailable(): boolean, encryptString(value: string): Buffer, decryptString(value: Buffer): string},
   *   installRoot?: string,
   *   payloadDir?: string,
   *   platform?: NodeJS.Platform,
   *   now?: () => Date,
   *   runner?: SetupRunner,
   *   verifyPayload?: typeof verifyServerPayload,
   *   isPortFree?: (port: number, host: string) => Promise<boolean>,
   *   diskFree?: (path: string) => bigint | null,
   *   serviceDetected?: () => Promise<boolean>,
   *   serviceLive?: (baseUrl: string, options?: {certificate_fingerprint?: string}) => Promise<boolean>
   * }} options
   */
  constructor(options) {
    this.runtime = options.runtime
    this.userDataPath = options.userDataPath
    this.basePath = options.basePath
    this.isPackaged = options.isPackaged
    this.buildProductId = options.buildProductId
    this.safeStorage = options.safeStorage
    this.platform = options.platform ?? process.platform
    this.now = options.now ?? (() => new Date())
    this.runner = options.runner ?? defaultElevatedRunner
    this.verifyPayload = options.verifyPayload ?? verifyServerPayload
    this.isPortFree = options.isPortFree ?? probeTcpPort
    this.diskFree = options.diskFree ?? freeDiskBytes
    this.serviceDetected = options.serviceDetected ?? (async () =>
      existsSync(join(this.installRoot, 'service.env'))
      || existsSync(join(this.installRoot, 'pgdata', 'PG_VERSION'))
      || existsSync(join(this.installRoot, 'server', 'dist', 'server.js')))
    this.serviceLive = options.serviceLive ?? probeServiceLive
    this.installRoot = options.installRoot ?? join(process.env.ProgramData || 'C:\\ProgramData', 'Tsa Bonno', 'BarLocal')
    const resourcesPath = /** @type {{resourcesPath?: string}} */ (process).resourcesPath
    this.payloadDir = options.payloadDir ?? (options.isPackaged && resourcesPath
      ? join(resourcesPath, PAYLOAD_DIR_NAME)
      : join(options.basePath, 'build', PAYLOAD_DIR_NAME))
    this.stateRoot = join(options.userDataPath, 'bar-local', 'server-setup')
    this.statePath = join(this.stateRoot, STATE_NAME)
    this.busy = false
    /** @type {Promise<void> | null} */
    this.installPromise = null
  }

  /** @returns {ServerSetupState | null} */
  readState() {
    let bytes
    try { bytes = readFileSync(this.statePath) } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw new BarLocalAdapterError('SETUP_STATE_UNREADABLE', 'The protected Bar server setup state cannot be read. Preserve this computer and contact support; do not start a second setup.', { cause: error })
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new BarLocalAdapterError('SECURE_STORAGE_UNAVAILABLE', 'OS secure storage is unavailable; the saved Bar server setup cannot be opened.')
    }
    let parsed
    try {
      parsed = JSON.parse(this.safeStorage.decryptString(bytes))
    } catch (error) {
      throw new BarLocalAdapterError('SETUP_STATE_CORRUPT', 'The protected Bar server setup state is invalid. Preserve this computer and contact support; do not delete the setup record or the Bar database.', { cause: error })
    }
    if (!parsed || parsed.version !== SERVER_SETUP_STATE_VERSION || !SERVER_SETUP_PHASES.includes(parsed.phase)) {
      throw new BarLocalAdapterError('SETUP_STATE_CORRUPT', 'The protected Bar server setup state has an unsupported version. Preserve this computer and contact support.')
    }
    return /** @type {ServerSetupState} */ (parsed)
  }

  /** @param {ServerSetupState} state */
  #writeState(state) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new BarLocalAdapterError('SECURE_STORAGE_UNAVAILABLE', 'OS secure storage is unavailable; setup cannot continue safely.')
    }
    state.updated_at = this.now().toISOString()
    writeDurableAtomic(this.statePath, this.safeStorage.encryptString(JSON.stringify(state)))
  }

  /** @param {ServerSetupState} state @param {ServerSetupPhase} phase @param {{code: string, message: string} | null} [error] */
  #setPhase(state, phase, error = null) {
    state.phase = phase
    state.last_error = error
    if (phase === 'installed') state.installed_at = this.now().toISOString()
    if (phase === 'complete') state.completed_at = this.now().toISOString()
    this.#writeState(state)
  }

  /** @param {string} text */
  #readLogTail(text = '') {
    try { return redactLogTail(readFileSync(text, 'utf8')) } catch { return '' }
  }

  async preflight() {
    /** @type {SetupBlocker[]} */
    const blockers = []
    /** @type {string[]} */
    const warnings = []
    const state = (() => {
      try { return this.readState() } catch (error) {
        blockers.push({ code: error instanceof BarLocalAdapterError ? error.code : 'SETUP_STATE_UNREADABLE', message: error instanceof Error ? error.message : 'The saved setup state cannot be read.' })
        return null
      }
    })()
    if (this.platform !== 'win32') blockers.push({ code: 'UNSUPPORTED_PLATFORM', message: 'Automatic Bar server setup is supported only on Windows.' })
    if (this.buildProductId !== 'hospitality-pos') blockers.push({ code: 'WRONG_PRODUCT', message: 'Local Bar server setup is available only in Restaurant & Bar POS.' })
    if (!this.safeStorage.isEncryptionAvailable()) blockers.push({ code: 'SECURE_STORAGE_UNAVAILABLE', message: 'Windows protected storage is unavailable. Sign in to Windows with a protected user profile and retry.' })
    let runtimeStatus = null
    try { runtimeStatus = this.runtime.status() } catch {}
    if (runtimeStatus?.configured) blockers.push({ code: 'ALREADY_COMMISSIONED', message: 'This installation already has a local Bar authority. Use recovery or administer the existing Bar instead of creating another.' })
    if (runtimeStatus?.restart_required) blockers.push({ code: 'RESTART_REQUIRED', message: 'Setup was already committed. Close and reopen the application before doing anything else.' })
    if (!state) {
      try { this.runtime.assertNoSavedCloudBusiness() } catch (error) {
        blockers.push({ code: error instanceof BarLocalAdapterError ? error.code : 'CLOUD_TRANSITION_REQUIRED', message: error instanceof Error ? error.message : 'A saved cloud business is present on this computer.' })
      }
      if (await this.serviceDetected().catch(() => false)) {
        blockers.push({ code: 'EXISTING_SERVICE_DETECTED', message: 'A local Bar service is already installed but this application has no protected setup record for it. Do not create a second Bar. Use Repair/Recovery or contact support.' })
      }
    }
    const free = this.diskFree(this.installRoot)
    let payload = null
    try {
      payload = await this.verifyPayload({ payloadDir: this.payloadDir })
    } catch (error) {
      blockers.push({
        code: error instanceof BarLocalAdapterError ? error.code : 'SERVER_PAYLOAD_INVALID',
        message: error instanceof Error ? error.message : 'The packaged local Bar server payload is invalid.',
        details: error instanceof BarLocalAdapterError && error.details && typeof error.details === 'object'
          ? /** @type {Record<string, unknown>} */ (error.details)
          : undefined
      })
    }
    const storage = computeSetupStorage(free, payload ? BigInt(payload.payload_bytes) : null)
    if (storage.status === 'unknown') warnings.push('Free disk space could not be checked here. The installer will check the destination again before copying files.')
    else if (storage.status === 'blocked') {
      const drive = /^[A-Za-z]:/.exec(this.installRoot)?.[0] ?? 'installation drive'
      blockers.push({ code: 'INSUFFICIENT_DISK', message: `More storage space is needed — Free another ${storage.shortfall_gib.toFixed(1)} GiB on ${drive}, then select Check again. Setup needs ${storage.required_free_gib.toFixed(1)} GiB for the verified Bar files and initial database.` })
    } else if (storage.status === 'advisory') {
      warnings.push(`Storage space is low. Setup can finish with ${storage.free_gib.toFixed(1)} GiB free; keep at least ${storage.recommended_free_gib.toFixed(1)} GiB free for the recommended backup and growth headroom. Actual backup space depends on your Bar database size.`)
    }
    let ports = null
    if (!state) {
      try {
        ports = {
          http: await chooseFreePort({ start: DEFAULT_HTTP_PORT, host: '0.0.0.0', isFree: this.isPortFree }),
          db: await chooseFreePort({ start: DEFAULT_DB_PORT, isFree: this.isPortFree })
        }
      } catch (error) {
        blockers.push({ code: error instanceof BarLocalAdapterError ? error.code : 'NO_FREE_PORT', message: error instanceof Error ? error.message : 'No free server port is available.' })
      }
    }
    return {
      ready: blockers.length === 0,
      blockers,
      warnings,
      platform: this.platform,
      product: this.buildProductId,
      payload_dir: this.payloadDir,
      payload_present: Boolean(payload),
      payload_checked_files: payload?.checked_files ?? 0,
      payload_manifest_sha256: payload?.manifest_sha256 ?? null,
      service_version: payload?.manifest.service_version ?? null,
      postgres_version: payload?.manifest.postgres_version ?? null,
      node_version: payload?.manifest.node_version ?? null,
      install_root: this.installRoot,
      free_bytes: free === null ? null : String(free),
      minimum_free_bytes: storage.required_free_bytes,
      payload_bytes: payload?.payload_bytes ?? null,
      storage,
      suggested_http_port: ports?.http ?? null,
      suggested_db_port: ports?.db ?? null,
      existing_setup: state ? publicSetupState(state) : null,
      elevation_required: true
    }
  }

  async status() {
    const state = this.readState()
    if (!state) return { available: false, phase: null, can_resume: false }
    const logTail = this.#readLogTail(state.staging.log_path)
    let statusFile = null
    try { statusFile = JSON.parse(readFileSync(state.staging.status_path, 'utf8')) } catch {}
    // Observe late completion after the bounded launcher wait without starting
    // another installer or changing any database state.
    if (state.phase === 'installing' && !this.installPromise) {
      if (statusFile?.phase === 'installed') this.#acceptInstalled(state, statusFile)
      else if (statusFile?.phase === 'failed') this.#setPhase(state, 'failed', { code: String(statusFile.code || 'INSTALLER_FAILED'), message: String(statusFile.message || 'Installation needs attention.') })
    }
    const publicState = publicSetupState(state)
    let progress = null
    try { progress = JSON.parse(readFileSync(join(state.staging.root, 'progress.json'), 'utf8')) } catch {}
    if (!progress || typeof progress.task !== 'string' || !Number.isFinite(Date.parse(progress.updated_at))) progress = null
    if (progress && Date.parse(statusFile?.updated_at) > Date.parse(progress.updated_at)) progress = null
    const activity = ['owner_pending', 'complete'].includes(state.phase) ? state.updated_at : progress?.updated_at || statusFile?.updated_at || state.updated_at
    const lastActivity = Number.isFinite(Date.parse(activity)) ? activity : state.updated_at
    return {
      available: true,
      ...publicState,
      progress: {
        task: state.phase === 'owner_pending' ? 'Creating the local owner account' : state.phase === 'installed' ? 'Checking that the Bar service is ready' : String(progress?.task || statusFile?.message || (state.phase === 'installing' ? 'Waiting for Windows administrator permission or installer activity' : STATE_PHASE_LABELS[state.phase])).slice(0, 240),
        started_at: state.created_at,
        last_activity_at: lastActivity,
        waiting: state.phase === 'installing' && this.now().getTime() - Date.parse(lastActivity) > 120000,
        completed: Number.isInteger(progress?.completed) && progress.completed >= 0 ? progress.completed : null,
        total: Number.isInteger(progress?.total) && progress.total > 0 ? progress.total : null
      },
      launcher_diagnostic: (() => { try { return redactLogTail(readFileSync(join(state.staging.root, 'launcher-diagnostic.txt'), 'utf8')) } catch { return null } })(),
      installer_status: statusFile ? {
        phase: typeof statusFile.phase === 'string' ? statusFile.phase : null,
        message: typeof statusFile.message === 'string' ? statusFile.message : null,
        updated_at: typeof statusFile.updated_at === 'string' ? statusFile.updated_at : null
      } : null,
      log_tail: logTail
    }
  }

  /** @param {Record<string, unknown>} request */
  async begin(request) {
    if (this.busy) throw new BarLocalAdapterError('SETUP_IN_PROGRESS', 'Another Bar server setup operation is already running.')
    this.busy = true
    try {
      const existing = this.readState()
      if (existing) {
        throw new BarLocalAdapterError('SETUP_ALREADY_IN_PROGRESS', `A saved Bar server setup is at phase ${existing.phase}. Resume it instead of starting another setup.`, { details: { phase: existing.phase } })
      }
      const owner = normalizeOwnerDraft(request)
      const pre = await this.preflight()
      if (!pre.ready) {
        const first = pre.blockers[0]
        throw new BarLocalAdapterError(first.code, first.message, { details: { blockers: pre.blockers } })
      }
      if (!pre.suggested_http_port || !pre.suggested_db_port) {
        throw new BarLocalAdapterError('NO_FREE_PORT', 'No free local Bar server port was available at the final check.')
      }
      const attemptId = randomUUID()
      const stagingRoot = join(this.stateRoot, attemptId)
      const secretDir = join(stagingRoot, 'secrets')
      const installDir = join(this.installRoot, 'server')
      const dataDir = join(this.installRoot, 'data')
      const pgDataDir = join(this.installRoot, 'pgdata')
      mkdirSync(secretDir, { recursive: true })
      const setupSecret = randomBytes(32).toString('hex')
      const backupKey = randomBytes(32).toString('hex')
      const replicationPassword = randomBytes(32).toString('hex')
      writeDurableAtomic(join(secretDir, 'setup-secret.txt'), `${setupSecret}\n`)
      writeDurableAtomic(join(secretDir, 'backup-key.txt'), `${backupKey}\n`)
      writeDurableAtomic(join(secretDir, 'replication-password.txt'), `${replicationPassword}\n`)
      const now = this.now().toISOString()
      /** @type {ServerSetupState} */
      const state = {
        version: 1,
        attempt_id: attemptId,
        phase: 'prepared',
        created_at: now,
        updated_at: now,
        owner: {
          business_name: owner.business_name,
          outlet_name: owner.outlet_name,
          owner_name: owner.owner_name,
          owner_email: owner.owner_email,
          currency: owner.currency,
          timezone: owner.timezone,
          device_name: owner.device_name,
          business_profile: owner.business_profile
        },
        install: {
          install_dir: installDir,
          data_dir: dataDir,
          pg_data_dir: pgDataDir,
          backup_dir: join(this.installRoot, 'backups'),
          pg_bin: join(this.installRoot, 'postgres', String(pre.postgres_version || '17'), 'bin'),
          node_path: join(this.installRoot, 'runtime', `node-${String(pre.node_version || 'v20').replace(/[^A-Za-z0-9._-]/g, '')}`, 'node.exe'),
          server_root: join(this.payloadDir, 'server'),
          installer_script: join(this.payloadDir, 'server', 'packaging', 'windows', 'install-server.ps1'),
          http_port: pre.suggested_http_port,
          db_port: pre.suggested_db_port,
          base_url: `https://127.0.0.1:${pre.suggested_http_port}`,
          tls_cert_file: join(dirname(dataDir), 'secrets', 'api-tls', 'api.crt'),
          tls_key_file: join(dirname(dataDir), 'secrets', 'api-tls', 'api.key'),
          upgrade: existsSync(join(pgDataDir, 'PG_VERSION'))
        },
        secrets: { setup_secret: setupSecret, backup_key: backupKey, replication_password: replicationPassword },
        staging: {
          root: stagingRoot,
          secret_dir: secretDir,
          wrapper_path: join(stagingRoot, 'install-server.ps1'),
          status_path: join(stagingRoot, 'status.json'),
          log_path: join(stagingRoot, 'install.log')
        },
        payload: {
          dir: this.payloadDir,
          manifest_sha256: String(pre.payload_manifest_sha256),
          service_version: String(pre.service_version),
          postgres_version: String(pre.postgres_version),
          node_version: String(pre.node_version)
        },
        last_error: null,
        installed_at: null,
        completed_at: null
      }
      writeDurableAtomic(state.staging.wrapper_path, buildInstallerWrapper(state))
      this.#writeState(state)
      this.#startInstall(state)
      return await this.status()
    } finally {
      this.busy = false
    }
  }

  /** @param {ServerSetupState} state */
  #acceptInstalled(state, status) {
    if (state.install.tls_cert_file) {
      if (typeof status?.certificate_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(status.certificate_fingerprint)) {
        throw new BarLocalAdapterError('TLS_IDENTITY_UNAVAILABLE', 'The installer did not return a verified Bar network identity. Preserve this setup and retry repair; no unpinned connection will be used.')
      }
      state.install.certificate_fingerprint = status.certificate_fingerprint
    }
    this.#setPhase(state, 'installed')
  }

  /** @param {ServerSetupState} state */
  #startInstall(state) {
    this.#setPhase(state, 'installing')
    this.installPromise = this.runner({ wrapperPath: state.staging.wrapper_path, cwd: state.staging.root })
      .then((result) => {
        const status = (() => { try { return JSON.parse(readFileSync(state.staging.status_path, 'utf8')) } catch { return null } })()
        const failed = result.exitCode !== 0 || !status || status.phase !== 'installed'
        if (failed) {
          if (result.exitCode === 124) {
            this.#setPhase(state, 'installing', { code: 'INSTALLATION_STATUS_UNCERTAIN', message: result.stderr })
            return
          }
          const message = result.stderr.trim()
            || (status && typeof status.message === 'string' ? status.message : '')
            || `The elevated local Bar installer exited with code ${result.exitCode}.`
          const code = /cancel(?:l)?ed by the user|operation was canceled/i.test(message)
            ? 'ELEVATION_DENIED'
            : (status && typeof status.code === 'string' && status.code ? status.code : 'ELEVATION_LAUNCH_FAILED')
          this.#setPhase(state, 'failed', { code, message: code === 'ELEVATION_LAUNCH_FAILED' ? "Windows couldn't start installation with administrator permission. Retry this saved setup once Windows is ready. If it happens again, share the support details; do not create another Bar." : message })
          writeDurableAtomic(join(state.staging.root, 'launcher-diagnostic.txt'), redactLogTail(message))
          return
        }
        this.#acceptInstalled(state, status)
      })
      .catch((error) => {
        this.#setPhase(state, 'failed', {
          code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'INSTALLER_FAILED',
          message: error instanceof Error ? error.message : 'The local Bar installer could not be started.'
        })
      })
      .finally(() => { this.installPromise = null })
  }

  /** @param {Record<string, unknown>} [request] */
  async resume(request = {}) {
    if (this.busy) throw new BarLocalAdapterError('SETUP_IN_PROGRESS', 'Another Bar server setup operation is already running.')
    this.busy = true
    try {
      const state = this.readState()
      if (!state) throw new BarLocalAdapterError('SETUP_NOT_FOUND', 'There is no saved Bar server setup to resume.')
      if (state.phase === 'complete') return await this.status()
      if (state.phase === 'installing') {
        if (this.installPromise) return await this.status()
        const installerStatus = (() => { try { return JSON.parse(readFileSync(state.staging.status_path, 'utf8')) } catch { return null } })()
        if (installerStatus?.phase === 'installed') this.#acceptInstalled(state, installerStatus)
        else if (installerStatus?.phase === 'failed') this.#setPhase(state, 'failed', { code: String(installerStatus.code || 'INSTALLER_FAILED'), message: String(installerStatus.message || 'The installer reported a failure.') })
        else {
          throw new BarLocalAdapterError('INSTALLATION_STATUS_UNCERTAIN', 'The previous installation has not reported completion. Keep this saved setup and inspect its progress with support before retrying; do not start a second database installation.')
        }
      }
      if (state.phase === 'prepared' || state.phase === 'failed') {
        if (state.installed_at) {
          this.#setPhase(state, 'owner_pending')
          return await this.status()
        }
        const previous = (() => { try { return JSON.parse(readFileSync(state.staging.status_path, 'utf8')) } catch { return null } })()
        if (previous?.phase === 'installing') {
          throw new BarLocalAdapterError('INSTALLATION_STATUS_UNCERTAIN', 'An installer has started but has not confirmed its outcome. Preserve this attempt and contact support before retrying.')
        }
        state.install.upgrade = existsSync(join(state.install.pg_data_dir, 'PG_VERSION'))
        this.#writeState(state)
        this.#startInstall(state)
        return await this.status()
      }
      const pin = typeof request.pin === 'string' ? request.pin : ''
      if (!/^\d{4,12}$/.test(pin)) throw new BarLocalAdapterError('PIN_REQUIRED', 'Enter the owner PIN to finish creating the local Bar. The PIN is not stored in the setup record.')
      const ownerPassword = typeof request.owner_password === 'string' ? request.owner_password : ''
      if (ownerPassword.length < 12 || ownerPassword.length > 128 || ownerPassword.trim() !== ownerPassword) {
        throw new BarLocalAdapterError('OWNER_PASSWORD_REQUIRED', 'Enter the owner password again to finish setup. The password is never saved in the setup record.')
      }
      const live = await this.serviceLive(state.install.base_url, { certificate_fingerprint: state.install.certificate_fingerprint }).catch(() => false)
      if (!live) {
        throw new BarLocalAdapterError(
          'SERVICE_NOT_READY',
          'The local Bar service was installed but is not answering yet. Wait a few seconds and retry the owner sign-in. If it still does not answer, review the setup log and Windows service status with support; do not run the installer again or delete the database.',
          { details: { base_url: state.install.base_url, log_tail: this.#readLogTail(state.staging.log_path) } }
        )
      }
      this.#setPhase(state, 'owner_pending')
      try {
        await this.runtime.setupOwner({
          base_url: state.install.base_url,
          certificate_fingerprint: state.install.certificate_fingerprint,
          setup_secret: state.secrets.setup_secret,
          business_name: state.owner.business_name,
          outlet_name: state.owner.outlet_name,
          owner_name: state.owner.owner_name,
          owner_email: state.owner.owner_email,
          owner_password: ownerPassword,
          pin,
          currency: state.owner.currency,
          timezone: state.owner.timezone,
          device_name: state.owner.device_name,
          business_profile: state.owner.business_profile,
          device_platform: 'modern'
        })
        this.#setPhase(state, 'complete')
        // Keep only the encrypted setup secret for local owner password
        // recovery; remove installer staging copies and other secrets.
        try {
          const clean = { ...state, secrets: { setup_secret: state.secrets.setup_secret, backup_key: state.secrets.backup_key, replication_password: '' } }
          this.#writeState(clean)
          rmSecretDirectory(state.staging.secret_dir)
        } catch {}
        return await this.status()
      } catch (error) {
        const runtimeStatus = this.runtime.status()
        const message = error instanceof Error ? error.message : 'The first owner could not be created.'
        if (runtimeStatus?.provisioning_recovery?.pending) {
          this.#setPhase(state, 'owner_pending', { code: 'OWNER_RETRY_REQUIRED', message })
        } else {
          this.#setPhase(state, 'failed', { code: error instanceof BarLocalAdapterError ? error.code : 'OWNER_SETUP_FAILED', message })
        }
        throw error
      }
    } finally {
      this.busy = false
    }
  }

  async recoverOwnerPassword(request) {
    const state = this.readState()
    if (!state || state.phase !== 'complete' || !state.secrets.setup_secret || !this.runtime.recoverOwnerPassword) {
      throw new BarLocalAdapterError('OWNER_RECOVERY_UNAVAILABLE', 'Use the Windows user profile that set up the main Bar computer. Its protected recovery credential is required.')
    }
    return this.runtime.recoverOwnerPassword({
      owner_email: request?.owner_email,
      new_password: request?.new_password,
      recovery_secret: state.secrets.setup_secret
    })
  }

  async cancel() {
    if (this.busy) throw new BarLocalAdapterError('SETUP_IN_PROGRESS', 'Wait for the current setup operation to finish before cancelling.')
    const state = this.readState()
    if (!state) return { ok: true, cancelled: false }
    if (state.phase === 'installing' || this.installPromise) {
      throw new BarLocalAdapterError('SETUP_INSTALL_ACTIVE', 'The Windows installer is still running. Wait for it to finish; do not close the UAC window or delete the setup record.')
    }
    if (state.phase !== 'prepared') {
      const artifacts = await this.serviceDetected().catch(() => true)
      if (state.phase !== 'failed' || artifacts) {
        throw new BarLocalAdapterError('SETUP_SERVICE_INSTALLED', 'The local Bar installer has already run for this setup attempt. Use repair, recovery or the server administrator workflow instead of cancelling setup.')
      }
    } else if (await this.serviceDetected().catch(() => true)) {
      throw new BarLocalAdapterError('SETUP_SERVICE_INSTALLED', 'A local Bar service or database is already present. Preserve it and use repair, recovery or the server administrator workflow instead of cancelling setup.')
    }
    try { unlinkSync(this.statePath) } catch {}
    try { rmSecretDirectory(state.staging.root) } catch {}
    return { ok: true, cancelled: true }
  }
}

/** @param {string} directory */
function rmSecretDirectory(directory) {
  // Only ever remove the generated staging directory, never ProgramData.
  if (!directory || !directory.split(/[\\/]/).includes('server-setup')) return
  try { rmSync(directory, { recursive: true, force: true }) } catch {}
}
