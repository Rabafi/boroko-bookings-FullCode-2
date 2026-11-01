import { randomBytes } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import type { ServiceConfig } from '../config.js'
import {
  applyStagedUpdate as applyStagedUpdateLibrary,
  createEd25519UpdateTrust,
  readUpdateManifest,
  UpdateValidationError,
  updateManifestFileSha256,
  validateUpdatePackage
} from './updates.js'
import type { UpdateApplyReport, UpdateTrustVerifier, UpdateValidationReport } from './updates.js'

const MANIFEST_FILE = 'update-manifest.json'
const STAGED_MARKER = 'staged-update.json'
const LAST_APPLY = 'last-update.json'
const LAST_FAILURE = 'last-update-failure.json'
const LOCK_FILE = 'update.lock'
const STAGED_DIR = 'staged'
const MAX_INBOX_ENTRIES = 100

export interface UpdateCheckpointContext {
  readonly version: string
  readonly manifestPath: string
  readonly manifestSha256: string
  readonly incomingFiles: readonly string[]
}

export interface UpdateCheckpoint {
  readonly path: string
  readonly sha256?: string
}

export interface UpdateServiceDependencies {
  /** Injected clock, used by tests to make staged and applied evidence deterministic. */
  readonly now?: () => Date
  /** Injected trust, used by tests. Production trust is pinned from configuration. */
  readonly trust?: UpdateTrustVerifier | null
  /** Fail closed when local financial operations have not reached a final state. */
  readonly assertNoUnresolvedWork?: () => Promise<void>
  /** A verified encrypted backup that must exist before any file is promoted. */
  readonly createCheckpoint?: (context: UpdateCheckpointContext) => Promise<UpdateCheckpoint>
}

export interface StageUpdateRequest {
  readonly packageName: string
  readonly currentSchemaVersion: number
  readonly currentContractVersion: number
}

export interface ApplyUpdateRequest {
  readonly currentSchemaVersion: number
  readonly currentContractVersion: number
  readonly authorizedBy: string
  readonly reason: string
}

export interface StagedUpdate {
  readonly package: string
  readonly version: string
  readonly staged_at: string
  readonly manifest_sha256: string
  readonly signature_key_id: string
  readonly package_dir: string
  readonly checks: readonly string[]
}

export interface StagedUpdateState {
  readonly state: 'none' | 'staged' | 'invalid'
  readonly staged: StagedUpdate | null
  readonly message: string
  readonly error_code: string | null
  readonly lock_present: boolean
}

export interface UpdateTrustDescription {
  readonly configured: boolean
  readonly key_id: string | null
  readonly public_key_file: string | null
  readonly error: string | null
}

export interface UpdateInboxEntry {
  readonly package: string
  readonly version: string | null
  readonly manifest_present: boolean
  readonly manifest_sha256: string | null
  readonly error: string | null
}

export interface UpdateInboxListing {
  readonly directory: string
  readonly packages: readonly UpdateInboxEntry[]
  readonly truncated: boolean
}

interface StagedMarker {
  readonly format: string
  readonly format_version: number
  readonly staged_at: string
  readonly package: { readonly name: string; readonly version: string }
  readonly manifest_sha256: string
  readonly package_dir: string
  readonly signature_key_id: string
  readonly checks: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

function errorCode(error: unknown): string {
  return error instanceof UpdateValidationError ? error.code : 'UPDATE_OPERATION_FAILED'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The offline update operation failed.'
}

function nowIso(deps: UpdateServiceDependencies): string {
  return (deps.now ? deps.now() : new Date()).toISOString()
}

function assertInside(parent: string, candidate: string, field: string): string {
  const root = path.resolve(parent)
  const target = path.resolve(candidate)
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new UpdateValidationError('UPDATE_TARGET_INVALID', `${field} must remain inside ${root}.`)
  }
  return target
}

function assertPackageName(value: string): string {
  const name = value.trim()
  if (name.length === 0 || name.length > 160) {
    throw new UpdateValidationError('UPDATE_PACKAGE_NAME_INVALID', 'Choose an update package directory name of 1 to 160 characters.')
  }
  if (name === '.' || name === '..' || path.basename(name) !== name || /[\\/]/.test(name) || name.includes('\0')) {
    throw new UpdateValidationError('UPDATE_PACKAGE_NAME_INVALID', 'The update package name must be a single directory name without path separators.')
  }
  if (name.startsWith('.')) {
    throw new UpdateValidationError('UPDATE_PACKAGE_NAME_INVALID', 'The update package name must not begin with a dot.')
  }
  return name
}

export async function resolveUpdateTrust(
  config: ServiceConfig,
  deps: UpdateServiceDependencies = {}
): Promise<UpdateTrustVerifier | null> {
  if (deps.trust) return deps.trust
  const { keyId, publicKeyFile } = config.updates
  if (!keyId || !publicKeyFile) return null
  let pem: string
  try {
    pem = await readFile(publicKeyFile, 'utf8')
  } catch {
    throw new UpdateValidationError(
      'UPDATE_SIGNING_UNAVAILABLE',
      `The pinned update public key could not be read from ${publicKeyFile}. Configure the release public key before staging or applying an update.`
    )
  }
  return createEd25519UpdateTrust(keyId, pem)
}

export async function describeUpdateTrust(
  config: ServiceConfig,
  deps: UpdateServiceDependencies = {}
): Promise<UpdateTrustDescription> {
  const configuredKeyId = deps.trust?.keyId ?? config.updates.keyId
  if (deps.trust) {
    return { configured: true, key_id: deps.trust.keyId, public_key_file: null, error: null }
  }
  if (!config.updates.keyId || !config.updates.publicKeyFile) {
    return {
      configured: false,
      key_id: configuredKeyId,
      public_key_file: config.updates.publicKeyFile,
      error: 'No pinned release public key is configured. Offline updates cannot be verified or applied.'
    }
  }
  try {
    const trust = await resolveUpdateTrust(config, deps)
    return {
      configured: trust !== null,
      key_id: trust?.keyId ?? configuredKeyId,
      public_key_file: config.updates.publicKeyFile,
      error: null
    }
  } catch (error) {
    return {
      configured: false,
      key_id: configuredKeyId,
      public_key_file: config.updates.publicKeyFile,
      error: errorMessage(error)
    }
  }
}

export async function listUpdateInbox(config: ServiceConfig): Promise<UpdateInboxListing> {
  const directory = config.updates.inboxDir
  await mkdir(directory, { recursive: true })
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
  const packages: UpdateInboxEntry[] = []
  for (const entry of entries.slice(0, MAX_INBOX_ENTRIES)) {
    const manifestPath = path.join(directory, entry.name, MANIFEST_FILE)
    const manifestStats = await lstat(manifestPath).catch(() => null)
    if (!manifestStats?.isFile()) {
      packages.push({
        package: entry.name,
        version: null,
        manifest_present: false,
        manifest_sha256: null,
        error: `No ${MANIFEST_FILE} was found in this package directory.`
      })
      continue
    }
    try {
      const { manifest, sha256 } = await readUpdateManifest(manifestPath)
      packages.push({
        package: entry.name,
        version: manifest.package.version,
        manifest_present: true,
        manifest_sha256: sha256,
        error: null
      })
    } catch (error) {
      packages.push({
        package: entry.name,
        version: null,
        manifest_present: true,
        manifest_sha256: null,
        error: errorMessage(error)
      })
    }
  }
  return {
    directory,
    packages,
    truncated: entries.length > MAX_INBOX_ENTRIES
  }
}

function parseStagedMarker(raw: unknown, stagingDir: string): StagedMarker {
  if (!isRecord(raw)) {
    throw new UpdateValidationError('UPDATE_STAGED_MARKER_INVALID', 'The staged update marker is not a JSON object.')
  }
  if (raw.format !== 'bar-local-staged-update' || raw.format_version !== 1) {
    throw new UpdateValidationError('UPDATE_STAGED_MARKER_INVALID', 'The staged update marker has an unsupported format.')
  }
  const pkg = raw.package
  if (!isRecord(pkg) || typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
    throw new UpdateValidationError('UPDATE_STAGED_MARKER_INVALID', 'The staged update marker does not describe a package.')
  }
  if (typeof raw.staged_at !== 'string' || !Number.isFinite(Date.parse(raw.staged_at))) {
    throw new UpdateValidationError('UPDATE_STAGED_MARKER_INVALID', 'The staged update marker has no valid timestamp.')
  }
  if (typeof raw.manifest_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.manifest_sha256)) {
    throw new UpdateValidationError('UPDATE_STAGED_MARKER_INVALID', 'The staged update marker has no manifest digest.')
  }
  if (typeof raw.signature_key_id !== 'string' || raw.signature_key_id.trim().length === 0) {
    throw new UpdateValidationError('UPDATE_STAGED_MARKER_INVALID', 'The staged update marker has no signing key identifier.')
  }
  if (typeof raw.package_dir !== 'string' || path.basename(raw.package_dir) !== raw.package_dir
    || raw.package_dir === '.' || raw.package_dir === '..') {
    throw new UpdateValidationError('UPDATE_STAGED_MARKER_INVALID', 'The staged update marker has an unsafe package directory.')
  }
  assertInside(stagingDir, path.join(stagingDir, raw.package_dir), 'staged package directory')
  const checks = Array.isArray(raw.checks) ? raw.checks.filter((item): item is string => typeof item === 'string') : []
  return {
    format: 'bar-local-staged-update',
    format_version: 1,
    staged_at: raw.staged_at,
    package: { name: pkg.name, version: pkg.version },
    manifest_sha256: raw.manifest_sha256,
    package_dir: raw.package_dir,
    signature_key_id: raw.signature_key_id,
    checks
  }
}

export async function readStagedUpdate(config: ServiceConfig): Promise<StagedUpdateState> {
  const stagingDir = config.updates.stagingDir
  await mkdir(stagingDir, { recursive: true })
  const lockPresent = Boolean(await lstat(path.join(stagingDir, LOCK_FILE)).catch(() => null))
  const markerPath = path.join(stagingDir, STAGED_MARKER)
  let bytes: string
  try {
    bytes = await readFile(markerPath, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        state: 'none',
        staged: null,
        message: 'No verified update package is staged. Put a signed package directory in the update inbox and stage it first.',
        error_code: null,
        lock_present: lockPresent
      }
    }
    return {
      state: 'invalid',
      staged: null,
      message: 'The staged update marker could not be read.',
      error_code: 'UPDATE_STAGED_MARKER_INVALID',
      lock_present: lockPresent
    }
  }
  let marker: StagedMarker
  try {
    marker = parseStagedMarker(JSON.parse(bytes), stagingDir)
  } catch (error) {
    return {
      state: 'invalid',
      staged: null,
      message: errorMessage(error),
      error_code: errorCode(error),
      lock_present: lockPresent
    }
  }
  const packageRoot = path.join(stagingDir, marker.package_dir)
  const manifestPath = path.join(packageRoot, MANIFEST_FILE)
  const manifestStats = await lstat(manifestPath).catch(() => null)
  if (!manifestStats?.isFile()) {
    return {
      state: 'invalid',
      staged: null,
      message: 'The staged package no longer contains its signed manifest. Stage the package again.',
      error_code: 'UPDATE_STAGED_PACKAGE_MISSING',
      lock_present: lockPresent
    }
  }
  let manifestSha: string
  try {
    manifestSha = await updateManifestFileSha256(manifestPath)
  } catch {
    return {
      state: 'invalid',
      staged: null,
      message: 'The staged package manifest could not be hashed.',
      error_code: 'UPDATE_STAGED_PACKAGE_MISSING',
      lock_present: lockPresent
    }
  }
  if (manifestSha !== marker.manifest_sha256) {
    return {
      state: 'invalid',
      staged: null,
      message: 'The staged package manifest changed after it was verified. Stage the package again.',
      error_code: 'UPDATE_STAGED_MANIFEST_MISMATCH',
      lock_present: lockPresent
    }
  }
  return {
    state: 'staged',
    staged: {
      package: marker.package.name,
      version: marker.package.version,
      staged_at: marker.staged_at,
      manifest_sha256: marker.manifest_sha256,
      signature_key_id: marker.signature_key_id,
      package_dir: marker.package_dir,
      checks: marker.checks
    },
    message: `Verified update ${marker.package.version} is staged. Applying it requires an authorised operator, no unresolved work and a verified backup checkpoint.`,
    error_code: null,
    lock_present: lockPresent
  }
}

export async function readLastUpdateReport(config: ServiceConfig): Promise<Record<string, unknown> | null> {
  const raw = await readFile(path.join(config.updates.stagingDir, LAST_APPLY), 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function readLastUpdateFailure(config: ServiceConfig): Promise<Record<string, unknown> | null> {
  const raw = await readFile(path.join(config.updates.stagingDir, LAST_FAILURE), 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function acquireUpdateLock(stagingDir: string, action: 'stage' | 'apply'): Promise<() => Promise<void>> {
  await mkdir(stagingDir, { recursive: true })
  const lockPath = path.join(stagingDir, LOCK_FILE)
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(lockPath, 'wx')
  } catch (error) {
    if (isRecord(error) && error.code === 'EEXIST') {
      throw new UpdateValidationError(
        'UPDATE_BUSY',
        `Another update ${action === 'stage' ? 'staging' : 'apply'} operation holds ${lockPath}. Wait for it to finish. If no update is running, verify the staged package and remove the lock file deliberately before retrying.`
      )
    }
    throw new UpdateValidationError('UPDATE_STAGING_INVALID', `The update lock could not be created: ${errorMessage(error)}`)
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, action, started_at: new Date().toISOString() }))
  } catch {
    // The exclusive file already serialises the operation; marker content is diagnostic only.
  }
  let released = false
  return async () => {
    if (released) return
    released = true
    await handle.close().catch(() => {})
    await rm(lockPath, { force: true }).catch(() => {})
  }
}

async function copyPackageTree(sourceDir: string, targetDir: string): Promise<void> {
  const root = path.resolve(sourceDir)
  const target = path.resolve(targetDir)
  async function walk(relative: string): Promise<void> {
    const source = relative === '' ? root : path.join(root, ...relative.split('/'))
    const entries = await readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      const next = relative === '' ? entry.name : `${relative}/${entry.name}`
      const from = path.join(root, ...next.split('/'))
      const to = path.join(target, ...next.split('/'))
      if (entry.isSymbolicLink()) {
        throw new UpdateValidationError('UPDATE_ARTIFACT_INVALID', `The update package contains a symbolic link: ${next}`)
      }
      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true })
        await walk(next)
        continue
      }
      if (!entry.isFile()) {
        throw new UpdateValidationError('UPDATE_ARTIFACT_INVALID', `The update package contains an unsupported file type: ${next}`)
      }
      await mkdir(path.dirname(to), { recursive: true })
      await copyFile(from, to)
    }
  }
  await mkdir(target, { recursive: true })
  await walk('')
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

async function validateStagedPackage(
  config: ServiceConfig,
  packageRoot: string,
  trust: UpdateTrustVerifier,
  request: { currentSchemaVersion: number; currentContractVersion: number },
  diskDir: string
): Promise<UpdateValidationReport> {
  return validateUpdatePackage({
    manifestPath: path.join(packageRoot, MANIFEST_FILE),
    packageRoot,
    installedVersion: config.service.version,
    currentServiceVersion: config.service.version,
    currentSchemaVersion: request.currentSchemaVersion,
    currentContractVersion: request.currentContractVersion,
    diskDir,
    trust
  })
}

export interface StageUpdateResult {
  readonly command: 'update-stage'
  readonly ok: true
  readonly status: 'staged' | 'already_staged'
  readonly staged: StagedUpdate
  readonly validation: UpdateValidationReport
  readonly inbox_dir: string
  readonly staging_dir: string
}

export async function stageUpdatePackage(
  config: ServiceConfig,
  request: StageUpdateRequest,
  deps: UpdateServiceDependencies = {}
): Promise<StageUpdateResult> {
  const trust = await resolveUpdateTrust(config, deps)
  if (!trust) {
    throw new UpdateValidationError(
      'UPDATE_SIGNING_UNAVAILABLE',
      'No pinned release public key is configured. Offline updates cannot be verified or staged.'
    )
  }
  const packageName = assertPackageName(request.packageName)
  const inboxDir = config.updates.inboxDir
  const inboxPackage = assertInside(inboxDir, path.join(inboxDir, packageName), 'update package')
  const packageStats = await stat(inboxPackage).catch(() => null)
  if (!packageStats?.isDirectory()) {
    throw new UpdateValidationError('UPDATE_PACKAGE_MISSING', `The update package directory ${packageName} does not exist in ${inboxDir}.`)
  }

  const release = await acquireUpdateLock(config.updates.stagingDir, 'stage')
  try {
    const sourceValidation = await validateStagedPackage(
      config,
      inboxPackage,
      trust,
      request,
      inboxPackage
    )
    const previous = await readStagedUpdate(config)
    if (previous.state === 'staged' && previous.staged
      && previous.staged.version === sourceValidation.package.version
      && previous.staged.manifest_sha256 === sourceValidation.manifest_sha256) {
      return {
        command: 'update-stage',
        ok: true,
        status: 'already_staged',
        staged: previous.staged,
        validation: sourceValidation,
        inbox_dir: inboxDir,
        staging_dir: config.updates.stagingDir
      }
    }

    const stagingDir = config.updates.stagingDir
    const nextDir = path.join(stagingDir, `${STAGED_DIR}.next-${process.pid}-${randomBytes(6).toString('hex')}`)
    await rm(nextDir, { recursive: true, force: true })
    let validation: UpdateValidationReport
    try {
      await copyPackageTree(inboxPackage, nextDir)
      validation = await validateStagedPackage(config, nextDir, trust, request, stagingDir)
    } catch (error) {
      await rm(nextDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }

    const marker: StagedMarker = {
      format: 'bar-local-staged-update',
      format_version: 1,
      staged_at: nowIso(deps),
      package: { name: validation.package.name, version: validation.package.version },
      manifest_sha256: validation.manifest_sha256,
      package_dir: STAGED_DIR,
      signature_key_id: validation.signature.key_id,
      checks: validation.checks
    }
    await writeJsonAtomic(path.join(nextDir, STAGED_MARKER), marker)

    const currentDir = path.join(stagingDir, STAGED_DIR)
    const previousDir = path.join(stagingDir, `${STAGED_DIR}.previous-${process.pid}-${randomBytes(6).toString('hex')}`)
    const hadPrevious = Boolean(await lstat(currentDir).catch(() => null))
    if (hadPrevious) await rename(currentDir, previousDir)
    try {
      await rename(nextDir, currentDir)
    } catch (error) {
      if (hadPrevious) await rename(previousDir, currentDir).catch(() => {})
      await rm(nextDir, { recursive: true, force: true }).catch(() => {})
      throw new UpdateValidationError('UPDATE_STAGING_INVALID', `The verified package could not be moved into staging: ${errorMessage(error)}`)
    }
    if (hadPrevious) await rm(previousDir, { recursive: true, force: true }).catch(() => {})
    await rm(path.join(stagingDir, LAST_FAILURE), { force: true }).catch(() => {})
    await writeJsonAtomic(path.join(stagingDir, STAGED_MARKER), marker)

    return {
      command: 'update-stage',
      ok: true,
      status: 'staged',
      staged: {
        package: marker.package.name,
        version: marker.package.version,
        staged_at: marker.staged_at,
        manifest_sha256: marker.manifest_sha256,
        signature_key_id: marker.signature_key_id,
        package_dir: marker.package_dir,
        checks: marker.checks
      },
      validation,
      inbox_dir: inboxDir,
      staging_dir: stagingDir
    }
  } finally {
    await release()
  }
}

export interface ApplyUpdateResult extends UpdateApplyReport {
  readonly command: 'update-apply'
  readonly authorized_by: string
  readonly reason: string
  readonly staged_package_removed: boolean
}

export async function applyUpdatePackage(
  config: ServiceConfig,
  request: ApplyUpdateRequest,
  deps: UpdateServiceDependencies = {}
): Promise<ApplyUpdateResult> {
  if (!config.updates.applyEnabled) {
    throw new UpdateValidationError(
      'UPDATE_APPLY_DISABLED',
      'Applying an update is disabled on this service. Set BAR_LOCAL_UPDATE_APPLY_ENABLED after the release key and recovery checkpoint are proven.'
    )
  }
  const trust = await resolveUpdateTrust(config, deps)
  if (!trust) {
    throw new UpdateValidationError(
      'UPDATE_SIGNING_UNAVAILABLE',
      'No pinned release public key is configured. Offline updates cannot be verified or applied.'
    )
  }
  if (!deps.assertNoUnresolvedWork) {
    throw new UpdateValidationError(
      'UPDATE_PREFLIGHT_UNAVAILABLE',
      'The update preflight cannot inspect unresolved financial operations, so the update is refused.'
    )
  }
  if (!deps.createCheckpoint) {
    throw new UpdateValidationError(
      'UPDATE_CHECKPOINT_REQUIRED',
      'Applying an update requires a verified encrypted backup checkpoint.'
    )
  }
  const stagingDir = config.updates.stagingDir
  const release = await acquireUpdateLock(stagingDir, 'apply')
  let checkpointPath: string | null = null
  try {
    const state = await readStagedUpdate(config)
    if (state.state !== 'staged' || !state.staged) {
      throw new UpdateValidationError(
        'UPDATE_NOT_STAGED',
        `No verified update package is staged. ${state.message}`
      )
    }
    await deps.assertNoUnresolvedWork()

    const packageRoot = path.join(stagingDir, state.staged.package_dir)
    const manifestPath = path.join(packageRoot, MANIFEST_FILE)

    let report: UpdateApplyReport
    try {
      report = await applyStagedUpdateLibrary({
        manifestPath,
        packageRoot,
        installedVersion: config.service.version,
        currentServiceVersion: config.service.version,
        currentSchemaVersion: request.currentSchemaVersion,
        currentContractVersion: request.currentContractVersion,
        diskDir: stagingDir,
        trust,
        installDir: config.updates.installDir,
        stagingDir,
        dataDirs: config.updates.dataDirs,
        checkpoint: async (context) => {
          const verified = await deps.createCheckpoint!({
            version: context.version,
            manifestPath: context.manifestPath,
            manifestSha256: context.manifestSha256,
            incomingFiles: context.incomingFiles
          })
          checkpointPath = verified.path
          return { path: verified.path, sha256: verified.sha256 }
        }
      })
    } catch (error) {
      await writeJsonAtomic(path.join(stagingDir, LAST_FAILURE), {
        failed_at: nowIso(deps),
        code: errorCode(error),
        message: errorMessage(error).slice(0, 1000),
        checkpoint_path: checkpointPath,
        staged: state.staged,
        authorized_by: request.authorizedBy,
        reason: request.reason,
        recovery: 'The staged package and checkpoint were retained. Correct the reported cause, verify the live database still serves trading, and repeat the update or restore from the checkpoint under owner authorisation.'
      }).catch(() => {})
      throw error
    }

    await writeJsonAtomic(path.join(stagingDir, LAST_APPLY), {
      applied_at: nowIso(deps),
      ...report,
      authorized_by: request.authorizedBy,
      reason: request.reason
    }).catch(() => {})
    let removed = false
    try {
      await rm(path.join(stagingDir, state.staged.package_dir), { recursive: true, force: true })
      await rm(path.join(stagingDir, STAGED_MARKER), { force: true })
      await rm(path.join(stagingDir, LAST_FAILURE), { force: true })
      removed = true
    } catch {
      removed = false
    }
    return {
      ...report,
      command: 'update-apply',
      authorized_by: request.authorizedBy,
      reason: request.reason,
      staged_package_removed: removed
    }
  } finally {
    await release()
  }
}
