#!/usr/bin/env node
// Stage the verified local Bar server payload used by automatic server setup.
//
// The payload is assembled from the already-built service, the pinned
// PostgreSQL 17 runtime and the Node runtime that runs this script. It is not
// downloaded. Every staged file is hashed into manifest.json; the desktop app
// refuses to install a payload whose files do not match that manifest.
//
// Usage:
//   node scripts/stage-bar-local-server.mjs
//   node scripts/stage-bar-local-server.mjs --output build/bar-local-server
//   node scripts/stage-bar-local-server.mjs --verify-only

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  cpSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  rmSync, statSync, writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const SERVICE_ROOT = join(REPO_ROOT, 'services', 'bar-local')
const PG_ROOT = join(SERVICE_ROOT, '.local', 'pg17runtime', 'pgsql')
const DEFAULT_OUTPUT = join(REPO_ROOT, 'build', 'bar-local-server')
const REQUIRED = [
  'server/dist/server.js',
  'server/package.json',
  'server/scripts/provision-local.mjs',
  'server/scripts/bar-operations.mjs',
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
]

function fail(message) {
  console.error(`[stage-bar-local-server] ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT
  let verifyOnly = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output') {
      const next = argv[++index]
      if (!next) fail('--output requires a directory')
      output = isAbsolute(next) ? next : resolve(REPO_ROOT, next)
    } else if (arg === '--verify-only') {
      verifyOnly = true
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/stage-bar-local-server.mjs [--output <dir>] [--verify-only]')
      process.exit(0)
    } else {
      fail(`Unknown argument: ${arg}`)
    }
  }
  return { output, verifyOnly }
}

function sha256(file) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolvePromise(hash.digest('hex')))
  })
}

function walk(root, base = root, out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name)
    if (entry.isSymbolicLink()) fail(`Refusing to stage symbolic link: ${absolute}`)
    if (entry.isDirectory()) walk(absolute, base, out)
    else if (entry.isFile()) out.push(relative(base, absolute).split(sep).join('/'))
  }
  return out
}

function requireFile(file, label) {
  if (!existsSync(file) || !statSync(file).isFile()) fail(`${label} is missing: ${file}`)
}

function readVersion(output, pattern, label) {
  const match = String(output).match(pattern)
  if (!match) fail(`Could not read ${label} version from: ${String(output).trim()}`)
  return match[1]
}

function postgresVersion() {
  const exe = join(PG_ROOT, 'bin', 'postgres.exe')
  requireFile(exe, 'PostgreSQL runtime')
  const result = spawnSync(exe, ['--version'], { encoding: 'utf8' })
  if (result.status !== 0) fail(`postgres.exe --version failed: ${result.stderr || result.stdout}`)
  return readVersion(`${result.stdout}${result.stderr}`, /PostgreSQL\)\s+(\d+\.\d+(?:\.\d+)?)/, 'PostgreSQL')
}

function nodeVersion() {
  if (process.platform !== 'win32') fail('The local Bar server payload can only be staged on Windows.')
  if (!/^node\.exe$/i.test(process.execPath.split(/[\\/]/).pop() || '')) {
    fail(`Run this script with node.exe, not ${process.execPath}.`)
  }
  const major = Number(process.versions.node.split('.')[0])
  if (!Number.isInteger(major) || major < 20) fail(`Node.js 20 or newer is required; found ${process.version}.`)
  return `v${process.versions.node}`
}

function copyRuntime(source, destination, { exclude = [] } = {}) {
  if (!existsSync(source)) fail(`Runtime source is missing: ${source}`)
  cpSync(source, destination, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (src) => {
      const rel = relative(source, src).split(sep).join('/')
      return !exclude.some((entry) => rel === entry || rel.startsWith(`${entry}/`))
    }
  })
}

function stageServer(destination) {
  for (const directory of ['dist', 'db', 'scripts', 'packaging']) {
    const source = join(SERVICE_ROOT, directory)
    if (!existsSync(source)) fail(`Build the local Bar service first; ${source} is missing. Run: npm run bar-local:build`)
    copyRuntime(source, join(destination, directory), { exclude: ['.local', 'tests', 'node_modules'] })
  }
  for (const file of ['package.json', 'package-lock.json']) {
    const source = join(SERVICE_ROOT, file)
    if (existsSync(source)) cpSync(source, join(destination, file))
  }
  const modules = join(SERVICE_ROOT, 'node_modules')
  if (existsSync(modules)) {
    copyRuntime(modules, join(destination, 'node_modules'), {
      exclude: ['.bin', '.package-lock.json', 'typescript', '@types', '@tsa-bonno']
    })
  }
  const contracts = join(REPO_ROOT, 'packages', 'bar-contracts')
  const contractsDestination = join(destination, 'node_modules', '@tsa-bonno', 'bar-contracts')
  if (existsSync(join(contracts, 'dist', 'index.js'))) {
    copyRuntime(contracts, contractsDestination, { exclude: ['src', 'node_modules', 'tests'] })
  } else if (!existsSync(join(contractsDestination, 'package.json'))) {
    fail('packages/bar-contracts is not built. Run: npm run bar-local:build')
  }
  const source = join(SERVICE_ROOT, 'dist', 'server.js')
  requireFile(source, 'Built service')
}

function stagePostgres(destination) {
  const bin = join(PG_ROOT, 'bin')
  const share = join(PG_ROOT, 'share')
  requireFile(join(bin, 'postgres.exe'), 'PostgreSQL runtime')
  if (!existsSync(join(share, 'postgres.bki'))) {
    fail(`PostgreSQL share directory is incomplete: ${share}`)
  }
  copyRuntime(bin, join(destination, 'bin'), { exclude: ['pgAdmin4.exe'] })
  copyRuntime(share, join(destination, 'share'))
  // initdb loads dict_snowball and plpgsql from $libdir; bin/share alone
  // passes --version but cannot create a working cluster.
  requireFile(join(PG_ROOT, 'lib', 'dict_snowball.dll'), 'PostgreSQL server libraries')
  copyRuntime(join(PG_ROOT, 'lib'), join(destination, 'lib'))
  for (const license of ['COPYRIGHT', 'LICENSE', 'README.md']) {
    const file = join(PG_ROOT, license)
    if (existsSync(file)) cpSync(file, join(destination, license))
  }
}

function stageNode(destination) {
  mkdirSync(destination, { recursive: true })
  cpSync(process.execPath, join(destination, 'node.exe'))
  for (const name of ['LICENSE', 'LICENSE.md']) {
    const license = join(dirname(process.execPath), name)
    if (existsSync(license)) cpSync(license, join(destination, name))
  }
}

async function buildManifest(output) {
  const files = {}
  for (const name of walk(output).sort()) {
    if (name === 'manifest.json') continue
    files[name] = await sha256(join(output, name))
  }
  const service = JSON.parse(readFileSync(join(SERVICE_ROOT, 'package.json'), 'utf8'))
  return {
    schema: 1,
    service_version: String(service.version || '0.0.0'),
    postgres_version: postgresVersion(),
    node_version: nodeVersion(),
    created_at: new Date().toISOString(),
    files
  }
}

async function verify(output) {
  const manifestPath = join(output, 'manifest.json')
  if (!existsSync(manifestPath)) fail(`Manifest is missing: ${manifestPath}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const required of REQUIRED) {
    if (!manifest.files?.[required]) fail(`Manifest is missing required file: ${required}`)
  }
  let checked = 0
  for (const [name, hash] of Object.entries(manifest.files)) {
    const file = resolve(output, name)
    const rel = relative(output, file)
    if (rel.startsWith('..') || isAbsolute(rel)) fail(`Unsafe manifest path: ${name}`)
    if (!existsSync(file)) fail(`Staged file is missing: ${name}`)
    if (await sha256(file) !== hash) fail(`Staged file hash mismatch: ${name}`)
    checked += 1
  }
  console.log(`[stage-bar-local-server] Verified ${checked} files in ${output}`)
}

const { output, verifyOnly } = parseArgs(process.argv.slice(2))
if (verifyOnly) {
  await verify(output)
  process.exit(0)
}

if (existsSync(join(output, 'manifest.json'))) {
  // A stale staging tree is replaced, never merged; otherwise an old file
  // could survive with a valid manifest entry and be installed unnoticed.
  rmSync(output, { recursive: true, force: true })
}
const staging = `${output}.tmp-${process.pid}`
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
try {
  stageServer(join(staging, 'server'))
  stagePostgres(join(staging, 'postgres'))
  stageNode(join(staging, 'node'))
  for (const required of REQUIRED) requireFile(join(staging, required), `Required payload file ${required}`)
  const manifest = await buildManifest(staging)
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  rmSync(output, { recursive: true, force: true })
  mkdirSync(dirname(output), { recursive: true })
  renameSync(staging, output)
  await verify(output)
  console.log(`[stage-bar-local-server] Staged ${Object.keys(manifest.files).length} files for service ${manifest.service_version}, PostgreSQL ${manifest.postgres_version}, Node ${manifest.node_version}.`)
} catch (error) {
  rmSync(staging, { recursive: true, force: true })
  throw error
}
