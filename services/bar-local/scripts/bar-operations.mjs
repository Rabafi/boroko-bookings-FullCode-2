#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import {
  assertRestoreVerification,
  assertRestoreAuthorization,
  assertRestoreTargetEmpty,
  assertVerificationTarget,
  createEncryptedBackup,
  createPgDumpSpec,
  loadEncryptionKey,
  restoreBackupPackageToDatabase,
  verifyBackupPackage,
  verifyRestoredDatabase
} from '../dist/operations/backup.js'
import { applyStagedUpdate, createEd25519UpdateTrust, validateUpdatePackage } from '../dist/operations/updates.js'
import { buildNetworkStatus } from '../dist/operations/network.js'
import { assertClusterIdentity, connectionConfig, loadTarget } from './lib/db-target.mjs'

const { Client } = pg
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(SCRIPT_DIR, '..')
const DEFAULT_MIGRATIONS_DIR = path.join(SERVICE_ROOT, 'db', 'migrations')

class CliError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

function parseArguments(argv) {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h') {
    throw new CliError('CLI_USAGE', usage())
  }
  const flags = new Map()
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (!argument.startsWith('--')) {
      throw new CliError('CLI_ARGUMENT_INVALID', `Unexpected positional argument: ${argument}`)
    }
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator)
    if (!name) throw new CliError('CLI_ARGUMENT_INVALID', 'An option name cannot be empty.')
    if (flags.has(name)) throw new CliError('CLI_ARGUMENT_INVALID', `Option --${name} was supplied more than once.`)
    let value = separator === -1 ? undefined : argument.slice(separator + 1)
    if (value === undefined) {
      const next = rest[index + 1]
      if (next !== undefined && !next.startsWith('--')) {
        value = next
        index += 1
      } else {
        value = true
      }
    }
    flags.set(name, value)
  }
  return { command, flags }
}

function usage() {
  return [
    'Usage: node scripts/bar-operations.mjs <command> [options]',
    '',
    'Commands:',
    '  backup            Encrypt a pg_dump custom backup and write its SHA-256 manifest.',
    '  verify-restore    Restore into an isolated bar_local_test database and verify financial invariants.',
    '  check-update      Validate a signed-package checklist and local update manifest.',
    '  apply-update      Apply a validated staged update after creating or confirming a checkpoint.',
    '  network-status    Report bind, TLS, service readiness, authority and honest topology limitations.',
    '',
    'Run a command with --help for its options.'
  ].join('\n')
}

function commandUsage(command) {
  const commonBackup = [
    '  --host HOST',
    '  --port PORT',
    '  --database NAME',
    '  --user USER',
    '  --key-file PATH',
    '  --password-env NAME (default: BAR_LOCAL_DB_PASSWORD or PGPASSWORD)',
    '  --destination DIR',
    '  --label TEXT',
    '  --copy-to DIR',
    '  --allow-test-database',
    '  --pg-dump PATH',
    '  --retention-hourly N',
    '  --retention-daily N',
    '  --retention-weekly N'
  ]
  if (command === 'backup') return `Usage: bar-operations.mjs backup\n${commonBackup.join('\n')}`
  if (command === 'verify-restore') {
    return [
      'Usage: bar-operations.mjs verify-restore',
      '  --manifest PATH',
      '  --key-file PATH',
      '  --database NAME (default: BAR_LOCAL_DB_NAME)',
      '  --migrations-dir PATH',
      '  --expected-authority-id UUID',
      '  --expected-authority-epoch N',
      '  --authorized-by NAME (required owner/authority intent)',
      '  --reason TEXT (required audit reason)',
      '  --confirm-database NAME (must equal --database)',
      '  --allow-older-schema',
      '  --pg-restore PATH',
      '  --timeout-ms N',
      'Requires BAR_LOCAL_TEST_DB=1 together with the db-target environment variables.',
      'The target must be new and empty; an existing bar_local schema is never overwritten.'
    ].join('\n')
  }
  if (command === 'check-update') {
    return [
      'Usage: bar-operations.mjs check-update',
      '  --manifest PATH',
      '  --package-root DIR',
      '  --installed-version X.Y.Z',
      '  --schema-version N',
      '  --contract-version N',
      '  --service-version X.Y.Z',
      '  --disk-dir DIR'
    ].join('\n')
  }
  if (command === 'apply-update') {
    return [
      'Usage: bar-operations.mjs apply-update',
      '  --manifest PATH',
      '  --package-root DIR',
      '  --installed-version X.Y.Z',
      '  --schema-version N',
      '  --contract-version N',
      '  --service-version X.Y.Z',
      '  --disk-dir DIR',
      '  --install-dir DIR',
      '  --staging-dir DIR',
      '  --data-dirs DIR[,DIR]',
      '  --checkpoint-manifest PATH',
      '  OR supply --backup-destination DIR, --host, --port, --database, --user and backup key options',
      '  --key-file PATH',
      '  --pg-dump PATH'
    ].join('\n')
  }
  if (command === 'network-status') {
    return [
      'Usage: bar-operations.mjs network-status',
      '  --role single_host|client|replica|voter',
      '  --host HOST',
      '  --port PORT',
      '  --tls-cert PATH',
      '  --service-url URL',
      '  --service-ca PATH',
      '  --timeout-ms N',
      '  --internet-state available|unavailable|unknown (reported only; never selects authority)',
      '  --require-write-authority (exit nonzero unless local write authority is explicitly proven)',
      '  --authority-id UUID',
      '  --authority-epoch N',
      '  --business-id UUID',
      '  --commissioned-at ISO8601',
      '  --database-reachable true|false',
      '  --database-error TEXT',
      '  --coordinator-verified --coordinator-evidence TEXT',
      '  --replication-verified --replication-evidence TEXT',
      '  --external-hardware-verified --external-hardware-evidence TEXT'
    ].join('\n')
  }
  return usage()
}

const COMMON_FLAGS = new Set([
  'help',
  'host',
  'port',
  'database',
  'user',
  'key-file',
  'password-env',
  'destination',
  'label',
  'copy-to',
  'allow-test-database',
  'pg-dump',
  'retention-hourly',
  'retention-daily',
  'retention-weekly'
])

const COMMAND_FLAGS = {
  backup: COMMON_FLAGS,
  'verify-restore': new Set([
    'help',
    'manifest',
    'key-file',
    'database',
    'migrations-dir',
    'expected-authority-id',
    'expected-authority-epoch',
    'authorized-by',
    'reason',
    'confirm-database',
    'allow-older-schema',
    'pg-restore',
    'timeout-ms'
  ]),
  'check-update': new Set([
    'help',
    'manifest',
    'package-root',
    'installed-version',
    'schema-version',
    'contract-version',
    'service-version',
    'disk-dir'
  ]),
  'apply-update': new Set([
    'help',
    'manifest',
    'package-root',
    'installed-version',
    'schema-version',
    'contract-version',
    'service-version',
    'disk-dir',
    'install-dir',
    'staging-dir',
    'data-dirs',
    'checkpoint-manifest',
    'backup-destination',
    'host',
    'port',
    'database',
    'user',
    'key-file',
    'password-env',
    'label',
    'pg-dump',
    'allow-test-database'
  ]),
  'network-status': new Set([
    'help',
    'role',
    'host',
    'port',
    'tls-cert',
    'service-url',
    'service-ca',
    'timeout-ms',
    'internet-state',
    'require-write-authority',
    'authority-id',
    'authority-epoch',
    'business-id',
    'commissioned-at',
    'database-reachable',
    'database-error',
    'coordinator-verified',
    'coordinator-evidence',
    'replication-verified',
    'replication-evidence',
    'external-hardware-verified',
    'external-hardware-evidence'
  ])
}

function assertKnownFlags(command, flags) {
  const allowed = COMMAND_FLAGS[command]
  if (!allowed) throw new CliError('CLI_USAGE', `Unknown command: ${command}\n\n${usage()}`)
  for (const name of flags.keys()) {
    if (!allowed.has(name)) {
      throw new CliError('CLI_ARGUMENT_INVALID', `Unknown option for ${command}: --${name}`)
    }
  }
}

function stringFlag(flags, name, { required = false, fallback = null } = {}) {
  const value = flags.get(name)
  if (value === undefined || value === null) {
    if (fallback !== null) return fallback
    if (required) throw new CliError('CLI_ARGUMENT_MISSING', `Missing required option --${name}.`)
    return null
  }
  if (value === true || typeof value !== 'string' || !value.trim()) {
    throw new CliError('CLI_ARGUMENT_INVALID', `Option --${name} requires a non-empty value.`)
  }
  return value.trim()
}

function integerFlag(flags, name, { required = false, min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  const text = stringFlag(flags, name, { required, fallback: fallback === null ? null : String(fallback) })
  if (text === null) return null
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CliError('CLI_ARGUMENT_INVALID', `Option --${name} must be an integer between ${min} and ${max}.`)
  }
  return value
}

function booleanFlag(flags, name, fallback = false) {
  const value = flags.get(name)
  if (value === undefined) return fallback
  if (value === true || value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new CliError('CLI_ARGUMENT_INVALID', `Option --${name} must be true or false.`)
}

function passwordFor(flags) {
  const envName = stringFlag(flags, 'password-env', { fallback: 'BAR_LOCAL_DB_PASSWORD' })
  if (process.env[envName]) return process.env[envName]
  return process.env.PGPASSWORD || undefined
}

function postgresTarget(flags) {
  return {
    host: stringFlag(flags, 'host', { required: true }),
    port: integerFlag(flags, 'port', { required: true, min: 1, max: 65_535 }),
    database: stringFlag(flags, 'database', { required: true }),
    user: stringFlag(flags, 'user', { required: true }),
    password: passwordFor(flags)
  }
}

function retentionPolicy(flags) {
  const hourly = integerFlag(flags, 'retention-hourly', { min: 0, max: 10_000 })
  const daily = integerFlag(flags, 'retention-daily', { min: 0, max: 10_000 })
  const weekly = integerFlag(flags, 'retention-weekly', { min: 0, max: 10_000 })
  if (hourly === null && daily === null && weekly === null) return null
  return {
    hourly: hourly ?? 0,
    daily: daily ?? 0,
    weekly: weekly ?? 0
  }
}

function keyFor(flags) {
  return loadEncryptionKey({ keyFile: stringFlag(flags, 'key-file') })
}

async function backupCommand(flags) {
  const target = postgresTarget(flags)
  const destination = stringFlag(flags, 'destination', { required: true })
  const pgDump = stringFlag(flags, 'pg-dump')
  const command = createPgDumpSpec(target, pgDump ? { command: pgDump } : {})
  const report = await createEncryptedBackup({
    target,
    destinationDir: destination,
    encryptionKey: keyFor(flags),
    label: stringFlag(flags, 'label'),
    copyToDir: stringFlag(flags, 'copy-to'),
    retention: retentionPolicy(flags),
    allowTestDatabase: booleanFlag(flags, 'allow-test-database'),
    command
  })
  return report
}

async function withTestClient(target, callback) {
  const client = new Client(connectionConfig(target))
  await client.connect()
  try {
    await assertClusterIdentity(client, target, { allowUnreadableDataDirectory: true, allowAbsentMarker: true })
    return await callback(client)
  } finally {
    await client.end().catch(() => {})
  }
}

async function verifyRestoreCommand(flags) {
  const base = loadTarget()
  const manifestPath = path.resolve(stringFlag(flags, 'manifest', { required: true }))
  const packageInfo = await verifyBackupPackage(manifestPath)
  const database = stringFlag(flags, 'database', { fallback: base.database })
  const target = { ...base, database }
  const liveDatabases = (process.env.BAR_LOCAL_LIVE_DATABASES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const verification = assertVerificationTarget({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    testOptIn: process.env.BAR_LOCAL_TEST_DB === '1',
    sourceDatabase: packageInfo.manifest.source.database,
    liveDatabases: [...liveDatabases, 'postgres']
  })
  const confirmDatabase = stringFlag(flags, 'confirm-database', { required: true })
  const authorization = assertRestoreAuthorization({
    authorized_by: stringFlag(flags, 'authorized-by', { required: true }),
    reason: stringFlag(flags, 'reason', { required: true }),
    target_database: confirmDatabase,
    confirmed: true
  }, target.database)

  const client = new Client(connectionConfig(target))
  await client.connect()
  let restore
  try {
    await assertClusterIdentity(client, target, { allowUnreadableDataDirectory: true, allowAbsentMarker: true })
    const result = await client.query('SELECT current_database() AS database')
    const connected = result.rows[0]?.database
    if (connected !== target.database) {
      throw new CliError('RESTORE_TARGET_REJECTED', `Connected database ${connected} does not match the requested target.`)
    }
    await assertRestoreTargetEmpty(client, target.database)
    restore = await restoreBackupPackageToDatabase({
      manifestPath,
      encryptionKey: keyFor(flags),
      target,
      verification,
      authorization,
      preflightClient: client,
      securityClient: client,
      security: { migrationOwner: target.user },
      pgRestoreCommand: stringFlag(flags, 'pg-restore'),
      timeoutMs: integerFlag(flags, 'timeout-ms', { min: 1000, max: 86_400_000 })
    })
  } finally {
    await client.end().catch(() => {})
  }

  const verificationReport = await withTestClient(target, (verificationClient) => verifyRestoredDatabase(verificationClient, {
    migrationsDir: path.resolve(stringFlag(flags, 'migrations-dir', { fallback: DEFAULT_MIGRATIONS_DIR })),
    database: target.database,
    expectedAuthorityId: stringFlag(flags, 'expected-authority-id'),
    expectedAuthorityEpoch: stringFlag(flags, 'expected-authority-epoch'),
    allowOlderSchema: booleanFlag(flags, 'allow-older-schema'),
    expectedMigrationOwner: target.user
  }))
  assertRestoreVerification(verificationReport)
  return {
    ok: true,
    command: 'verify-restore',
    generated_at: new Date().toISOString(),
    target: {
      host: target.host,
      port: target.port,
      database: target.database,
      user: target.user,
      source_database: packageInfo.manifest.source.database
    },
    restore,
    verification: verificationReport
  }
}

async function updateOptions(flags) {
  const keyId = String(process.env.BAR_LOCAL_UPDATE_TRUST_KEY_ID || '').trim()
  const publicKeyFile = String(process.env.BAR_LOCAL_UPDATE_TRUST_PUBLIC_KEY_FILE || '').trim()
  let trust = null
  if (keyId && publicKeyFile) {
    let publicKeyPem
    try {
      publicKeyPem = await readFile(path.resolve(publicKeyFile), 'utf8')
    } catch {
      throw new CliError('UPDATE_SIGNING_UNAVAILABLE', 'The configured pinned update public-key file could not be read.')
    }
    trust = createEd25519UpdateTrust(keyId, publicKeyPem)
  } else if (keyId || publicKeyFile) {
    throw new CliError('UPDATE_SIGNING_UNAVAILABLE', 'Set both BAR_LOCAL_UPDATE_TRUST_KEY_ID and BAR_LOCAL_UPDATE_TRUST_PUBLIC_KEY_FILE to enable signed update validation.')
  }
  return {
    manifestPath: path.resolve(stringFlag(flags, 'manifest', { required: true })),
    packageRoot: path.resolve(stringFlag(flags, 'package-root', { required: true })),
    installedVersion: stringFlag(flags, 'installed-version', { required: true }),
    currentSchemaVersion: integerFlag(flags, 'schema-version', { required: true, min: 0 }),
    currentContractVersion: integerFlag(flags, 'contract-version', { required: true, min: 0 }),
    currentServiceVersion: stringFlag(flags, 'service-version'),
    diskDir: stringFlag(flags, 'disk-dir'),
    trust
  }
}

async function checkUpdateCommand(flags) {
  return validateUpdatePackage(await updateOptions(flags))
}

async function applyUpdateCommand(flags) {
  const installDir = path.resolve(stringFlag(flags, 'install-dir', { required: true }))
  const stagingDir = path.resolve(stringFlag(flags, 'staging-dir', { required: true }))
  const dataDirs = stringFlag(flags, 'data-dirs')
    ? stringFlag(flags, 'data-dirs').split(',').map((value) => path.resolve(value.trim())).filter(Boolean)
    : undefined
  const validationOptions = await updateOptions(flags)
  await validateUpdatePackage(validationOptions)
  const checkpointManifest = stringFlag(flags, 'checkpoint-manifest')
  const backupDestination = stringFlag(flags, 'backup-destination')
  let checkpoint = null
  if (checkpointManifest) {
    const verified = await verifyBackupPackage(path.resolve(checkpointManifest))
    checkpoint = { path: path.resolve(checkpointManifest), sha256: verified.sha256 }
  } else if (backupDestination) {
    const report = await backupCommand(new Map([
      ...flags,
      ['destination', backupDestination]
    ]))
    checkpoint = { path: report.backup.manifest_path, sha256: report.backup.manifest_sha256 }
  } else {
    throw new CliError('UPDATE_CHECKPOINT_REQUIRED', 'Supply --checkpoint-manifest or a fresh backup destination before applying an update.')
  }
  const report = await applyStagedUpdate({
    ...validationOptions,
    installDir,
    stagingDir,
    dataDirs,
    checkpoint: async () => checkpoint
  })
  return report
}

async function networkCommand(flags) {
  const authorityId = stringFlag(flags, 'authority-id')
  const authorityEpoch = stringFlag(flags, 'authority-epoch')
  const businessId = stringFlag(flags, 'business-id')
  const commissionedAt = stringFlag(flags, 'commissioned-at')
  const databaseReachable = flags.has('database-reachable')
    ? booleanFlag(flags, 'database-reachable')
    : undefined
  const evidence = {}
  for (const [key, prefix] of [
    ['coordinator', 'coordinator'],
    ['replication', 'replication'],
    ['externalHardware', 'external-hardware']
  ]) {
    const verified = booleanFlag(flags, `${prefix}-verified`)
    const evidenceRef = stringFlag(flags, `${prefix}-evidence`)
    if (verified && !evidenceRef) {
      throw new CliError('CLI_ARGUMENT_MISSING', `--${prefix}-verified requires --${prefix}-evidence.`)
    }
    if (verified) evidence[key] = { verified: true, evidenceRef }
  }
  const report = await buildNetworkStatus({
    role: stringFlag(flags, 'role', { required: true }),
    bindHost: stringFlag(flags, 'host', { required: true }),
    port: integerFlag(flags, 'port', { required: true, min: 1, max: 65_535 }),
    tlsCertFile: stringFlag(flags, 'tls-cert'),
    serviceUrl: stringFlag(flags, 'service-url'),
    serviceCaFile: stringFlag(flags, 'service-ca'),
    probeTimeoutMs: integerFlag(flags, 'timeout-ms', { min: 250, max: 30_000 }),
    authority: authorityId || authorityEpoch || businessId || commissionedAt
      ? {
          authority_id: authorityId || '',
          authority_epoch: authorityEpoch || '',
          business_id: businessId || '',
          commissioned_at: commissionedAt
        }
      : null,
    database: databaseReachable === undefined
      ? null
      : { reachable: databaseReachable, error: stringFlag(flags, 'database-error') },
    evidence,
    internetState: stringFlag(flags, 'internet-state', { fallback: 'unknown' })
  })
  if (booleanFlag(flags, 'require-write-authority') && !report.write_authority.granted) {
    throw new CliError(
      'NETWORK_WRITE_AUTHORITY_NOT_GRANTED',
      `Local Bar write authority is not proven: ${report.write_authority.blockers.join(' ') || 'no authoritative basis.'}`
    )
  }
  return report
}

async function run() {
  const { command, flags } = parseArguments(process.argv.slice(2))
  if (flags.get('help') === true) {
    process.stdout.write(`${commandUsage(command)}\n`)
    return null
  }
  assertKnownFlags(command, flags)
  if (command === 'backup') return backupCommand(flags)
  if (command === 'verify-restore') return verifyRestoreCommand(flags)
  if (command === 'check-update') return checkUpdateCommand(flags)
  if (command === 'apply-update') return applyUpdateCommand(flags)
  if (command === 'network-status') return networkCommand(flags)
  throw new CliError('CLI_USAGE', `Unknown command: ${command}`)
}

run()
  .then((report) => {
    if (report) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  })
  .catch((error) => {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'OPERATION_FAILED'
    const message = error instanceof Error ? error.message : 'The operation failed.'
    process.stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`)
    process.exitCode = 1
  })
