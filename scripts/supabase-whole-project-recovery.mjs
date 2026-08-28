import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { encryptBackupFile } from './backup-crypto.mjs'

/**
 * Build the token-independent part of a Supabase whole-project recovery
 * package.
 *
 * This deliberately uses the database connection URL for pg_dump and the
 * existing backup public key for encryption. Supabase Management API tokens
 * are not required, and no function source is downloaded from a deployment.
 * The resulting package contains an inventory of repository-held function
 * source/configuration and records that the remote deployment inventory must
 * be refreshed separately with an operator-held Management API token.
 */

export const SUPABASE_CLI_VERSION = '2.96.0'
// The repository already ignores this directory; encrypted artifacts should
// not become accidental source changes when the helper is run locally.
export const DEFAULT_OUTPUT_DIRECTORY = 'backup-output'
export const DEFAULT_BUNDLE_PREFIX = 'tsa-bonno-supabase-whole-project-'

export const REQUIRED_FILES = Object.freeze([
  'roles.sql',
  'schema.sql',
  'auth-schema.sql',
  'auth-data.sql',
  'auth-storage-schema.sql',
  'data.sql',
  'migration-history.sql',
  'project-function-inventory.json',
  'metadata.json',
  'SHA256SUMS'
])

// Restore into a newly created Supabase project in this order. Auth/storage
// schemas are explicitly captured because the CLI's default dump excludes
// those managed schemas; auth data must precede public data that can reference
// auth.users. Migration history is evidence/diagnostic state and is applied
// last only when the target operator's restore procedure calls for it.
export const RESTORE_ORDER = Object.freeze([
  'roles.sql',
  'auth-schema.sql',
  'auth-storage-schema.sql',
  'schema.sql',
  'auth-data.sql',
  'data.sql',
  'migration-history.sql'
])

const DUMP_SPECS = Object.freeze([
  { file: 'roles.sql', flags: ['--role-only'], kind: 'roles' },
  { file: 'schema.sql', flags: [], kind: 'schema' },
  {
    file: 'auth-schema.sql',
    flags: ['--schema', 'auth'],
    kind: 'auth-schema'
  },
  {
    file: 'auth-data.sql',
    flags: ['--schema', 'auth', '--data-only', '--use-copy'],
    kind: 'auth-data'
  },
  {
    // Supabase CLI excludes managed schemas from its default schema dump.
    // Keep this name explicit: it is the Storage side of the Auth/Storage
    // platform-schema capture, not a second copy of the app data dump.
    file: 'auth-storage-schema.sql',
    flags: ['--schema', 'storage'],
    kind: 'auth-storage-schema'
  },
  {
    file: 'data.sql',
    flags: ['--data-only', '--use-copy', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes'],
    kind: 'data'
  },
  {
    // The CLI's default data dump excludes supabase_migrations. Capture the
    // history table separately so migration parity is retained as evidence.
    file: 'migration-history.sql',
    flags: ['--schema', 'supabase_migrations', '--data-only', '--use-copy'],
    kind: 'migration-history'
  }
])

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function requireValue(value, label) {
  if (value === undefined || value === null || String(value).length === 0) {
    throw new Error(`${label} is required.`)
  }
  return String(value)
}

function redact(value, secrets = []) {
  let result = String(value || '')
  for (const secret of secrets) {
    if (secret) result = result.replaceAll(String(secret), '[redacted]')
  }
  return result.slice(0, 300)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  const input = await fs.readFile(filePath)
  hash.update(input)
  return hash.digest('hex')
}

function safeRelativePath(value) {
  const normalized = String(value).replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error('Recovery inventory path is invalid.')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '')) throw new Error('Recovery inventory path is invalid.')
  return normalized
}

function parseConfigKeys(configText) {
  const sections = []
  let section = ''
  for (const rawLine of String(configText).split(/\r?\n/)) {
    const line = rawLine.trim()
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      sections.push(section)
      continue
    }
    const keyMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=/)
    if (keyMatch) sections.push(section ? `${section}.${keyMatch[1]}` : keyMatch[1])
  }
  return [...new Set(sections)].sort(compareStrings)
}

async function listFiles(rootDirectory) {
  const entries = []
  async function visit(directory) {
    const children = await fs.readdir(directory, { withFileTypes: true })
    for (const child of children.sort((left, right) => compareStrings(left.name, right.name))) {
      const childPath = path.join(directory, child.name)
      if (child.isSymbolicLink()) continue
      if (child.isDirectory()) {
        await visit(childPath)
      } else if (child.isFile()) {
        entries.push(childPath)
      }
    }
  }
  await visit(rootDirectory)
  return entries
}

async function buildFunctionSourceInventory({ repositoryRoot }) {
  const functionsRoot = path.join(repositoryRoot, 'supabase', 'functions')
  const configPath = path.join(repositoryRoot, 'supabase', 'config.toml')
  const inventory = {
    inventory_version: 1,
    inventory_kind: 'repository-source-and-config',
    project_ref: null,
    config: null,
    functions: [],
    remote_deployment: {
      status: 'not-queried',
      inventory_method: 'token-independent-repository-capture',
      reason: 'Supabase Management API function metadata requires a separate operator-held access token; no token is accepted or exported by this backup.'
    }
  }

  try {
    const configText = await fs.readFile(configPath, 'utf8')
    const configHash = sha256(Buffer.from(configText))
    const projectMatch = configText.match(/^\s*project_id\s*=\s*["']([^"']+)["']/m)
    inventory.project_ref = projectMatch ? projectMatch[1] : null
    inventory.config = {
      path: safeRelativePath(path.relative(repositoryRoot, configPath)),
      sha256: configHash,
      keys: parseConfigKeys(configText)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    inventory.config = { path: 'supabase/config.toml', present: false, keys: [] }
  }

  try {
    const functionDirectories = (await fs.readdir(functionsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .sort((left, right) => compareStrings(left.name, right.name))
    for (const functionDirectory of functionDirectories) {
      const directoryPath = path.join(functionsRoot, functionDirectory.name)
      const sourceFiles = []
      for (const sourcePath of await listFiles(directoryPath)) {
        const relativePath = safeRelativePath(path.relative(repositoryRoot, sourcePath))
        const stat = await fs.stat(sourcePath)
        sourceFiles.push({
          path: relativePath,
          bytes: stat.size,
          sha256: await sha256File(sourcePath)
        })
      }
      inventory.functions.push({ name: functionDirectory.name, files: sourceFiles })
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    inventory.functions = []
  }

  return inventory
}

function normalizeProjectRef(value) {
  if (!value) return null
  const projectRef = String(value).trim()
  if (!/^[a-z0-9-]{1,64}$/i.test(projectRef)) throw new Error('Supabase project ref is invalid.')
  return projectRef
}

function cliExecutable() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

export function buildDumpCommandPlan({ dbUrl, outputDirectory, cli = cliExecutable(), cliVersion = SUPABASE_CLI_VERSION } = {}) {
  requireValue(dbUrl, 'Supabase backup database URL')
  const output = requireValue(outputDirectory, 'Dump output directory')
  return DUMP_SPECS.map((spec) => ({
    ...spec,
    command: cli,
    args: ['--yes', `supabase@${cliVersion}`, 'db', 'dump', '--db-url', dbUrl, '--file', path.join(output, spec.file), ...spec.flags]
  }))
}

export function getRequiredFiles() {
  return [...REQUIRED_FILES]
}

export function getRestoreOrder() {
  return [...RESTORE_ORDER]
}

async function runCommand({ command, args, cwd, env, sensitiveValues = [] }) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      // Dump commands write to the requested files. Discard stdout so a CLI
      // diagnostic can never accidentally expose a connection detail in the
      // workflow log; stderr is retained only for bounded redacted errors.
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => reject(new Error(`Supabase CLI could not start: ${redact(error.message, sensitiveValues)}`)))
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({ code, signal })
        return
      }
      // Do not echo CLI stderr: pg_dump diagnostics can contain connection
      // details. Keep only a bounded, redacted diagnostic for local debugging.
      const suffix = stderr ? ` ${redact(stderr, sensitiveValues)}` : ''
      reject(new Error(`Supabase CLI dump failed with exit code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.${suffix}`))
    })
  })
}

function buildCliEnvironment(cliHome) {
  const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: 'true' }
  // This bundle is intentionally token-independent. Do not inherit a
  // Management API token or unrelated storage/R2/recovery secrets into the
  // CLI child process, even when a caller runs it from a broad CI job.
  for (const name of [
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_BACKUP_DB_URL',
    'BACKUP_ENCRYPTION_PUBLIC_KEY_B64',
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_BUCKET',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'SUPABASE_STORAGE_S3_ENDPOINT',
    'SUPABASE_STORAGE_S3_REGION',
    'SUPABASE_STORAGE_S3_ACCESS_KEY_ID',
    'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY'
  ]) delete env[name]
  // Keep CLI telemetry/profile material inside the already-cleaned temporary
  // directory. This also prevents a developer's cached Supabase login from
  // becoming an implicit dependency of the DB-only recovery run.
  env.SUPABASE_HOME = cliHome
  return env
}

function tarField(value, length) {
  const bytes = Buffer.from(String(value), 'utf8')
  if (bytes.length > length) throw new Error('Recovery archive tar field is too long.')
  const output = Buffer.alloc(length, 0)
  bytes.copy(output)
  return output
}

function tarEntry(name, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const header = Buffer.alloc(512, 0)
  tarField(name, 100).copy(header, 0)
  tarField('0000644\0', 8).copy(header, 100)
  tarField('0000000\0', 8).copy(header, 108)
  tarField('0000000\0', 8).copy(header, 116)
  tarField(`${bytes.length.toString(8).padStart(11, '0')}\0`, 12).copy(header, 124)
  tarField('00000000000\0', 12).copy(header, 136)
  header.fill(0x20, 148, 156)
  header[156] = 0x30
  tarField('ustar\0', 6).copy(header, 257)
  tarField('00', 2).copy(header, 263)
  const checksum = [...header].reduce((total, byte) => total + byte, 0)
  tarField(`${checksum.toString(8).padStart(6, '0')}\0 `, 8).copy(header, 148)
  const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512)
  return Buffer.concat([header, bytes, padding])
}

function createTarGzip(entries) {
  const ordered = [...entries].sort((left, right) => compareStrings(left.name, right.name))
  const names = new Set()
  const pieces = []
  for (const entry of ordered) {
    const name = safeRelativePath(entry.name)
    if (names.has(name)) throw new Error(`Recovery archive contains a duplicate entry: ${name}.`)
    names.add(name)
    pieces.push(tarEntry(name, entry.content))
  }
  pieces.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(pieces), { level: 9 })
}

async function buildChecksums(directory, files) {
  const lines = []
  for (const file of files) {
    lines.push(`${await sha256File(path.join(directory, file))}  ${file}`)
  }
  return `${lines.join('\n')}\n`
}

async function assertRequiredOutputs(directory) {
  for (const file of REQUIRED_FILES.slice(0, -2)) {
    const stat = await fs.stat(path.join(directory, file)).catch(() => null)
    if (!stat?.isFile() || stat.size <= 0) throw new Error(`Supabase recovery output is missing or empty: ${file}.`)
  }
}

function decodePublicKey(value) {
  const encoded = requireValue(value, 'Backup encryption public key Base64').replaceAll(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('Backup encryption public key Base64 is invalid.')
  }
  let decoded
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8')
  } catch {
    throw new Error('Backup encryption public key Base64 is invalid.')
  }
  if (!decoded.includes('BEGIN PUBLIC KEY')) throw new Error('Backup encryption public key is not a PEM public key.')
  return decoded
}

export async function buildSupabaseWholeProjectRecoveryBundle({
  dbUrl = process.env.SUPABASE_BACKUP_DB_URL,
  publicKeyB64 = process.env.BACKUP_ENCRYPTION_PUBLIC_KEY_B64,
  outputDirectory = process.env.SUPABASE_RECOVERY_OUTPUT_DIR || DEFAULT_OUTPUT_DIRECTORY,
  repositoryRoot = process.cwd(),
  projectRef = process.env.SUPABASE_PROJECT_REF,
  repository = process.env.GITHUB_REPOSITORY || 'local/recovery',
  commit = process.env.GITHUB_SHA || 'local',
  runId = process.env.GITHUB_RUN_ID || 'local',
  commandRunner = runCommand,
  cli = cliExecutable(),
  cliVersion = SUPABASE_CLI_VERSION,
  now = new Date()
} = {}) {
  const databaseUrl = requireValue(dbUrl, 'Supabase backup database URL')
  const publicKeyPem = decodePublicKey(publicKeyB64)
  const resolvedRoot = path.resolve(repositoryRoot)
  const resolvedOutput = path.resolve(resolvedRoot, outputDirectory)
  const resolvedProjectRef = normalizeProjectRef(projectRef)
  const temporaryRoot = process.env.RUNNER_TEMP || os.tmpdir()
  const temporaryDirectory = await fs.mkdtemp(path.join(temporaryRoot, 'tsa-bonno-whole-project-'))
  const stamp = now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
  const archiveName = `${DEFAULT_BUNDLE_PREFIX}${stamp}-${String(runId).replaceAll(/[^A-Za-z0-9_-]/g, '_')}.tar.gz`
  const archivePath = path.join(temporaryDirectory, archiveName)
  const encryptedPath = path.join(resolvedOutput, `${archiveName}.tbbackup`)
  const sensitiveValues = [
    databaseUrl,
    publicKeyPem,
    publicKeyB64
  ]

  try {
    await fs.mkdir(temporaryDirectory, { recursive: true })
    const plan = buildDumpCommandPlan({ dbUrl: databaseUrl, outputDirectory: temporaryDirectory, cli, cliVersion })
    for (const step of plan) {
      await commandRunner({
        command: step.command,
        args: step.args,
        cwd: resolvedRoot,
        env: buildCliEnvironment(temporaryDirectory),
        sensitiveValues,
        spec: step
      })
    }

    const inventory = await buildFunctionSourceInventory({ repositoryRoot: resolvedRoot })
    if (resolvedProjectRef) inventory.project_ref = resolvedProjectRef
    await fs.writeFile(path.join(temporaryDirectory, 'project-function-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' })
    await assertRequiredOutputs(temporaryDirectory)

    const metadata = {
      format_version: 1,
      bundle_type: 'supabase-whole-project-recovery',
      created_at: now.toISOString(),
      repository,
      commit,
      run_id: String(runId),
      project_ref: resolvedProjectRef || inventory.project_ref || null,
      supabase_cli_version: cliVersion,
      // SHA256SUMS is the manifest, so it is not a member of its own
      // checksum list. Keep it in the archive's required-file contract but
      // out of metadata.contents, matching the existing verifier contract.
      contents: REQUIRED_FILES.filter((file) => file !== 'SHA256SUMS'),
      restore_order: [...RESTORE_ORDER],
      remote_deployment_inventory: 'not-queried-without-management-api-token',
      excluded: [
        'Supabase Storage object bytes (Storage database metadata/schema is captured separately)',
        'Edge Function secret values',
        'Supabase project API keys and service-role credentials',
        'Supabase Management API tokens',
        'GitHub, R2, database, private-key, and passphrase secrets',
        'External provider credentials and configuration secrets'
      ]
    }
    await fs.writeFile(path.join(temporaryDirectory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' })
    const checksumFiles = REQUIRED_FILES.filter((file) => file !== 'SHA256SUMS')
    await fs.writeFile(path.join(temporaryDirectory, 'SHA256SUMS'), await buildChecksums(temporaryDirectory, checksumFiles), { flag: 'wx' })

    const entries = []
    for (const file of REQUIRED_FILES) {
      entries.push({ name: file, content: await fs.readFile(path.join(temporaryDirectory, file)) })
    }
    await fs.writeFile(archivePath, createTarGzip(entries), { flag: 'wx' })
    await fs.mkdir(resolvedOutput, { recursive: true })
    await encryptBackupFile({ inputPath: archivePath, outputPath: encryptedPath, publicKeyPem })
    const encryptedStat = await fs.stat(encryptedPath)
    return {
      encryptedPath,
      encryptedBytes: encryptedStat.size,
      archiveSha256: await sha256File(archivePath),
      requiredFiles: [...REQUIRED_FILES],
      restoreOrder: [...RESTORE_ORDER],
      inventory
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

function parseCliOptions(values) {
  const options = {}
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const name = token.slice(2)
    const value = values[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}.`)
    options[name] = value
    index += 1
  }
  return options
}

async function runCli() {
  const options = parseCliOptions(process.argv.slice(2))
  const result = await buildSupabaseWholeProjectRecoveryBundle({
    outputDirectory: options.output || process.env.SUPABASE_RECOVERY_OUTPUT_DIR || DEFAULT_OUTPUT_DIRECTORY,
    projectRef: options['project-ref'] || process.env.SUPABASE_PROJECT_REF
  })
  console.log(`Encrypted Supabase whole-project recovery bundle created: ${result.encryptedPath} (${result.encryptedBytes} bytes)`)
  console.log(`Archive SHA-256: ${result.archiveSha256}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runCli().catch((error) => {
    const safeSecrets = [process.env.SUPABASE_BACKUP_DB_URL, process.env.BACKUP_ENCRYPTION_PUBLIC_KEY_B64]
    console.error(`Supabase whole-project recovery failed: ${redact(error.message, safeSecrets)}`)
    process.exitCode = 1
  })
}

export {
  buildFunctionSourceInventory,
  createTarGzip,
  parseConfigKeys,
  sha256,
  sha256File,
  tarEntry
}
