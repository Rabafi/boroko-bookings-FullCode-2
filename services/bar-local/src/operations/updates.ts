import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  statfs
} from 'node:fs/promises'
import path from 'node:path'

const MANIFEST_FORMAT = 'bar-local-update'
const MANIFEST_VERSION = 1
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA256_RE = /^[0-9a-f]{64}$/
const DEFAULT_FREE_SPACE_MARGIN = 64 * 1024 * 1024

export class UpdateValidationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'UpdateValidationError'
    this.code = code
  }
}

export interface SemVer {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

export interface UpdateVersionRange {
  readonly min: string
  readonly max: string
}

export interface UpdateNumericRange {
  readonly min: number
  readonly max: number
}

export interface UpdateArtifact {
  readonly source: string
  readonly target: string
  readonly sha256: string
  readonly bytes: number
  readonly mode?: number
}

export interface UpdateSignature {
  readonly algorithm: string
  readonly key_id: string
  readonly value: string
}

export interface UpdateTrustVerifier {
  readonly keyId: string
  verify(input: {
    readonly manifest_sha256: string
    readonly manifest: UpdateManifest
    readonly signature: UpdateSignature
  }): Promise<boolean> | boolean
}

/**
 * Build the production Ed25519 verifier for offline update manifests. The
 * signed digest is over the parsed manifest with signature.value blanked, so
 * the signature never has to sign itself. The digest is SHA-256 and Ed25519
 * signs the 32 digest bytes directly (no second hashing step).
 */
export function createEd25519UpdateTrust(keyId: string, publicKeyPem: string): UpdateTrustVerifier {
  const normalizedKeyId = keyId.trim()
  if (!normalizedKeyId) throw new UpdateValidationError('UPDATE_SIGNING_UNAVAILABLE', 'A pinned update signing key identifier is required.')
  let publicKey
  try {
    publicKey = createPublicKey(publicKeyPem)
  } catch {
    throw new UpdateValidationError('UPDATE_SIGNING_UNAVAILABLE', 'The pinned update public key is not a valid PEM key.')
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new UpdateValidationError('UPDATE_SIGNING_UNAVAILABLE', 'The pinned update public key must use Ed25519.')
  }
  return Object.freeze({
    keyId: normalizedKeyId,
    verify: ({ manifest_sha256, manifest, signature }: {
      readonly manifest_sha256: string
      readonly manifest: UpdateManifest
      readonly signature: UpdateSignature
    }) => {
      if (signature.algorithm !== 'ed25519') return false
      const expectedDigest = updateSigningPayloadSha256(manifest)
      if (manifest_sha256 !== expectedDigest) return false
      let decoded: Buffer
      try {
        decoded = Buffer.from(signature.value, 'base64')
        if (decoded.length !== 64 || decoded.toString('base64') !== signature.value) return false
      } catch {
        return false
      }
      return verifySignature(null, Buffer.from(expectedDigest, 'hex'), publicKey, decoded)
    }
  })
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function updateSigningPayloadSha256(manifest: UpdateManifest): string {
  const signingManifest = {
    ...manifest,
    signature: manifest.signature ? { ...manifest.signature, value: '' } : null
  }
  return createHash('sha256').update(canonicalJson(signingManifest), 'utf8').digest('hex')
}

export interface UpdateManifest {
  readonly format: typeof MANIFEST_FORMAT
  readonly format_version: typeof MANIFEST_VERSION
  readonly package: {
    readonly name: string
    readonly version: string
  }
  readonly compatibility: {
    readonly schema: UpdateNumericRange
    readonly contract: UpdateNumericRange
    readonly service: UpdateVersionRange
  }
  readonly files: readonly UpdateArtifact[]
  readonly requires: {
    readonly min_free_bytes: number
    readonly extra_free_bytes: number
  }
  readonly created_at: string
  readonly notes: string | null
  readonly signature: UpdateSignature | null
}

export interface UpdateValidationOptions {
  readonly manifestPath: string
  readonly packageRoot: string
  readonly installedVersion: string
  readonly currentSchemaVersion: number
  readonly currentContractVersion: number
  readonly currentServiceVersion?: string | null
  readonly diskDir?: string | null
  readonly extraFreeBytes?: number | null
  readonly statfsFn?: DiskSpaceProbe
  readonly trust?: UpdateTrustVerifier | null
}

export interface UpdateValidationReport {
  readonly ok: true
  readonly status: 'validated'
  readonly generated_at: string
  readonly manifest_sha256: string
  readonly signature: {
    readonly key_id: string
    readonly algorithm: string
    readonly verified: true
  }
  readonly package: {
    readonly name: string
    readonly version: string
    readonly installed_version: string
  }
  readonly compatibility: {
    readonly schema: UpdateNumericRange & { readonly current: number }
    readonly contract: UpdateNumericRange & { readonly current: number }
    readonly service: UpdateVersionRange & { readonly current: string }
  }
  readonly files: readonly UpdateArtifact[]
  readonly disk: {
    readonly required_bytes: string
    readonly available_bytes: string
    readonly directory: string
  }
  readonly checks: readonly string[]
}

export interface UpdateApplyOptions extends UpdateValidationOptions {
  readonly installDir: string
  readonly stagingDir: string
  readonly dataDirs?: readonly string[]
  readonly checkpoint: (context: {
    readonly version: string
    readonly manifestPath: string
    readonly manifestSha256: string
    readonly incomingFiles: readonly string[]
  }) => Promise<{ readonly path: string; readonly sha256?: string }>
}

export interface UpdateApplyReport {
  readonly ok: true
  readonly status: 'applied'
  readonly generated_at: string
  readonly version: string
  readonly installed_version: string
  readonly applied_files: readonly string[]
  readonly checkpoint_path: string
  readonly checkpoint_sha256: string
  readonly signature_key_id: string
  readonly staging_dir: string
  readonly staging_cleaned: true
  readonly data_dirs_preserved: readonly string[]
}

export type DiskSpaceProbe = (directory: string) => Promise<bigint>

export interface UninstallPlanOptions {
  readonly installDir: string
  readonly managedFiles: readonly string[]
  readonly dataDirs?: readonly string[]
  readonly purgeData?: boolean
}

export interface UninstallPlan {
  readonly ok: true
  readonly install_dir: string
  readonly files: readonly string[]
  readonly missing: readonly string[]
  readonly data_dirs_preserved: readonly string[]
  readonly data_preserved: true
}

export interface UninstallReport extends UninstallPlan {
  readonly status: 'uninstalled'
  readonly removed: readonly string[]
  readonly errors: readonly string[]
}

interface StageEntry {
  readonly artifact: UpdateArtifact
  readonly targetPath: string
  readonly stagedPath: string
  readonly rollbackPath: string | null
  readonly rollbackSha256: string | null
  readonly existed: boolean
}

export function parseVersion(value: unknown, field = 'version'): SemVer {
  if (typeof value !== 'string' || !SEMVER_RE.test(value)) {
    throw new UpdateValidationError('UPDATE_VERSION_INVALID', `${field} must be a plain semantic version such as 1.2.3.`)
  }
  const [major, minor, patch] = value.split('.').map((part) => Number.parseInt(part, 10))
  return { major, minor, patch }
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left, 'left version')
  const b = parseVersion(right, 'right version')
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

export function assertUpgradeVersion(candidate: string, installed: string): void {
  const comparison = compareVersions(candidate, installed)
  if (comparison === 0) {
    throw new UpdateValidationError('UPDATE_VERSION_NOT_NEWER', `Update ${candidate} is already installed.`)
  }
  if (comparison < 0) {
    throw new UpdateValidationError('UPDATE_DOWNGRADE_BLOCKED', `Silent downgrade from ${installed} to ${candidate} is refused.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field} contains unsupported field "${key}".`)
    }
  }
}

function assertSafeRelativePath(value: unknown, field: string, options: { allowSpaces?: boolean } = {}): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field} must be a non-empty relative path.`)
  }
  if (value.includes('\0') || value.includes('\\')) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field} must use forward-slash relative paths without control bytes.`)
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.startsWith('//')) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field} must not be absolute.`)
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    throw new UpdateValidationError('UPDATE_DOWNLOAD_BLOCKED', `${field} must reference a local package file, not a URL.`)
  }
  const parts = value.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field} must not contain empty, current or parent path segments.`)
  }
  if (!options.allowSpaces && /\s/.test(value)) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field} must not contain whitespace.`)
  }
  if (/[<>:"|?*]/.test(value)) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field} contains characters unsupported on Windows.`)
  }
  return value
}

function integerField(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field} must be an integer between ${minimum} and ${maximum}.`)
  }
  return Number(value)
}

function numericRange(value: unknown, field: string): UpdateNumericRange {
  if (!isRecord(value)) throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field} must be an object.`)
  assertKeys(value, ['min', 'max'], field)
  const min = integerField(value.min, `${field}.min`, 0, 1_000_000)
  const max = integerField(value.max, `${field}.max`, 0, 1_000_000)
  if (min > max) throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `${field}.min cannot exceed ${field}.max.`)
  return { min, max }
}

function serviceRange(value: unknown): UpdateVersionRange {
  if (!isRecord(value)) throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'compatibility.service must be an object.')
  assertKeys(value, ['min', 'max'], 'compatibility.service')
  const min = parseVersion(value.min, 'compatibility.service.min')
  const max = parseVersion(value.max, 'compatibility.service.max')
  if (compareVersions(`${min.major}.${min.minor}.${min.patch}`, `${max.major}.${max.minor}.${max.patch}`) > 0) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'compatibility.service.min cannot exceed its max.')
  }
  return { min: `${min.major}.${min.minor}.${min.patch}`, max: `${max.major}.${max.minor}.${max.patch}` }
}

function signatureField(value: unknown): UpdateSignature | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'signature must be an object when present.')
  assertKeys(value, ['algorithm', 'key_id', 'value'], 'signature')
  if (typeof value.algorithm !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(value.algorithm)) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'signature.algorithm must be a short lowercase identifier.')
  }
  if (typeof value.key_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value.key_id)) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'signature.key_id must identify the signing key.')
  }
  if (typeof value.value !== 'string' || value.value.length < 32 || value.value.length > 16_384
    || !/^[A-Za-z0-9+/=_-]+$/.test(value.value)) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'signature.value must be an encoded signature.')
  }
  return { algorithm: value.algorithm, key_id: value.key_id, value: value.value }
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
  if (!isRecord(value)) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'The update manifest must be a JSON object.')
  }
  assertKeys(value, ['format', 'format_version', 'package', 'compatibility', 'files', 'requires', 'created_at', 'notes', 'signature'], 'manifest')
  if (value.format !== MANIFEST_FORMAT || value.format_version !== MANIFEST_VERSION) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'The update manifest format or version is not supported.')
  }
  if (!isRecord(value.package)) throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'package must be an object.')
  assertKeys(value.package, ['name', 'version'], 'package')
  const name = value.package.name
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'package.name is invalid.')
  }
  const version = value.package.version
  if (typeof version !== 'string') {
    throw new UpdateValidationError('UPDATE_VERSION_INVALID', 'package.version must be a semantic version string.')
  }
  parseVersion(version, 'package.version')

  if (!isRecord(value.compatibility)) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'compatibility must be an object.')
  }
  assertKeys(value.compatibility, ['schema', 'contract', 'service'], 'compatibility')
  const schema = numericRange(value.compatibility.schema, 'compatibility.schema')
  const contract = numericRange(value.compatibility.contract, 'compatibility.contract')
  const service = serviceRange(value.compatibility.service)

  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > 10_000) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'files must contain between 1 and 10000 entries.')
  }
  const files: UpdateArtifact[] = []
  const sources = new Set<string>()
  const targets = new Set<string>()
  for (const [index, raw] of value.files.entries()) {
    if (!isRecord(raw)) throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `files[${index}] must be an object.`)
    assertKeys(raw, ['source', 'target', 'sha256', 'bytes', 'mode'], `files[${index}]`)
    const source = assertSafeRelativePath(raw.source, `files[${index}].source`)
    const target = assertSafeRelativePath(raw.target, `files[${index}].target`)
    if (typeof raw.sha256 !== 'string' || !SHA256_RE.test(raw.sha256.toLowerCase())) {
      throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `files[${index}].sha256 must be a SHA-256 hex digest.`)
    }
    const bytes = integerField(raw.bytes, `files[${index}].bytes`, 0, Number.MAX_SAFE_INTEGER)
    const mode = raw.mode === undefined ? undefined : integerField(raw.mode, `files[${index}].mode`, 0, 0o777)
    if (sources.has(source)) throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `Duplicate update source ${source}.`)
    if (targets.has(target)) throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `Duplicate update target ${target}.`)
    sources.add(source)
    targets.add(target)
    files.push({ source, target, sha256: raw.sha256.toLowerCase(), bytes, ...(mode === undefined ? {} : { mode }) })
  }

  const requires = isRecord(value.requires) ? value.requires : {}
  assertKeys(requires, ['min_free_bytes', 'extra_free_bytes'], 'requires')
  const minFreeBytes = requires.min_free_bytes === undefined
    ? 0
    : integerField(requires.min_free_bytes, 'requires.min_free_bytes', 0, Number.MAX_SAFE_INTEGER)
  const extraFreeBytes = requires.extra_free_bytes === undefined
    ? 0
    : integerField(requires.extra_free_bytes, 'requires.extra_free_bytes', 0, Number.MAX_SAFE_INTEGER)

  if (typeof value.created_at !== 'string') {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'created_at must be an ISO timestamp.')
  }
  const createdAt = new Date(value.created_at)
  if (Number.isNaN(createdAt.getTime())) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'created_at must be an ISO timestamp.')
  }
  let notes: string | null = null
  if (value.notes !== undefined && value.notes !== null) {
    if (typeof value.notes !== 'string' || value.notes.length > 2000) {
      throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'notes must be a string of at most 2000 characters.')
    }
    notes = value.notes
  }
  const signature = signatureField(value.signature)

  return {
    format: MANIFEST_FORMAT,
    format_version: MANIFEST_VERSION,
    package: { name, version },
    compatibility: { schema, contract, service },
    files,
    requires: { min_free_bytes: minFreeBytes, extra_free_bytes: extraFreeBytes },
    created_at: createdAt.toISOString(),
    notes,
    signature
  }
}

export async function readUpdateManifest(manifestPath: string): Promise<{ manifest: UpdateManifest; sha256: string; bytes: Buffer }> {
  let bytes: Buffer
  try {
    bytes = await readFile(manifestPath)
  } catch {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `The update manifest could not be read: ${manifestPath}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', 'The update manifest is not valid JSON.')
  }
  return {
    manifest: parseUpdateManifest(parsed),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes
  }
}

export function requiredDiskBytes(manifest: UpdateManifest, extraFreeBytes = 0): bigint {
  const payload = manifest.files.reduce((total, file) => total + BigInt(file.bytes), 0n)
  const minimum = BigInt(Math.max(0, Math.trunc(manifest.requires.min_free_bytes)))
  const extra = BigInt(Math.max(0, Math.trunc(manifest.requires.extra_free_bytes + extraFreeBytes)))
  return maximum(payload + BigInt(DEFAULT_FREE_SPACE_MARGIN) + extra, minimum)
}

function maximum(left: bigint, right: bigint): bigint {
  return left > right ? left : right
}

export const defaultDiskSpaceProbe: DiskSpaceProbe = async (directory) => {
  const stats = await statfs(directory, { bigint: true })
  return stats.bavail * stats.bsize
}

export async function availableDiskBytes(directory: string, statfsFn: DiskSpaceProbe = defaultDiskSpaceProbe): Promise<bigint> {
  return statfsFn(directory)
}

export async function assertDiskSpace(
  requiredBytes: bigint | number,
  directory: string,
  statfsFn: DiskSpaceProbe = defaultDiskSpaceProbe
): Promise<void> {
  const required = typeof requiredBytes === 'bigint' ? requiredBytes : BigInt(Math.max(0, Math.trunc(requiredBytes)))
  const available = await statfsFn(directory)
  if (available < required) {
    throw new UpdateValidationError(
      'UPDATE_DISK_SPACE_INSUFFICIENT',
      `The update requires ${required} bytes but only ${available} bytes are available in ${directory}.`
    )
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

async function assertArtifactFile(
  packageRoot: string,
  artifact: UpdateArtifact
): Promise<{ sourcePath: string; stats: Awaited<ReturnType<typeof lstat>> }> {
  const sourcePath = path.resolve(packageRoot, ...artifact.source.split('/'))
  const root = path.resolve(packageRoot)
  if (sourcePath !== root && !sourcePath.startsWith(`${root}${path.sep}`)) {
    throw new UpdateValidationError('UPDATE_MANIFEST_INVALID', `Update source escapes the package root: ${artifact.source}`)
  }
  const stats = await lstat(sourcePath).catch(() => null)
  if (!stats || stats.isSymbolicLink() || !stats.isFile()) {
    throw new UpdateValidationError('UPDATE_ARTIFACT_MISSING', `Update artifact is missing or not a regular file: ${artifact.source}`)
  }
  if (stats.size !== artifact.bytes) {
    throw new UpdateValidationError('UPDATE_ARTIFACT_SIZE_MISMATCH', `Update artifact size does not match the manifest: ${artifact.source}`)
  }
  const digest = await hashFile(sourcePath)
  if (digest !== artifact.sha256) {
    throw new UpdateValidationError('UPDATE_ARTIFACT_HASH_MISMATCH', `Update artifact SHA-256 does not match the manifest: ${artifact.source}`)
  }
  return { sourcePath, stats }
}

function assertRange(current: number, range: UpdateNumericRange, field: string): void {
  if (!Number.isInteger(current) || current < range.min || current > range.max) {
    throw new UpdateValidationError(
      'UPDATE_INCOMPATIBLE_SCHEMA',
      `${field} version ${current} is outside the update package range ${range.min}-${range.max}.`
    )
  }
}

function assertVersionRange(current: string, range: UpdateVersionRange, field: string): void {
  const currentVersion = parseVersion(current, field)
  const normalized = `${currentVersion.major}.${currentVersion.minor}.${currentVersion.patch}`
  if (compareVersions(normalized, range.min) < 0 || compareVersions(normalized, range.max) > 0) {
    throw new UpdateValidationError(
      'UPDATE_INCOMPATIBLE_SERVICE',
      `${field} version ${normalized} is outside the update package range ${range.min}-${range.max}.`
    )
  }
}

async function assertUpdateSignature(
  manifest: UpdateManifest,
  manifestSha256: string,
  trust: UpdateTrustVerifier | null | undefined
): Promise<{ readonly key_id: string; readonly algorithm: string; readonly verified: true }> {
  if (!trust || typeof trust.verify !== 'function' || typeof trust.keyId !== 'string' || !trust.keyId.trim()) {
    throw new UpdateValidationError(
      'UPDATE_SIGNING_UNAVAILABLE',
      'Update signing trust is not configured. An authorised release-signing authority and pinned public key are required before any update package can be validated or applied.'
    )
  }
  const signature = manifest.signature
  if (!signature) {
    throw new UpdateValidationError(
      'UPDATE_SIGNATURE_MISSING',
      'The update manifest is not signed. Unsigned update packages are refused.'
    )
  }
  if (signature.key_id !== trust.keyId) {
    throw new UpdateValidationError(
      'UPDATE_SIGNATURE_KEY_UNKNOWN',
      `The update was signed with key ${signature.key_id}, which is not the configured trusted key.`
    )
  }
  if (signature.algorithm !== 'ed25519') {
    throw new UpdateValidationError('UPDATE_SIGNATURE_INVALID', 'Only Ed25519 update signatures are supported.')
  }
  let verified = false
  try {
    verified = await trust.verify({ manifest_sha256: updateSigningPayloadSha256(manifest), manifest, signature })
  } catch {
    verified = false
  }
  if (verified !== true) {
    throw new UpdateValidationError(
      'UPDATE_SIGNATURE_INVALID',
      'The update manifest signature did not verify against the trusted release key.'
    )
  }
  return { key_id: signature.key_id, algorithm: signature.algorithm, verified: true }
}

export async function validateUpdatePackage(options: UpdateValidationOptions): Promise<UpdateValidationReport> {
  const packageRoot = path.resolve(options.packageRoot)
  const { manifest, sha256: manifestSha256 } = await readUpdateManifest(options.manifestPath)
  const signature = await assertUpdateSignature(manifest, manifestSha256, options.trust)
  assertUpgradeVersion(manifest.package.version, options.installedVersion)
  assertRange(options.currentSchemaVersion, manifest.compatibility.schema, 'Local schema')
  assertRange(options.currentContractVersion, manifest.compatibility.contract, 'Bar contract')
  const currentService = options.currentServiceVersion ?? options.installedVersion
  assertVersionRange(currentService, manifest.compatibility.service, 'Service')

  const artifacts: UpdateArtifact[] = []
  for (const artifact of manifest.files) {
    await assertArtifactFile(packageRoot, artifact)
    artifacts.push(artifact)
  }

  const diskDirectory = path.resolve(options.diskDir ?? packageRoot)
  const diskStats = await stat(diskDirectory).catch(() => null)
  if (!diskStats || !diskStats.isDirectory()) {
    throw new UpdateValidationError('UPDATE_STAGING_INVALID', `The disk-space probe directory does not exist: ${diskDirectory}`)
  }
  const required = requiredDiskBytes(manifest, options.extraFreeBytes ?? 0)
  const statfsFn = options.statfsFn ?? defaultDiskSpaceProbe
  await assertDiskSpace(required, diskDirectory, statfsFn)
  const available = await availableDiskBytes(diskDirectory, statfsFn)

  return {
    ok: true,
    status: 'validated',
    generated_at: new Date().toISOString(),
    manifest_sha256: manifestSha256,
    signature,
    package: {
      name: manifest.package.name,
      version: manifest.package.version,
      installed_version: options.installedVersion
    },
    compatibility: {
      schema: { ...manifest.compatibility.schema, current: options.currentSchemaVersion },
      contract: { ...manifest.compatibility.contract, current: options.currentContractVersion },
      service: { ...manifest.compatibility.service, current: `${parseVersion(currentService).major}.${parseVersion(currentService).minor}.${parseVersion(currentService).patch}` }
    },
    files: artifacts,
    disk: {
      required_bytes: required.toString(),
      available_bytes: available.toString(),
      directory: diskDirectory
    },
    checks: [
      'manifest_format_and_fields',
      'manifest_signature_trusted',
      'version_is_strictly_newer',
      'schema_contract_service_compatibility',
      'artifact_paths_are_local_and_relative',
      'artifact_sha256_and_size',
      'required_disk_space'
    ]
  }
}

function assertInside(parent: string, candidate: string, field: string): void {
  const root = path.resolve(parent)
  const target = path.resolve(candidate)
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new UpdateValidationError('UPDATE_TARGET_INVALID', `${field} must remain inside ${root}.`)
  }
}

function isInside(parent: string, candidate: string): boolean {
  const root = path.resolve(parent)
  const target = path.resolve(candidate)
  return target === root || target.startsWith(`${root}${path.sep}`)
}

function targetPathFor(installDir: string, artifact: UpdateArtifact): string {
  const target = path.resolve(installDir, ...artifact.target.split('/'))
  assertInside(installDir, target, `files target ${artifact.target}`)
  return target
}

async function syncFile(filePath: string): Promise<void> {
  const file = await open(filePath, 'r+')
  try {
    await file.sync()
  } finally {
    await file.close()
  }
}

async function writeFileAtomicFrom(sourcePath: string, targetPath: string, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  try {
    await copyFile(sourcePath, tempPath)
    await syncFile(tempPath)
    await chmod(tempPath, mode).catch(() => {})
    await rename(tempPath, targetPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

async function restoreFromRollback(entry: StageEntry): Promise<void> {
  if (!entry.existed || !entry.rollbackPath) {
    await rm(entry.targetPath, { force: true })
    return
  }
  await writeFileAtomicFrom(entry.rollbackPath, entry.targetPath)
  if (entry.rollbackSha256) {
    const restored = await hashFile(entry.targetPath)
    if (restored !== entry.rollbackSha256) {
      throw new UpdateValidationError(
        'UPDATE_ROLLBACK_FAILED',
        `Rollback of ${entry.artifact.target} did not restore the original bytes.`
      )
    }
  }
}

export async function applyStagedUpdate(options: UpdateApplyOptions): Promise<UpdateApplyReport> {
  const installDir = path.resolve(options.installDir)
  const stagingParent = path.resolve(options.stagingDir)
  const installStats = await stat(installDir).catch(() => null)
  if (!installStats || !installStats.isDirectory()) {
    throw new UpdateValidationError('UPDATE_INSTALL_INVALID', `The install directory does not exist: ${installDir}`)
  }
  await mkdir(stagingParent, { recursive: true })

  const dataDirs = (options.dataDirs ?? [
    path.join(installDir, 'data'),
    path.join(installDir, 'backups')
  ]).map((directory) => path.resolve(directory))
  for (const dataDir of dataDirs) {
    if (dataDir === installDir || isInside(dataDir, installDir)) {
      throw new UpdateValidationError('UPDATE_DATA_DIR_CONFLICT', `The protected data directory would contain the install directory: ${dataDir}`)
    }
  }

  const validation = await validateUpdatePackage({ ...options, diskDir: stagingParent })
  const manifest = parseUpdateManifest(JSON.parse((await readFile(options.manifestPath, 'utf8'))))
  const stageRoot = await mkdtemp(path.join(stagingParent, `update-${safeVersion(manifest.package.version)}-`))
  const entries: StageEntry[] = []
  const promoted: StageEntry[] = []
  let preserveStaging = false
  try {
    for (const [index, artifact] of manifest.files.entries()) {
      const targetPath = targetPathFor(installDir, artifact)
      for (const dataDir of dataDirs) {
        if (isInside(dataDir, targetPath)) {
          throw new UpdateValidationError('UPDATE_DATA_DIR_CONFLICT', `Update target would overwrite protected data: ${artifact.target}`)
        }
      }
      const sourcePath = path.resolve(options.packageRoot, ...artifact.source.split('/'))
      const stagedPath = path.join(stageRoot, 'new', `${index}`)
      await mkdir(path.dirname(stagedPath), { recursive: true })
      await copyFile(sourcePath, stagedPath)
      await chmod(stagedPath, artifact.mode ?? 0o600).catch(() => {})
      const stagedHash = await hashFile(stagedPath)
      if (stagedHash !== artifact.sha256) {
        throw new UpdateValidationError('UPDATE_ARTIFACT_HASH_MISMATCH', `Staged artifact did not verify: ${artifact.source}`)
      }
      const targetStats = await lstat(targetPath).catch(() => null)
      if (targetStats?.isDirectory() || targetStats?.isSymbolicLink()) {
        throw new UpdateValidationError('UPDATE_TARGET_INVALID', `Update target is not a regular file: ${artifact.target}`)
      }
      let rollbackPath: string | null = null
      let rollbackSha256: string | null = null
      if (targetStats?.isFile()) {
        rollbackPath = path.join(stageRoot, 'rollback', `${index}`)
        await mkdir(path.dirname(rollbackPath), { recursive: true })
        await copyFile(targetPath, rollbackPath)
        await syncFile(rollbackPath)
        rollbackSha256 = await hashFile(rollbackPath)
      }
      entries.push({
        artifact,
        targetPath,
        stagedPath,
        rollbackPath,
        rollbackSha256,
        existed: Boolean(targetStats?.isFile())
      })
    }

    const checkpoint = await options.checkpoint({
      version: manifest.package.version,
      manifestPath: path.resolve(options.manifestPath),
      manifestSha256: validation.manifest_sha256,
      incomingFiles: entries.map((entry) => entry.targetPath)
    })
    if (!checkpoint || typeof checkpoint.path !== 'string' || !checkpoint.path.trim()) {
      throw new UpdateValidationError('UPDATE_CHECKPOINT_REQUIRED', 'Applying an update requires a successful backup checkpoint.')
    }
    const checkpointPath = path.resolve(checkpoint.path)
    if (isInside(stageRoot, checkpointPath)) {
      throw new UpdateValidationError(
        'UPDATE_CHECKPOINT_LOCATION_INVALID',
        'The checkpoint must not be written inside the temporary staging directory because staging is deleted after the update.'
      )
    }
    const checkpointStats = await lstat(checkpointPath).catch(() => null)
    if (!checkpointStats || checkpointStats.isSymbolicLink() || !checkpointStats.isFile()) {
      throw new UpdateValidationError(
        'UPDATE_CHECKPOINT_MISSING',
        `The checkpoint reported at ${checkpointPath} does not exist as a regular file. Refusing to promote update files.`
      )
    }
    if (checkpointStats.size <= 0) {
      throw new UpdateValidationError('UPDATE_CHECKPOINT_EMPTY', `The checkpoint at ${checkpointPath} is empty.`)
    }
    const checkpointSha256 = await hashFile(checkpointPath)
    if (checkpoint.sha256 !== undefined) {
      if (typeof checkpoint.sha256 !== 'string' || !SHA256_RE.test(checkpoint.sha256.toLowerCase())) {
        throw new UpdateValidationError('UPDATE_CHECKPOINT_INVALID', 'The checkpoint SHA-256 must be a hexadecimal SHA-256 digest.')
      }
      if (checkpointSha256 !== checkpoint.sha256.toLowerCase()) {
        throw new UpdateValidationError(
          'UPDATE_CHECKPOINT_MISMATCH',
          `The checkpoint at ${checkpointPath} does not match the reported SHA-256. Refusing to promote update files.`
        )
      }
    }

    try {
      for (const entry of entries) {
        await writeFileAtomicFrom(entry.stagedPath, entry.targetPath, entry.artifact.mode ?? 0o600)
        const promotedHash = await hashFile(entry.targetPath)
        if (promotedHash !== entry.artifact.sha256) {
          throw new UpdateValidationError(
            'UPDATE_APPLY_FAILED',
            `Promoted file ${entry.artifact.target} did not match its signed artifact hash.`
          )
        }
        promoted.push(entry)
      }
    } catch (error) {
      const rollbackErrors: string[] = []
      for (const entry of [...promoted].reverse()) {
        try {
          await restoreFromRollback(entry)
        } catch (rollbackError) {
          rollbackErrors.push(`${entry.artifact.target}: ${rollbackError instanceof Error ? rollbackError.message : 'rollback failed'}`)
        }
      }
      if (rollbackErrors.length > 0) {
        preserveStaging = true
        throw new UpdateValidationError(
          'UPDATE_ROLLBACK_FAILED',
          `The update failed and rollback was incomplete. Preserve the checkpoint at ${checkpointPath} and the staging area at ${stageRoot}. ${rollbackErrors.join('; ')}`
        )
      }
      throw new UpdateValidationError(
        'UPDATE_APPLY_FAILED',
        `The update failed and was rolled back from checkpoint ${checkpointPath}: ${error instanceof Error ? error.message : 'unknown error'}`
      )
    }

    return {
      ok: true,
      status: 'applied',
      generated_at: new Date().toISOString(),
      version: manifest.package.version,
      installed_version: options.installedVersion,
      applied_files: entries.map((entry) => entry.artifact.target),
      checkpoint_path: checkpointPath,
      checkpoint_sha256: checkpointSha256,
      signature_key_id: validation.signature.key_id,
      staging_dir: stagingParent,
      staging_cleaned: true,
      data_dirs_preserved: dataDirs
    }
  } finally {
    if (!preserveStaging) await rm(stageRoot, { recursive: true, force: true }).catch(() => {})
  }
}

function safeVersion(version: string): string {
  return version.replace(/[^0-9A-Za-z._-]/g, '-')
}

export async function planUninstall(options: UninstallPlanOptions): Promise<UninstallPlan> {
  if (options.purgeData) {
    throw new UpdateValidationError('UNINSTALL_DATA_PURGE_REFUSED', 'Uninstall never purges trading data, backups or recovery material.')
  }
  const installDir = path.resolve(options.installDir)
  const dataDirs = (options.dataDirs ?? [
    path.join(installDir, 'data'),
    path.join(installDir, 'backups')
  ]).map((directory) => path.resolve(directory))
  const files: string[] = []
  const missing: string[] = []
  for (const managed of options.managedFiles) {
    const relative = assertSafeRelativePath(managed, 'managedFiles')
    const target = path.resolve(installDir, ...relative.split('/'))
    assertInside(installDir, target, `managed file ${relative}`)
    if (dataDirs.some((dataDir) => isInside(dataDir, target))) {
      throw new UpdateValidationError('UNINSTALL_DATA_DIR_CONFLICT', `Uninstall cannot remove protected data: ${relative}`)
    }
    const stats = await lstat(target).catch(() => null)
    if (stats?.isFile()) files.push(relative)
    else missing.push(relative)
  }
  return {
    ok: true,
    install_dir: installDir,
    files,
    missing,
    data_dirs_preserved: dataDirs,
    data_preserved: true
  }
}

export async function executeUninstall(options: UninstallPlanOptions): Promise<UninstallReport> {
  const plan = await planUninstall(options)
  const removed: string[] = []
  const errors: string[] = []
  for (const relative of plan.files) {
    const target = path.resolve(plan.install_dir, ...relative.split('/'))
    try {
      await rm(target, { force: true })
      removed.push(relative)
    } catch (error) {
      errors.push(`${relative}: ${error instanceof Error ? error.message : 'removal failed'}`)
    }
  }
  return {
    ...plan,
    status: 'uninstalled',
    removed,
    errors
  }
}

export async function updateManifestFileSha256(manifestPath: string): Promise<string> {
  return hashFile(manifestPath)
}
