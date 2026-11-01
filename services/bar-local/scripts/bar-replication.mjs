#!/usr/bin/env node
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../dist/config.js'
import {
  connectPostgres,
  enrollStandby,
  inspectReplication,
  setDurability,
  switchover
} from '../dist/operations/replication.js'

class CliError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

function usage() {
  return [
    'Usage: node scripts/bar-replication.mjs <command> [options]',
    '',
    'Commands:',
    '  status                                       Inspect role, LSN, synchronous settings and streaming standbys.',
    '  set-durability --profile PROFILE              Set single_host or synchronous_one_standby durability.',
    '  switchover --confirm SWITCHOVER --reason TEXT Fence the primary and promote the standby.',
    '  enroll --standby-data-dir DIR --primary-host HOST --primary-port PORT --replication-user USER --confirm',
    '',
    'Environment: BAR_LOCAL_ADMIN_DATABASE_URL, BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL,',
    'BAR_LOCAL_REPLICATION_COORDINATOR=manual, BAR_LOCAL_PG_BIN, BAR_LOCAL_PG_DATA_DIR.',
    'The replication password is read from BAR_LOCAL_REPLICATION_PASSWORD and is never accepted as an argument.'
  ].join('\n')
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

const COMMAND_FLAGS = {
  status: new Set(['help']),
  'set-durability': new Set(['help', 'profile']),
  switchover: new Set(['help', 'confirm', 'reason']),
  enroll: new Set([
    'help',
    'standby-data-dir',
    'primary-host',
    'primary-port',
    'replication-user',
    'confirm',
    'allow-private-primary',
    'pg-basebackup',
    'pg-ctl',
    'timeout-ms'
  ])
}

function assertKnownFlags(command, flags) {
  const allowed = COMMAND_FLAGS[command]
  if (!allowed) throw new CliError('CLI_USAGE', `Unknown command: ${command}\n\n${usage()}`)
  for (const name of flags.keys()) {
    if (!allowed.has(name)) throw new CliError('CLI_ARGUMENT_INVALID', `Unknown option for ${command}: --${name}`)
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

function integerFlag(flags, name, { required = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = stringFlag(flags, name, { required })
  if (text === null) return null
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CliError('CLI_ARGUMENT_INVALID', `Option --${name} must be an integer between ${min} and ${max}.`)
  }
  return value
}

function booleanFlag(flags, name) {
  const value = flags.get(name)
  return value === true || value === 'true' || value === '1'
}

function adminUrl(config) {
  if (!config.replication.adminDatabaseUrl) {
    throw new CliError('REPLICATION_CONFIG_MISSING', 'BAR_LOCAL_ADMIN_DATABASE_URL is required.')
  }
  return config.replication.adminDatabaseUrl
}

async function statusCommand(flags, config) {
  const url = config.replication.adminDatabaseUrl
  if (!url) {
    return {
      ok: true,
      command: 'replication-status',
      replication: await inspectReplication(null, config.replication),
      config: {
        admin_database_configured: false,
        standby_admin_database_configured: Boolean(config.replication.standbyAdminDatabaseUrl),
        pg_data_dir: config.replication.pgDataDir
      }
    }
  }
  const client = await connectPostgres(url, 'bar-local-replication-status')
  try {
    return {
      ok: true,
      command: 'replication-status',
      replication: await inspectReplication(client, config.replication),
      config: {
        admin_database_configured: true,
        standby_admin_database_configured: Boolean(config.replication.standbyAdminDatabaseUrl),
        pg_data_dir: config.replication.pgDataDir
      }
    }
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function setDurabilityCommand(flags, config) {
  adminUrl(config)
  const profile = stringFlag(flags, 'profile', { required: true })
  if (profile !== 'single_host' && profile !== 'synchronous_one_standby') {
    throw new CliError('CLI_ARGUMENT_INVALID', '--profile must be single_host or synchronous_one_standby.')
  }
  return setDurability(config.replication, profile)
}

async function switchoverCommand(flags, config) {
  const connectionUrl = adminUrl(config)
  const confirm = stringFlag(flags, 'confirm', { required: true })
  if (confirm !== 'SWITCHOVER') {
    throw new CliError('REPLICATION_CONFIRMATION_REQUIRED', '--confirm must be the exact value SWITCHOVER.')
  }
  const reason = stringFlag(flags, 'reason', { required: true })
  if (reason.length < 3 || reason.length > 500) {
    throw new CliError('CLI_ARGUMENT_INVALID', '--reason must be between 3 and 500 characters.')
  }
  const correlationId = randomUUID()
  const auditClient = await connectPostgres(connectionUrl, 'bar-local-replication-cli-audit')
  const writeAudit = async (after) => auditClient.query(
    `SELECT bar_local.service_admin_audit(NULL, NULL, NULL, NULL, $1, $2::jsonb)`,
    ['admin.replication.switchover', JSON.stringify({ correlation_id: correlationId, reason, ...after })]
  )
  try {
    try {
      await writeAudit({ phase: 'started', coordinator: config.replication.coordinator })
    } catch (error) {
      throw new CliError('ADMIN_AUDIT_WRITE_FAILED', `Switchover was not started because its audit intent could not be recorded: ${error instanceof Error ? error.message : 'unknown audit error'}`)
    }

    let report
    try {
      report = await switchover(config.replication)
    } catch (error) {
      await writeAudit({
        phase: 'failed',
        error: { code: error?.code ?? 'REPLICATION_FAILED', message: error instanceof Error ? error.message : 'Unknown switchover failure.' }
      }).catch(() => undefined)
      throw error
    }

    try {
      await writeAudit({
        phase: 'completed',
        ok: report.ok,
        authority_state: report.authority_state,
        client_repoint_required: report.client_repoint_required,
        fenced: report.fenced,
        promoted: report.promoted,
        error: report.error
      })
      return { ...report, reason, correlation_id: correlationId, audit_recorded: true }
    } catch (error) {
      return {
        ...report,
        reason,
        correlation_id: correlationId,
        audit_recorded: false,
        audit_warning: `The switchover outcome may have completed, but its result could not be recorded. Keep clients stopped and reconcile audit correlation ${correlationId} before retrying. ${error instanceof Error ? error.message : 'Unknown audit error.'}`
      }
    }
  } finally {
    await auditClient.end().catch(() => undefined)
  }
}

async function enrollCommand(flags, config) {
  const standbyDataDir = path.resolve(stringFlag(flags, 'standby-data-dir', { required: true }))
  const primaryPort = integerFlag(flags, 'primary-port', { required: true, min: 1, max: 65_535 })
  const report = await enrollStandby({
    standbyDataDir,
    primaryHost: stringFlag(flags, 'primary-host', { required: true }),
    primaryPort,
    replicationUser: stringFlag(flags, 'replication-user', { required: true }),
    password: process.env.BAR_LOCAL_REPLICATION_PASSWORD || null,
    standbyDatabaseUrl: config.replication.standbyAdminDatabaseUrl,
    confirm: booleanFlag(flags, 'confirm'),
    allowPrivatePrimary: booleanFlag(flags, 'allow-private-primary'),
    pgBaseBackup: stringFlag(flags, 'pg-basebackup') ?? undefined,
    pgCtl: stringFlag(flags, 'pg-ctl') ?? undefined,
    timeoutMs: integerFlag(flags, 'timeout-ms', { min: 10_000, max: 86_400_000 }) ?? undefined
  }, config.replication)
  return { command: 'replication-enroll', ...report }
}

async function run() {
  const { command, flags } = parseArguments(process.argv.slice(2))
  if (flags.get('help') === true) {
    process.stdout.write(`${usage()}\n`)
    return null
  }
  assertKnownFlags(command, flags)
  const config = loadConfig(process.env)
  if (command === 'status') return statusCommand(flags, config)
  if (command === 'set-durability') return setDurabilityCommand(flags, config)
  if (command === 'switchover') return switchoverCommand(flags, config)
  if (command === 'enroll') return enrollCommand(flags, config)
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
