import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { randomUUID } from 'crypto'
import { state } from '../state.js'

// Bar trading recovery packages. This module snapshots the local stores that
// prove what a Bar till accepted while offline (queues, interrupted
// generations, submit intents, journals, provisional sales/tabs/shifts/cash
// records) plus the reconstructible catalogue/context an offline till needs.
// It never touches server-authoritative financial truth and never restores
// authorization leases or credentials.
//
// Security posture:
// - packages are always encrypted with AES-256-GCM and scrypt (the same
//   reviewed primitives and parameters the Starter package uses); the
//   passphrase is owner-controlled and is never stored beside the archive;
// - secret-bearing stores are withheld (digest disclosure only);
// - every package is verified before it is reported as usable;
// - restore is staged into an isolated directory and requires an explicit,
//   authorized activation that refuses to overwrite newer unresolved work.

const SNAPSHOT_SCHEMA = 'tsa-bonno-bar-trading-snapshot/v1'
const PACKAGE_SCHEMA = 'tsa-bonno-bar-trading-package/v1'
const SUPPORTED_PACKAGE_SCHEMAS = new Set([PACKAGE_SCHEMA])
const PACKAGE_EXTENSION = '.tbtrading'
const PACKAGE_FILE_PREFIX = 'tsa-bonno-bar-trading-'
const STAGING_DIR_PREFIX = 'bar-trading-restore-'
const PROGRESS_FILE = 'stage-progress.json'
const REPORT_FILE = 'restore-report.json'
const ACTIVATION_REPORT_FILE = 'activation-report.json'
const STATUS_FILE = 'bar-trading-status.json'

const MAX_STORE_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024
const STABLE_READ_ATTEMPTS = 3
const STALE_TEMP_MS = 24 * 60 * 60 * 1000
const PASS_MIN_LENGTH = 12
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 }

// Field names that must never appear in a package, even inside a store that is
// otherwise included. Matching is exact and case-insensitive on the key name.
const PROTECTED_FIELD_NAMES = new Set([
  'password', 'password_hash', 'pin', 'pin_hash', 'access_token',
  'refresh_token', 'service_role_key', 'secret_key', 'private_key',
  'lodge_mesh_secret', 'online_confirmation_token', 'api_key', 'totp_secret'
])

const RECOVERY_LIMITATIONS = Object.freeze([
  'This archive is a local till snapshot, not server truth. Server-confirmed financial records are authoritative and are never overwritten by a restore.',
  'Device identity is never archived or cloned. Operations bound to the origin device cannot be replayed under the original device identity from a replacement machine without an authorized support-led rebinding.',
  'The offline entitlement lease is never archived or restored, so a replacement till must verify entitlement online before offline operation.',
  'Interrupted generations (crash-recovery .tmp files) are preserved for review but are never auto-promoted into the active profile during activation.',
  'Renderer-owned durable state (basket drafts, hold intents, retry keys) is included only when the renderer-state seam supplied it; otherwise the archive is explicitly incomplete.',
  'Activation refuses to overwrite unresolved local work created after the snapshot; snapshot the live profile first and reconcile with support.'
])

// ─── Store inventory ─────────────────────────────────────────────────────────
// Roles: 'unresolved' = provisional evidence of work that is not yet
// server-confirmed and must never be pruned while unresolved;
// 'provisional' = local accepted rows awaiting or following replay;
// 'mirror' = server cache mirror; 'reconstructible' = derivable context.
// kind: 'json' | 'json-map' (top-level object keyed by identity) | 'jsonl' |
// 'tmp-generation' (interrupted generation, never auto-promoted on restore).

export const BAR_TRADING_STORE_SPECS = Object.freeze([
  { key: 'sync-queue', file: 'sync-queue.json', kind: 'json', role: 'unresolved', unresolvedBearing: true, description: 'Pending replay queue (accepted locally, not server-confirmed).' },
  { key: 'sync-queue-generation', file: 'sync-queue.json.tmp', kind: 'tmp-generation', role: 'unresolved', unresolvedBearing: true, description: 'Interrupted generation of the pending replay queue.' },
  { key: 'sync-failed', file: 'sync-failed.json', kind: 'json', role: 'unresolved', unresolvedBearing: true, description: 'Dead-lettered queue rows awaiting review or retry.' },
  { key: 'sync-failed-generation', file: 'sync-failed.json.tmp', kind: 'tmp-generation', role: 'unresolved', unresolvedBearing: true, description: 'Interrupted generation of the dead-letter queue.' },
  { key: 'offline-operation-log', file: 'offline-operation-log.jsonl', kind: 'jsonl', role: 'unresolved', unresolvedBearing: true, description: 'Append-only operation journal (queued/replayed/refused evidence).' },
  { key: 'pos-submit-attempts', file: 'pos-submit-attempts.json', kind: 'json-map', role: 'unresolved', unresolvedBearing: true, description: 'POS submit intents: the retained sale-submission recovery record.' },
  { key: 'pos-submit-blocked', file: 'pos-submit-attempts.blocked.json', kind: 'json', role: 'unresolved', unresolvedBearing: true, description: 'Submit-journal blocked marker (corruption latch).' },
  { key: 'pos-tickets', file: 'pos-tickets.json', kind: 'json', role: 'provisional', description: 'Local open tickets / held baskets mirrored from the renderer.' },
  { key: 'pos-order-items', file: 'pos-order-items.json', kind: 'json', role: 'provisional', description: 'Line items for local POS orders.' },
  { key: 'pos-offline-receipt-counters', file: 'pos-offline-receipt-counters.json', kind: 'json', role: 'provisional', description: 'Provisional offline receipt counters (display sequencing).' },
  { key: 'pos-orders', file: 'pos-orders.json', kind: 'json', role: 'provisional', description: 'Local POS orders (provisional until replay, then server mirror).' },
  { key: 'pos-void-history', file: 'pos-void-history.json', kind: 'json', role: 'provisional', description: 'Void/refund records.' },
  { key: 'pos-tabs', file: 'pos-tabs.json', kind: 'json', role: 'provisional', description: 'Open/closed tabs and recovery envelopes.' },
  { key: 'pos-shifts', file: 'pos-shifts.json', kind: 'json', role: 'provisional', description: 'Shift records and drawer/outlet ownership.' },
  { key: 'pos-cashups', file: 'pos-cashups.json', kind: 'json', role: 'provisional', description: 'Local cash-up records.' },
  { key: 'pos-cashup-submissions', file: 'pos-cashup-submissions.json', kind: 'json', role: 'provisional', description: 'Cash-up submissions keyed by idempotency key.' },
  { key: 'pos-cash-movements', file: 'pos-cash-movements.json', kind: 'json', role: 'provisional', description: 'Drawer cash movements.' },
  { key: 'pos-cash-counts', file: 'pos-cash-counts.json', kind: 'json', role: 'provisional', description: 'Drawer cash counts.' },
  { key: 'pos-drawer-periods', file: 'pos-drawer-periods.json', kind: 'json', role: 'provisional', description: 'Drawer periods.' },
  { key: 'pos-audit-log', file: 'pos-audit-log.json', kind: 'json', role: 'provisional', description: 'Local POS audit/activity log.' },
  { key: 'pos-menu-items', file: 'pos-menu-items.json', kind: 'json', role: 'reconstructible', description: 'Menu catalogue with prices.' },
  { key: 'pos-menu-verification', file: 'pos-menu-verification.json', kind: 'json', role: 'reconstructible', description: 'Menu completeness verification state.' },
  { key: 'pos-modifier-groups', file: 'pos-modifier-groups.json', kind: 'json', role: 'reconstructible', description: 'Modifier groups.' },
  { key: 'pos-modifier-groups-meta', file: 'pos-modifier-groups-meta.json', kind: 'json', role: 'reconstructible', description: 'Modifier fetch metadata.' },
  { key: 'pos-promotions', file: 'pos-promotions.json', kind: 'json', role: 'reconstructible', description: 'Promotions.' },
  { key: 'pos-catalog-snapshots', file: 'pos-catalog-snapshots.json', kind: 'json', role: 'reconstructible', description: 'Published catalogue snapshots.' },
  { key: 'inventory-items', file: 'inventory-items.json', kind: 'json', role: 'reconstructible', description: 'Stock projections used by POS depletion checks.' },
  { key: 'outlets', file: 'outlets.json', kind: 'json', role: 'reconstructible', description: 'Outlet definitions.' },
  { key: 'settings', file: 'settings.json', kind: 'json', role: 'reconstructible', description: 'Lodge profile (secrets scrubbed).' },
  { key: 'pos-staff', file: 'pos-staff.json', kind: 'json', role: 'reconstructible', description: 'POS staff/operator rows.' },
  { key: 'pos-stations', file: 'pos-stations.json', kind: 'json', role: 'reconstructible', description: 'Kitchen/service stations.' },
  { key: 'pos-tables', file: 'pos-tables.json', kind: 'json', role: 'reconstructible', description: 'Table definitions.' },
  { key: 'pos-floor-layout', file: 'pos-floor-layout.json', kind: 'json', role: 'reconstructible', description: 'Floor plan.' },
  { key: 'pos-hardware-settings', file: 'pos-hardware-settings.json', kind: 'json', role: 'reconstructible', description: 'Printer/drawer/scanner configuration.' },
  { key: 'pos-checklists', file: 'pos-checklists.json', kind: 'json', role: 'reconstructible', description: 'POS checklists.' },
  { key: 'bar-checklist-templates', file: 'bar-checklist-templates.json', kind: 'json', role: 'reconstructible', description: 'Bar checklist templates.' },
  { key: 'pos-customer-display', file: 'pos-customer-display.json', kind: 'json', role: 'reconstructible', description: 'Customer display settings.' }
])

// Withheld stores: never packaged. A digest/count disclosure is recorded so
// the archive discloses that they existed without leaking or restoring them.
export const BAR_TRADING_WITHHELD_SPECS = Object.freeze([
  { key: 'users', file: 'users.json', classification: 'secret-bearing', reason: 'Staff accounts include password hashes.' },
  { key: 'trial-status', file: 'trial_status.json', classification: 'authorization-lease', reason: 'Offline entitlement lease must not be restored or extended by an archive.' },
  { key: 'automation-credential', file: 'automation-credential.json', classification: 'machine-bound-secret', reason: 'OS-safeStorage credential is machine-bound and stays with its machine.' }
])

// ─── Shared primitives ───────────────────────────────────────────────────────

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry) ?? 'null').join(',')}]`
  const keys = Object.keys(value).sort()
  const entries = []
  for (const key of keys) {
    const serialized = stableStringify(value[key])
    if (serialized !== undefined) entries.push(`${JSON.stringify(key)}:${serialized}`)
  }
  return `{${entries.join(',')}}`
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function fsyncFile(filePath) {
  try {
    const handle = fs.openSync(filePath, 'r+')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
}

function fsyncDir(dirPath) {
  try {
    const handle = fs.openSync(dirPath, 'r')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function resolveContainedPath(root, ...segments) {
  const resolvedRoot = path.resolve(String(root))
  const candidate = path.resolve(resolvedRoot, ...segments.map((segment) => String(segment)))
  const relative = path.relative(resolvedRoot, candidate)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Bar trading recovery path is outside the allowed root.')
  }
  return candidate
}

function writeBytesAtomic(filePath, bytes) {
  const target = path.resolve(String(filePath))
  const dir = path.dirname(target)
  ensureDir(dir)
  const tempPath = path.join(dir, `${path.basename(target)}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(tempPath, bytes, { flag: 'wx' })
    fsyncFile(tempPath)
    fs.renameSync(tempPath, target)
    fsyncDir(dir)
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch {}
    throw new Error(`Bar trading recovery file could not be written. Choose another destination and try again. (${error?.code || 'write_error'})`)
  }
}

function writeJsonAtomic(filePath, value) {
  writeBytesAtomic(filePath, Buffer.from(canonicalJson(value), 'utf8'))
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch { return fallback }
}

function requirePassphrase(passphrase) {
  const value = String(passphrase || '')
  if (value.length < PASS_MIN_LENGTH) throw new Error(`Use an encryption passphrase with at least ${PASS_MIN_LENGTH} characters.`)
  if (value.length > 1024) throw new Error('The encryption passphrase is too long.')
  return value
}

function resolveCacheDir(options = {}) {
  const dir = String(options.cacheDir || state.cacheDir || '').trim()
  if (!dir) throw new Error('A profile cache directory is required for Bar trading recovery.')
  return path.resolve(dir)
}

function resolveLodgeId(options = {}) {
  const lodgeId = String(options.lodgeId || state.lodgeId || '').trim()
  if (!lodgeId) throw new Error('An active lodge profile is required for Bar trading recovery.')
  return lodgeId
}

function safeLodgeSlug(lodgeId) {
  return String(lodgeId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24)
}

function assertOperationId(operationId) {
  const value = String(operationId || '').trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error('A stable recovery operation ID (UUID v4) is required.')
  }
  return value
}

// ─── Secret scrubbing ────────────────────────────────────────────────────────

function scrubProtectedFields(value, counters = { removed: 0, fields: {} }) {
  if (Array.isArray(value)) return value.map((entry) => scrubProtectedFields(entry, counters))
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (PROTECTED_FIELD_NAMES.has(String(key).toLowerCase())) {
      counters.removed += 1
      counters.fields[key] = (counters.fields[key] || 0) + 1
      continue
    }
    out[key] = scrubProtectedFields(entry, counters)
  }
  return out
}

function scrubStoreContent(spec, content) {
  const counters = { removed: 0, fields: {} }
  if (spec.kind === 'jsonl') {
    const lines = String(content).split('\n').filter((line) => line.trim().length > 0)
    const scrubbed = lines.map((line) => {
      try { return JSON.stringify(scrubProtectedFields(JSON.parse(line), counters)) } catch { return line }
    })
    return { content: scrubbed.length ? `${scrubbed.join('\n')}\n` : '', scrubbedFields: counters }
  }
  try {
    return { content: canonicalJson(scrubProtectedFields(JSON.parse(content), counters)), scrubbedFields: counters }
  } catch {
    return { content, scrubbedFields: counters }
  }
}

// ─── Stable read protocol ────────────────────────────────────────────────────
// Each store is read with bounded stable-read retries: read bytes, re-stat, and
// require byte-identical consecutive reads with unchanged size/mtime. A store
// that cannot be read stably is reported as drift and fails the snapshot closed
// (the caller may explicitly allow incomplete snapshots for diagnostics only).
// Reads are non-blocking and never take a write lock, so an active till keeps
// selling; the protocol is a defensible version check, not a transaction.

function readStoreStable(filePath, spec) {
  if (!fs.existsSync(filePath)) return { present: false }
  let lastError = null
  for (let attempt = 1; attempt <= STABLE_READ_ATTEMPTS; attempt += 1) {
    try {
      const before = fs.statSync(filePath)
      if (!before.isFile()) return { present: false, error: 'not_a_file' }
      if (before.size > spec.maxBytes || before.size > MAX_STORE_BYTES) {
        return { present: true, tooLarge: true, bytes: before.size }
      }
      const first = fs.readFileSync(filePath)
      const afterFirst = fs.statSync(filePath)
      const second = fs.readFileSync(filePath)
      const afterSecond = fs.statSync(filePath)
      const stable = first.length === second.length &&
        Buffer.compare(first, second) === 0 &&
        before.size === afterFirst.size && afterFirst.size === afterSecond.size &&
        before.mtimeMs === afterFirst.mtimeMs && afterFirst.mtimeMs === afterSecond.mtimeMs
      if (stable) {
        return { present: true, bytes: first.length, content: first.toString('utf8'), sha256: sha256(first), attempts: attempt }
      }
      lastError = `drift on attempt ${attempt}`
    } catch (error) {
      lastError = error?.message || 'read failed'
    }
  }
  return { present: true, drift: true, error: lastError }
}

function parseIdentityRows(spec, content) {
  // Returns [{ identity, hash }] for reconciliation. Unknown shapes fall back
  // to line/index identities so drift is still detectable, never silently lost.
  const rows = []
  const hashOf = (value) => sha256(stableStringify(value))
  if (spec.kind === 'jsonl') {
    const lines = String(content).split('\n').filter((line) => line.trim().length > 0)
    lines.forEach((line, index) => {
      try {
        const parsed = JSON.parse(line)
        rows.push({ identity: pickIdentity(parsed) || `line-${index}`, hash: hashOf(parsed) })
      } catch {
        rows.push({ identity: `line-${index}`, hash: sha256(line) })
      }
    })
    return rows
  }
  let parsed
  try { parsed = JSON.parse(content) } catch { return rows }
  if (spec.kind === 'json-map' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed)) rows.push({ identity: String(key), hash: hashOf(value) })
    return rows
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
  list.forEach((row, index) => {
    rows.push({ identity: pickIdentity(row) || `index-${index}`, hash: hashOf(row) })
  })
  return rows
}

function pickIdentity(row) {
  if (!row || typeof row !== 'object') return null
  for (const field of ['_queue_id', 'idempotency_key', 'operation_id', 'op_id', 'id', 'key', 'submit_intent_id', 'intent_id']) {
    const value = row[field]
    if (value !== undefined && value !== null && String(value).length > 0) return String(value)
  }
  return null
}

function isUnresolvedSubmitAttempt(entry) {
  if (!entry || typeof entry !== 'object') return true
  if (entry.manualRetryOnly === true) return true
  const status = String(entry.status || '').toLowerCase()
  return !['confirmed', 'committed', 'completed', 'verified'].includes(status)
}

function buildUnresolvedSummary(storeOutcomes) {
  const byStore = {}
  const identitySet = new Set()
  for (const [key, outcome] of Object.entries(storeOutcomes)) {
    if (!outcome?.spec?.unresolvedBearing || !outcome.present || outcome.content === undefined) continue
    let identities = []
    if (key === 'pos-submit-attempts') {
      try {
        const parsed = JSON.parse(outcome.content)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          identities = Object.entries(parsed).filter(([, value]) => isUnresolvedSubmitAttempt(value)).map(([id]) => String(id))
        }
      } catch {}
    } else if (key === 'pos-submit-blocked') {
      identities = ['blocked-marker']
    } else if (key === 'offline-operation-log') {
      const lines = String(outcome.content).split('\n').filter((line) => line.trim().length > 0)
      identities = lines.length > 0 ? [`journal-events:${lines.length}`] : []
    } else {
      identities = parseIdentityRows(outcome.spec, outcome.content).map((row) => row.identity)
    }
    for (const identity of identities) identitySet.add(`${key}:${identity}`)
    byStore[key] = { count: identities.length, identities_sha256: sha256(stableStringify([...identities].sort())) }
  }
  const allIdentities = [...identitySet].sort()
  return {
    count: allIdentities.length,
    digest: sha256(stableStringify(allIdentities)),
    identities: allIdentities,
    by_store: byStore
  }
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export function buildBarTradingSnapshot(options = {}) {
  const cacheDir = resolveCacheDir(options)
  const lodgeId = resolveLodgeId(options)
  const capturedAt = String(options.now || new Date().toISOString())
  const storeOutcomes = {}
  const stores = {}
  const missing = []
  const drift = []
  const warnings = []
  let totalBytes = 0

  for (const spec of BAR_TRADING_STORE_SPECS) {
    const filePath = path.join(cacheDir, spec.file)
    const outcome = readStoreStable(filePath, spec)
    if (!outcome.present) {
      missing.push(spec.key)
      storeOutcomes[spec.key] = { spec, present: false }
      continue
    }
    if (outcome.tooLarge) {
      drift.push(spec.key)
      warnings.push(`${spec.file} exceeds the per-store capture ceiling and was not captured.`)
      storeOutcomes[spec.key] = { spec, present: true, tooLarge: true, bytes: outcome.bytes }
      continue
    }
    if (outcome.drift || outcome.error) {
      drift.push(spec.key)
      warnings.push(`${spec.file} changed while it was being captured (${outcome.error || 'drift'}). The snapshot is not coherent.`)
      storeOutcomes[spec.key] = { spec, present: true, drift: true, error: outcome.error }
      continue
    }
    const scrubbed = scrubStoreContent(spec, outcome.content)
    if (scrubbed.scrubbedFields.removed > 0) {
      warnings.push(`${spec.file}: ${scrubbed.scrubbedFields.removed} protected field(s) were scrubbed from the archive.`)
    }
    const contentBytes = Buffer.byteLength(scrubbed.content, 'utf8')
    totalBytes += contentBytes
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Bar trading snapshot exceeds the total capture ceiling. Snapshot after archiving older generations.')
    stores[spec.key] = {
      file: spec.file,
      kind: spec.kind,
      role: spec.role,
      unresolved_bearing: spec.unresolvedBearing === true,
      description: spec.description,
      bytes: contentBytes,
      source_bytes: outcome.bytes,
      sha256: sha256(Buffer.from(scrubbed.content, 'utf8')),
      scrubbed_fields: scrubbed.scrubbedFields.removed,
      read_attempts: outcome.attempts || 1,
      content: scrubbed.content
    }
    storeOutcomes[spec.key] = { spec, present: true, content: scrubbed.content }
  }

  // Withheld stores: digest disclosure only. Content is read, hashed, and
  // discarded so an operator can see the evidence existed without it being
  // packaged.
  const withheld = {}
  for (const spec of BAR_TRADING_WITHHELD_SPECS) {
    const filePath = path.join(cacheDir, spec.file)
    if (!fs.existsSync(filePath)) { withheld[spec.key] = { present: false }; continue }
    try {
      const bytes = fs.readFileSync(filePath)
      withheld[spec.key] = {
        present: true,
        file: spec.file,
        classification: spec.classification,
        reason: spec.reason,
        bytes: bytes.length,
        sha256: sha256(bytes)
      }
    } catch {
      withheld[spec.key] = { present: true, file: spec.file, classification: spec.classification, reason: spec.reason, unreadable: true }
    }
  }

  const unresolved = buildUnresolvedSummary(storeOutcomes)

  // Renderer-owned durable state seam. When the caller explicitly states a
  // headless capture (expectRendererState === false) its absence is not a
  // warning; otherwise an absent seam marks the snapshot incomplete.
  const expectRendererState = options.expectRendererState !== false
  const rendererState = options.rendererState === undefined ? null : options.rendererState
  let rendererCaptured = false
  let rendererStore = null
  if (rendererState && typeof rendererState === 'object') {
    const scrubbed = scrubProtectedFields(rendererState)
    const content = canonicalJson(scrubbed)
    rendererStore = {
      file: 'renderer-durable-state.json',
      kind: 'json',
      role: 'unresolved',
      unresolved_bearing: true,
      description: 'Renderer-owned durable state (basket drafts, hold intents, pending operation keys).',
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: sha256(Buffer.from(content, 'utf8')),
      scrubbed_fields: 0,
      read_attempts: 1,
      content
    }
    rendererCaptured = true
  } else if (expectRendererState) {
    warnings.push('Renderer-owned durable state was not supplied to this snapshot; unsent basket drafts and hold intents are not covered.')
  }

  const complete = drift.length === 0 && warnings.every((warning) => !/changed while it was being captured/.test(warning)) && rendererCaptured === true
  const snapshotCore = {
    schema: SNAPSHOT_SCHEMA,
    lodge_id: lodgeId,
    captured_at: capturedAt,
    app_version: String(options.appVersion || 'unknown'),
    capture: {
      protocol: 'stable-read-v2',
      attempts: STABLE_READ_ATTEMPTS,
      cache_dir_name: path.basename(cacheDir),
      same_volume_copy_risk: null
    },
    complete,
    warnings,
    missing,
    drift,
    unresolved,
    withheld,
    stores,
    renderer_state: {
      captured: rendererCaptured,
      expected: expectRendererState,
      store: rendererStore ? 'renderer-durable-state.json' : null
    },
    recovery_limits: [...RECOVERY_LIMITATIONS]
  }
  if (rendererStore) snapshotCore.stores['renderer-durable-state'] = rendererStore
  return snapshotCore
}

// ─── Package create / verify ─────────────────────────────────────────────────

function packageInnerFiles(snapshot) {
  const manifest = {
    format: PACKAGE_SCHEMA,
    snapshot_schema: SNAPSHOT_SCHEMA,
    app_version: snapshot.app_version,
    generated_at: snapshot.captured_at,
    lodge_id: snapshot.lodge_id,
    complete: snapshot.complete === true,
    warnings: snapshot.warnings,
    missing: snapshot.missing,
    drift: snapshot.drift,
    unresolved: { count: snapshot.unresolved.count, digest: snapshot.unresolved.digest, by_store: snapshot.unresolved.by_store },
    withheld: Object.fromEntries(Object.entries(snapshot.withheld || {}).map(([key, entry]) => [key, entry.present ? { present: true, classification: entry.classification, bytes: entry.bytes, sha256: entry.sha256 } : { present: false }])),
    store_hashes: Object.fromEntries(Object.entries(snapshot.stores).map(([key, store]) => [key, store.sha256])),
    store_bytes: Object.fromEntries(Object.entries(snapshot.stores).map(([key, store]) => [key, store.bytes])),
    renderer_state_captured: snapshot.renderer_state?.captured === true,
    recovery_limits: snapshot.recovery_limits
  }
  const snapshotJson = canonicalJson(snapshot)
  const manifestJson = canonicalJson(manifest)
  const readme = buildReadme(snapshot)
  const checksums = {
    'snapshot.json': sha256(snapshotJson),
    'manifest.json': sha256(manifestJson),
    'README.txt': sha256(readme)
  }
  return { manifest, files: { 'snapshot.json': snapshotJson, 'manifest.json': manifestJson, 'README.txt': readme }, checksums }
}

function buildReadme(snapshot) {
  return [
    'TSA BONNO HOSPITALITYOS — BAR TRADING RECOVERY SNAPSHOT', '',
    'This .tbtrading file preserves the local till evidence needed to review and recover Bar trading:',
    'queues and interrupted generations, operation journals, submit intents, provisional sales, tabs,',
    'shifts, drawer/cash records, and the offline catalogue/context a till needs.', '',
    'It is NOT server truth. Server-confirmed financial records are authoritative. Restoring this',
    'archive never writes to Supabase and never overwrites newer unresolved work.', '',
    'Keep this file and its passphrase confidential and separate from each other. The passphrase is',
    'never stored inside the file. If the passphrase is lost, the archive cannot be recovered.', '',
    `Snapshot: ${snapshot.captured_at}  Lodge: ${snapshot.lodge_id}  Complete: ${snapshot.complete === true ? 'yes' : 'NO — see warnings'}`,
    `Unresolved operations recorded: ${snapshot.unresolved.count}`,
    ...snapshot.recovery_limits.map((limit) => `LIMIT: ${limit}`),
    ''
  ].join('\n')
}

function encodePackage(inner, options = {}) {
  const passphrase = requirePassphrase(options.passphrase)
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(passphrase, salt, 32, { ...SCRYPT_PARAMS, maxmem: 64 * 1024 * 1024 })
  const plaintext = zlib.gzipSync(Buffer.from(JSON.stringify(inner), 'utf8'))
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    format: PACKAGE_SCHEMA,
    encrypted: true,
    created_at: inner.manifest.generated_at,
    lodge_id: inner.manifest.lodge_id,
    app_version: inner.manifest.app_version,
    encryption: {
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      kdf_params: { ...SCRYPT_PARAMS },
      compression: 'gzip',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      auth_tag: cipher.getAuthTag().toString('base64'),
      ciphertext_sha256: sha256(ciphertext)
    },
    ciphertext: ciphertext.toString('base64')
  }
}

function decodePackage(buffer, passphrase) {
  let envelope
  try {
    envelope = JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || ''))
  } catch {
    throw new Error('This file is not a valid Tsa Bonno Bar trading recovery package.')
  }
  if (!SUPPORTED_PACKAGE_SCHEMAS.has(envelope?.format)) throw new Error('Unsupported or outdated Bar trading recovery package format.')
  if (envelope.encrypted !== true) throw new Error('Bar trading recovery packages must be encrypted.')
  if (envelope?.encryption?.algorithm !== 'aes-256-gcm' || envelope?.encryption?.kdf !== 'scrypt') throw new Error('Unsupported backup encryption settings.')
  const params = envelope?.encryption?.kdf_params || {}
  if (params.N !== SCRYPT_PARAMS.N || params.r !== SCRYPT_PARAMS.r || params.p !== SCRYPT_PARAMS.p) throw new Error('Unsupported backup key-derivation settings.')
  if (envelope?.encryption?.compression !== 'gzip') throw new Error('Unsupported backup compression settings.')
  const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64')
  if (!ciphertext.length || sha256(ciphertext) !== envelope?.encryption?.ciphertext_sha256) {
    throw new Error('Backup verification failed: the encrypted package was changed or is incomplete.')
  }
  let plaintext
  try {
    const key = crypto.scryptSync(requirePassphrase(passphrase), Buffer.from(String(envelope.encryption.salt || ''), 'base64'), 32, { ...SCRYPT_PARAMS, maxmem: 64 * 1024 * 1024 })
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(envelope.encryption.iv || ''), 'base64'))
    decipher.setAuthTag(Buffer.from(String(envelope.encryption.auth_tag || ''), 'base64'))
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new Error('Backup could not be decrypted. Check the passphrase and try again.')
  }
  let inner
  try {
    inner = JSON.parse(zlib.gunzipSync(plaintext).toString('utf8'))
  } catch {
    throw new Error('Backup decryption produced an invalid package.')
  }
  return { envelope, inner }
}

export function createBarTradingPackage(snapshot, options = {}) {
  if (!snapshot || snapshot.schema !== SNAPSHOT_SCHEMA) throw new Error('A Bar trading snapshot is required to create a package.')
  const parts = packageInnerFiles(snapshot)
  const inner = { manifest: parts.manifest, checksums: parts.checksums, files: parts.files }
  const envelope = encodePackage(inner, options)
  const bytes = Buffer.from(canonicalJson(envelope), 'utf8')
  if (bytes.length > MAX_PACKAGE_BYTES) throw new Error('Bar trading recovery package exceeds the size ceiling.')
  return {
    bytes,
    packageSha256: sha256(bytes),
    manifest: parts.manifest,
    checksums: parts.checksums,
    encrypted: true,
    bytesLength: bytes.length
  }
}

export function validateBarTradingPackage(buffer, options = {}) {
  const packageBytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'utf8')
  if (packageBytes.length > MAX_PACKAGE_BYTES) throw new Error('The selected Bar trading recovery package is too large to verify safely.')
  const decoded = decodePackage(packageBytes, options.passphrase)
  const inner = decoded.inner
  const manifest = inner?.manifest
  const files = inner?.files
  if (!manifest || !files || typeof files['snapshot.json'] !== 'string' || typeof files['manifest.json'] !== 'string' || typeof files['README.txt'] !== 'string') {
    throw new Error('Bar trading recovery package is missing its manifest, snapshot, or readme.')
  }
  if (sha256(files['snapshot.json']) !== inner.checksums?.['snapshot.json']) throw new Error('Backup verification failed: snapshot checksum does not match.')
  if (sha256(files['manifest.json']) !== inner.checksums?.['manifest.json']) throw new Error('Backup verification failed: manifest checksum does not match.')
  if (sha256(files['README.txt']) !== inner.checksums?.['README.txt']) throw new Error('Backup verification failed: readme checksum does not match.')
  let manifestFile
  try { manifestFile = JSON.parse(files['manifest.json']) } catch { throw new Error('Backup manifest is not valid JSON.') }
  if (canonicalJson(manifestFile) !== canonicalJson(manifest)) throw new Error('Backup manifest copies do not match.')
  if (manifest?.format !== PACKAGE_SCHEMA || manifest?.snapshot_schema !== SNAPSHOT_SCHEMA) throw new Error('Backup manifest format is unsupported.')
  let snapshot
  try { snapshot = JSON.parse(files['snapshot.json']) } catch { throw new Error('Backup snapshot is not valid JSON.') }
  if (snapshot?.schema !== SNAPSHOT_SCHEMA || snapshot?.lodge_id !== manifest.lodge_id) throw new Error('Backup snapshot and manifest identity do not match.')
  if (options.expectedLodgeId && String(options.expectedLodgeId) !== String(manifest.lodge_id)) {
    throw new Error('This Bar trading recovery package belongs to a different lodge and cannot be staged here.')
  }
  const stores = snapshot.stores && typeof snapshot.stores === 'object' ? snapshot.stores : {}
  const manifestKeys = Object.keys(manifest.store_hashes || {}).sort()
  const storeKeys = Object.keys(stores).sort()
  if (JSON.stringify(manifestKeys) !== JSON.stringify(storeKeys)) throw new Error('Backup store set does not match its manifest.')
  for (const key of storeKeys) {
    const store = stores[key]
    if (!store || typeof store.content !== 'string') throw new Error(`Backup store ${key} is missing its content.`)
    const file = String(store.file || '')
    if (!file || path.basename(file) !== file || file.includes('/') || file.includes('\\')) {
      throw new Error(`Backup store ${key} has an invalid file name.`)
    }
    const hash = sha256(Buffer.from(store.content, 'utf8'))
    if (hash !== store.sha256 || hash !== String(manifest.store_hashes[key]).toLowerCase()) {
      throw new Error(`Backup store hash does not match for ${key}.`)
    }
    if (store.bytes > MAX_STORE_BYTES) throw new Error(`Backup store ${key} exceeds the per-store ceiling.`)
  }
  // Recompute the unresolved-operation disclosure from the actual contents
  // using the same rules as snapshot creation.
  const recomputeInputs = {}
  for (const key of storeKeys) {
    const spec = BAR_TRADING_STORE_SPECS.find((entry) => entry.key === key)
    if (!spec) continue
    recomputeInputs[key] = { spec, present: true, content: stores[key].content }
  }
  const recomputedUnresolved = buildUnresolvedSummary(recomputeInputs)
  if (manifest.unresolved && (Number(manifest.unresolved.count) !== recomputedUnresolved.count || String(manifest.unresolved.digest) !== recomputedUnresolved.digest)) {
    throw new Error('Backup unresolved-operation disclosure does not match the snapshot contents.')
  }
  return {
    success: true,
    format: manifest.format,
    encrypted: true,
    packageSha256: sha256(packageBytes),
    manifest,
    snapshot,
    complete: manifest.complete === true,
    warnings: Array.isArray(manifest.warnings) ? manifest.warnings : [],
    unresolved: recomputedUnresolved
  }
}

export function buildBarTradingPackageName(lodgeId, now = new Date()) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${PACKAGE_FILE_PREFIX}${safeLodgeSlug(lodgeId)}-${stamp}-${randomUUID().slice(0, 8)}${PACKAGE_EXTENSION}`
}

function cleanupStaleTemps(dirPath) {
  const deleted = []
  try {
    const now = Date.now()
    for (const name of fs.readdirSync(dirPath)) {
      if (!name.startsWith(PACKAGE_FILE_PREFIX) || !name.includes('.tmp')) continue
      const target = path.join(dirPath, name)
      try {
        const stat = fs.statSync(target)
        if (stat.isFile() && now - stat.mtimeMs > STALE_TEMP_MS) {
          fs.unlinkSync(target)
          deleted.push(name)
        }
      } catch {}
    }
  } catch {}
  return deleted
}

export function writeBarTradingPackageToPath(filePath, snapshot, options = {}) {
  const target = String(filePath || '').trim()
  if (!target || path.extname(target).toLowerCase() !== PACKAGE_EXTENSION) throw new Error(`Bar trading recovery exports must use the ${PACKAGE_EXTENSION} format.`)
  // Never silently recreate a missing destination: an unplugged drive must be
  // visible, not redirected to a local folder.
  const targetDir = path.dirname(path.resolve(target))
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error('The Bar trading recovery destination is missing (drive disconnected or folder moved). Choose another destination.')
  }
  if (Array.isArray(snapshot?.drift) && snapshot.drift.length > 0 && options.allowIncomplete !== true) {
    throw new Error(`The Bar trading snapshot is not coherent (${snapshot.drift.join(', ')} changed during capture). Retry the snapshot, or explicitly export an incomplete diagnostic package.`)
  }
  const packaged = createBarTradingPackage(snapshot, options)
  writeBytesAtomic(target, packaged.bytes)
  const cleanup = cleanupStaleTemps(path.dirname(path.resolve(target)))
  // Verify immediately before reporting the archive usable.
  const verification = verifyBarTradingPackageAtPath(target, { passphrase: options.passphrase, expectedLodgeId: snapshot.lodge_id })
  if (!verification.success) {
    try { fs.unlinkSync(target) } catch {}
    throw new Error(verification.error || 'Bar trading recovery package verification failed after writing.')
  }
  try {
    updateStatusFile(path.dirname(path.resolve(target)), {
      file_name: path.basename(target),
      destination: path.resolve(target),
      lodge_id: snapshot.lodge_id,
      package_sha256: packaged.packageSha256,
      written_at: new Date().toISOString(),
      complete: snapshot.complete === true,
      unresolved_count: snapshot.unresolved?.count || 0
    })
  } catch {}
  return {
    success: true,
    destination: path.resolve(target),
    fileName: path.basename(target),
    bytes: packaged.bytesLength,
    sha256: packaged.packageSha256,
    lodgeId: snapshot.lodge_id,
    complete: snapshot.complete === true,
    unresolvedCount: snapshot.unresolved?.count || 0,
    stale_temps_removed: cleanup
  }
}

export function verifyBarTradingPackageAtPath(filePath, options = {}) {
  try {
    const target = String(filePath || '').trim()
    if (!target || path.extname(target).toLowerCase() !== PACKAGE_EXTENSION) return { success: false, error: `Choose a Tsa Bonno ${PACKAGE_EXTENSION} file to verify.` }
    if (!fs.existsSync(target)) return { success: false, error: 'The selected Bar trading recovery package was not found.' }
    const stats = fs.statSync(target)
    if (!stats.isFile()) return { success: false, error: 'The selected recovery package is not a file.' }
    if (stats.size > MAX_PACKAGE_BYTES) return { success: false, error: 'The selected recovery package is too large to verify safely.' }
    const bytes = fs.readFileSync(target)
    return { ...validateBarTradingPackage(bytes, options), fileName: path.basename(target), bytes: bytes.length, destination: path.resolve(target) }
  } catch (error) {
    return { success: false, error: error?.message || 'Bar trading recovery package verification failed.' }
  }
}

// ─── Retention ───────────────────────────────────────────────────────────────

function hourBucket(iso) { return String(iso).slice(0, 13) }
function dayBucket(iso) { return String(iso).slice(0, 10) }
function weekBucket(iso) {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return 'unknown'
  const day = Math.floor(time / 86400000)
  return `w${Math.floor((day + 4) / 7)}`
}

export function planBarTradingRetention(entries, options = {}) {
  const now = options.now ? new Date(options.now).getTime() : Date.now()
  const hourlyLimit = Number(options.hourly || 24)
  const dailyLimit = Number(options.daily || 7)
  const weeklyLimit = Number(options.weekly || 4)
  const diskBudgetBytes = Number(options.diskBudgetBytes || 0)
  const sorted = [...(Array.isArray(entries) ? entries : [])]
    .filter((entry) => entry && entry.createdAt && Number.isFinite(new Date(entry.createdAt).getTime()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const keep = new Set()
  const suppressed = []
  const pickTier = (limit, bucketOf) => {
    const seen = new Set()
    for (const entry of sorted) {
      const age = now - new Date(entry.createdAt).getTime()
      if (age < 0) continue
      const bucket = bucketOf(entry.createdAt)
      if (seen.has(bucket)) continue
      if (seen.size >= limit) break
      seen.add(bucket)
      keep.add(entry)
    }
  }
  pickTier(hourlyLimit, hourBucket)
  pickTier(dailyLimit, dayBucket)
  pickTier(weeklyLimit, weekBucket)
  // Always keep the newest verified archive.
  const newestVerified = sorted.find((entry) => entry.verified === true)
  if (newestVerified) keep.add(newestVerified)
  // Protect unresolved evidence: a generation carrying unresolved operations is
  // deleted only when a strictly newer verified generation contains a superset
  // of its unresolved identities. Otherwise it may be the only recoverable copy.
  const protectedEntries = []
  for (const entry of sorted) {
    const identities = Array.isArray(entry.unresolvedIds) ? entry.unresolvedIds : []
    if (identities.length === 0) continue
    const idSet = new Set(identities)
    const superseded = sorted.some((candidate) => {
      if (candidate === entry || candidate.verified !== true) return false
      if (new Date(candidate.createdAt).getTime() <= new Date(entry.createdAt).getTime()) return false
      const candidateIds = new Set(Array.isArray(candidate.unresolvedIds) ? candidate.unresolvedIds : [])
      for (const id of idSet) if (!candidateIds.has(id)) return false
      return true
    })
    if (!superseded) {
      keep.add(entry)
      protectedEntries.push(entry)
    }
  }
  const keepList = sorted.filter((entry) => keep.has(entry))
  const deleteList = sorted.filter((entry) => !keep.has(entry))
  // Disk budget: drop oldest unprotected, non-tier entries first. Protected
  // entries and the newest verified archive are never dropped for budget.
  let totalBytes = keepList.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0)
  const overBudget = []
  if (diskBudgetBytes > 0 && totalBytes > diskBudgetBytes) {
    const protectedSet = new Set(protectedEntries)
    const denied = new Set([...protectedSet, ...(newestVerified ? [newestVerified] : [])])
    const budgetDeletable = [...deleteList]
    // Tier keeps are already excluded; still over budget, so also consider
    // freely deletable non-protected entries that were tier-kept.
    const candidates = [...keepList].filter((entry) => !denied.has(entry))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    for (const entry of candidates) {
      if (totalBytes <= diskBudgetBytes) break
      const index = deleteList.indexOf(entry)
      if (index === -1) deleteList.push(entry)
      totalBytes -= Number(entry.bytes || 0)
    }
    if (totalBytes > diskBudgetBytes) overBudget.push({ reason: 'disk_budget_exceeded_with_protected_archives', remaining_bytes: totalBytes })
  }
  return {
    keep: sorted.filter((entry) => !deleteList.includes(entry)).map((entry) => entry.fileName || entry.name || null),
    delete: deleteList.map((entry) => entry.fileName || entry.name || null),
    delete_entries: deleteList,
    protected: protectedEntries.map((entry) => entry.fileName || entry.name || null),
    over_budget: overBudget,
    budget_bytes: diskBudgetBytes || null,
    retained_bytes: totalBytes
  }
}

export function applyBarTradingRetention(targetDir, entries, options = {}) {
  const root = path.resolve(String(targetDir || ''))
  const plan = planBarTradingRetention(entries, options)
  const deleted = []
  for (const entry of plan.delete_entries) {
    const candidate = path.resolve(String(entry.path || path.join(root, String(entry.fileName || entry.name || ''))))
    const relative = path.relative(root, candidate)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
    if (!path.basename(candidate).startsWith(PACKAGE_FILE_PREFIX)) continue
    try {
      fs.unlinkSync(candidate)
      deleted.push(path.basename(candidate))
    } catch {}
  }
  return { ...plan, deleted }
}

// ─── Status and health ───────────────────────────────────────────────────────

function statusFilePath(dirPath) {
  return path.join(path.resolve(String(dirPath)), STATUS_FILE)
}

function updateStatusFile(dirPath, entry) {
  const filePath = statusFilePath(dirPath)
  const current = readJsonFile(filePath, { per_lodge: {} })
  current.per_lodge = current.per_lodge && typeof current.per_lodge === 'object' ? current.per_lodge : {}
  const key = String(entry.lodge_id || 'unknown')
  const previous = current.per_lodge[key] || null
  if (!previous || new Date(entry.written_at || 0).getTime() >= new Date(previous.written_at || 0).getTime()) {
    current.per_lodge[key] = entry
  }
  current.updated_at = new Date().toISOString()
  writeJsonAtomic(filePath, current)
}

function probeTargetDirectory(dirPath) {
  const target = path.resolve(String(dirPath || ''))
  try {
    const stat = fs.statSync(target)
    if (!stat.isDirectory()) return { state: 'not_a_directory' }
    fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK)
    return { state: 'ok' }
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing' }
    return { state: 'unwritable', code: error?.code || 'unknown' }
  }
}

export function listBarTradingPackages(targetDir, options = {}) {
  const root = path.resolve(String(targetDir || ''))
  try {
    if (!fs.existsSync(root)) return []
    const lodgeSlug = options.lodgeId ? safeLodgeSlug(options.lodgeId) : null
    return fs.readdirSync(root)
      .filter((name) => name.startsWith(PACKAGE_FILE_PREFIX) && name.endsWith(PACKAGE_EXTENSION))
      .filter((name) => !lodgeSlug || name.startsWith(`${PACKAGE_FILE_PREFIX}${lodgeSlug}-`))
      .map((name) => {
        const filePath = path.join(root, name)
        const stat = fs.statSync(filePath)
        return { fileName: name, path: filePath, bytes: stat.size, createdAt: stat.mtime.toISOString() }
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } catch { return [] }
}

export function getBarTradingBackupHealth(options = {}) {
  const targetDir = String(options.targetDir || '').trim()
  const lodgeId = String(options.lodgeId || state.lodgeId || '').trim()
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now()
  const warnings = []
  if (!targetDir) {
    return {
      ok: false,
      state: 'not_configured',
      warnings: ['No Bar trading recovery target folder is configured. Configure an external/removable target; a copy on the same disk is not disaster recovery.'],
      limitations: [...RECOVERY_LIMITATIONS]
    }
  }
  const probe = probeTargetDirectory(targetDir)
  let status = null
  if (probe.state === 'ok') {
    const current = readJsonFile(statusFilePath(targetDir), { per_lodge: {} })
    status = lodgeId ? (current.per_lodge?.[lodgeId] || null) : (Object.values(current.per_lodge || {})[0] || null)
  } else {
    warnings.push(probe.state === 'missing'
      ? 'The configured Bar trading recovery target is missing (drive disconnected or folder moved).'
      : 'The configured Bar trading recovery target is not writable.')
  }
  let latestOnDisk = listBarTradingPackages(targetDir, { lodgeId })[0] || null
  let ageDays = null
  const latestAt = status?.written_at || latestOnDisk?.createdAt || null
  if (latestAt) ageDays = Math.max(0, (nowMs - new Date(latestAt).getTime()) / 86400000)
  const cacheDir = String(options.cacheDir || state.cacheDir || '').trim()
  let sameRoot = null
  if (cacheDir && targetDir) {
    try { sameRoot = path.parse(path.resolve(cacheDir)).root === path.parse(path.resolve(targetDir)).root } catch { sameRoot = null }
  }
  if (sameRoot === true) warningSameRoot(warnings)
  if (!latestAt) warnings.push('No verified Bar trading recovery archive exists for this lodge yet.')
  else if (ageDays > 7) warnings.push(`The last Bar trading recovery archive is ${Math.floor(ageDays)} day(s) old.`)
  if (status?.complete === false) warnings.push('The last Bar trading recovery archive was captured incomplete; review its warnings before relying on it.')
  return {
    ok: warnings.length === 0,
    state: !latestAt ? 'never' : (ageDays !== null && ageDays > 7 ? 'stale' : 'current'),
    target_dir: path.resolve(targetDir),
    target_state: probe.state,
    same_volume_as_profile: sameRoot,
    last_verified_at: status?.written_at || null,
    last_archive: status ? { fileName: status.file_name, sha256: status.package_sha256, complete: status.complete === true, unresolved_count: status.unresolved_count || 0 } : (latestOnDisk ? { fileName: latestOnDisk.fileName, complete: null, unresolved_count: null } : null),
    age_days: ageDays === null ? null : Math.round(ageDays * 100) / 100,
    warnings,
    limitations: [...RECOVERY_LIMITATIONS]
  }
}

function warningSameRoot(warnings) {
  warnings.push('The recovery target is on the same volume as the active profile. A same-disk copy alone is not disaster recovery; use an external, network, or removable target.')
}

// ─── Target configuration ────────────────────────────────────────────────────

const CONFIG_FILE = 'bar-trading-backup-config.json'

export function configureBarTradingBackupTarget(options = {}) {
  const configDir = String(options.configDir || state.cacheRootDir || state.cacheDir || '').trim()
  if (!configDir) throw new Error('A configuration directory is required to configure Bar trading recovery.')
  const targetDir = path.resolve(String(options.targetDir || '').trim())
  if (!targetDir) throw new Error('Choose a destination folder for Bar trading recovery archives.')
  const probe = probeTargetDirectory(targetDir)
  if (probe.state === 'missing') throw new Error('The selected Bar trading recovery target folder does not exist. Connect the drive or choose another folder.')
  if (probe.state !== 'ok') throw new Error('The selected Bar trading recovery target folder is not writable. Choose another folder.')
  const cacheDir = String(options.cacheDir || state.cacheDir || '').trim()
  let sameVolume = null
  if (cacheDir) {
    try { sameVolume = path.parse(path.resolve(cacheDir)).root === path.parse(targetDir).root } catch { sameVolume = null }
  }
  if (sameVolume === true && options.allowSameVolume !== true) {
    throw new Error('The selected target is on the same volume as the active profile. A same-disk copy alone is not disaster recovery; choose an external, network, or removable target (or explicitly allow same-volume for testing).')
  }
  const config = {
    version: 1,
    target_dir: targetDir,
    configured_at: new Date().toISOString(),
    same_volume_as_profile: sameVolume
  }
  writeJsonAtomic(path.join(path.resolve(configDir), CONFIG_FILE), config)
  return { success: true, target_dir: targetDir, same_volume_as_profile: sameVolume }
}

export function readBarTradingBackupTarget(options = {}) {
  const configDir = String(options.configDir || state.cacheRootDir || state.cacheDir || '').trim()
  if (!configDir) return ''
  const config = readJsonFile(path.join(path.resolve(configDir), CONFIG_FILE), null)
  return typeof config?.target_dir === 'string' ? config.target_dir : ''
}

// ─── Staged restore ──────────────────────────────────────────────────────────

function reconciliationForStore(spec, stagedContent, liveContent) {
  const stagedRows = parseIdentityRows(spec, stagedContent)
  const liveRows = liveContent === undefined || liveContent === null ? [] : parseIdentityRows(spec, liveContent)
  const liveById = new Map(liveRows.map((row) => [row.identity, row.hash]))
  const stagedById = new Map(stagedRows.map((row) => [row.identity, row.hash]))
  let alreadyPresent = 0
  let sameIdentityDifferentContent = 0
  let onlyInArchive = 0
  for (const row of stagedRows) {
    if (!liveById.has(row.identity)) onlyInArchive += 1
    else if (liveById.get(row.identity) === row.hash) alreadyPresent += 1
    else sameIdentityDifferentContent += 1
  }
  const onlyInLive = liveRows.filter((row) => !stagedById.has(row.identity)).map((row) => row.identity)
  return {
    staged_count: stagedRows.length,
    live_count: liveRows.length,
    already_present: alreadyPresent,
    same_identity_different_content: sameIdentityDifferentContent,
    only_in_archive: onlyInArchive,
    only_in_live: onlyInLive.slice(0, 200),
    only_in_live_count: onlyInLive.length
  }
}

function readLiveStore(liveCacheDir, spec) {
  if (!liveCacheDir) return undefined
  const filePath = path.join(liveCacheDir, spec.file)
  const outcome = readStoreStable(filePath, spec)
  if (!outcome.present) return null
  if (outcome.drift || outcome.error) return { unreadable: true }
  return outcome.content
}

export function stageBarTradingRestore(packagePath, options = {}) {
  const operationId = assertOperationId(options.operationId)
  const targetRoot = path.resolve(String(options.targetRoot || '').trim() || path.join(resolveCacheDir(options), 'bar-trading-recovery'))
  const liveCacheDir = options.liveCacheDir !== undefined ? (options.liveCacheDir ? path.resolve(String(options.liveCacheDir)) : null) : (state.cacheDir ? path.resolve(state.cacheDir) : null)
  const verification = verifyBarTradingPackageAtPath(packagePath, { passphrase: options.passphrase, expectedLodgeId: options.expectedLodgeId })
  if (!verification.success) return verification
  const snapshot = verification.snapshot
  const stagingDir = resolveContainedPath(targetRoot, `${STAGING_DIR_PREFIX}${operationId}`)
  const progressPath = path.join(stagingDir, PROGRESS_FILE)
  const existingProgress = readJsonFile(progressPath, null)
  if (fs.existsSync(stagingDir)) {
    if (existingProgress && existingProgress.package_sha256 === verification.packageSha256 && existingProgress.operation_id === operationId) {
      // Resume after interruption.
    } else if (options.replaceExisting === true) {
      const previousDir = `${stagingDir}.previous-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
      fs.renameSync(stagingDir, previousDir)
      fsyncDir(path.dirname(stagingDir))
    } else {
      throw new Error('A staged restore already exists for this operation. Replace it explicitly to re-stage.')
    }
  }
  ensureDir(stagingDir)
  const storesDir = resolveContainedPath(stagingDir, 'stores')
  ensureDir(storesDir)
  const stagedStores = existingProgress?.stores && typeof existingProgress.stores === 'object' ? { ...existingProgress.stores } : {}
  const reconciliation = {}
  const unreadableLive = []
  for (const [key, store] of Object.entries(snapshot.stores)) {
    const stagedFile = resolveContainedPath(storesDir, store.file)
    const contentHash = sha256(Buffer.from(store.content, 'utf8'))
    if (stagedStores[key] !== contentHash || !fs.existsSync(stagedFile)) {
      writeBytesAtomic(stagedFile, Buffer.from(store.content, 'utf8'))
      stagedStores[key] = contentHash
      writeJsonAtomic(progressPath, {
        operation_id: operationId,
        package_sha256: verification.packageSha256,
        staged_at: new Date().toISOString(),
        stores: stagedStores
      })
    }
    const spec = BAR_TRADING_STORE_SPECS.find((entry) => entry.key === key) || { key, kind: store.kind, file: store.file }
    const liveContent = readLiveStore(liveCacheDir, spec)
    if (liveContent && typeof liveContent === 'object' && liveContent.unreadable) unreadableLive.push(key)
    if (spec.unresolvedBearing || store.unresolved_bearing) {
      reconciliation[key] = reconciliationForStore(spec, store.content, typeof liveContent === 'string' ? liveContent : undefined)
    }
  }
  const newerUnresolvedLocalWork = Object.values(reconciliation).some((entry) => entry.only_in_live_count > 0) || unreadableLive.length > 0
  const report = {
    mode: 'staged-isolated-restore',
    operation_id: operationId,
    source_package: path.basename(String(packagePath)),
    package_sha256: verification.packageSha256,
    lodge_id: snapshot.lodge_id,
    captured_at: snapshot.captured_at,
    snapshot_complete: snapshot.complete === true,
    warnings: snapshot.warnings,
    store_counts: Object.fromEntries(Object.entries(snapshot.stores).map(([key, store]) => [key, { bytes: store.bytes, sha256: store.sha256, role: store.role }])),
    withheld: snapshot.withheld,
    reconciliation,
    live_stores_unreadable: unreadableLive,
    newer_unresolved_local_work: newerUnresolvedLocalWork,
    device_identity: {
      cloned: false,
      note: 'Device identity is never archived. A replacement machine will present a different device identity.'
    },
    activation: {
      requires_explicit_authorization: true,
      refuses_if_newer_unresolved_local_work: true,
      never_restores: ['users', 'trial_status', 'interrupted generations (.tmp)'],
      tmp_generations_are_preserved_for_review_only: true
    },
    recovery_limits: snapshot.recovery_limits,
    validated_at: new Date().toISOString()
  }
  writeJsonAtomic(path.join(stagingDir, REPORT_FILE), report)
  return {
    success: true,
    operationId,
    stagingDirectory: stagingDir,
    report,
    reconciliation,
    newerUnresolvedLocalWork,
    canActivate: !newerUnresolvedLocalWork
  }
}

export function activateStagedBarTradingRestore(operationId, options = {}) {
  const safeOperationId = assertOperationId(operationId)
  if (options.authorized !== true) throw new Error('Explicit authorization is required to activate a staged Bar trading restore.')
  const targetRoot = path.resolve(String(options.targetRoot || '').trim() || path.join(resolveCacheDir(options), 'bar-trading-recovery'))
  const stagingDir = resolveContainedPath(targetRoot, `${STAGING_DIR_PREFIX}${safeOperationId}`)
  const progress = readJsonFile(path.join(stagingDir, PROGRESS_FILE), null)
  const report = readJsonFile(path.join(stagingDir, REPORT_FILE), null)
  if (!progress || !report) throw new Error('No staged Bar trading restore exists for this operation.')
  const lodgeId = resolveLodgeId(options)
  if (options.confirmLodgeId && String(options.confirmLodgeId) !== String(report.lodge_id)) {
    throw new Error('Activation scope does not match the staged archive lodge. Confirm the correct lodge before restoring.')
  }
  if (String(report.lodge_id) !== lodgeId) {
    throw new Error('This staged archive belongs to a different lodge than the active profile and cannot be activated here.')
  }
  const liveCacheDir = path.resolve(String(options.liveCacheDir || state.cacheDir || '').trim())
  if (!liveCacheDir) throw new Error('An active profile cache directory is required to activate a staged restore.')
  const storesDir = resolveContainedPath(stagingDir, 'stores')
  const stagedEntries = []
  const deferredStores = []
  for (const [key, stagedHash] of Object.entries(progress.stores || {})) {
    const spec = BAR_TRADING_STORE_SPECS.find((entry) => entry.key === key)
    if (!spec) {
      // Renderer-owned durable state cannot be written by the main process.
      // Disclose it as deferred instead of silently dropping it.
      deferredStores.push(key)
      continue
    }
    const stagedFile = resolveContainedPath(storesDir, spec.file)
    if (!fs.existsSync(stagedFile)) throw new Error(`Staged store ${key} is missing; re-stage the restitution.`)
    const bytes = fs.readFileSync(stagedFile)
    if (sha256(bytes) !== stagedHash) throw new Error(`Staged store ${key} changed after staging; re-stage the restore.`)
    stagedEntries.push({ spec, bytes })
  }
  // Fresh reconciliation at activation time: refuse if the live profile has
  // unresolved work the archive does not contain, and refuse if live stores
  // changed since staging in ways that conflict with what we are about to do.
  for (const { spec, bytes } of stagedEntries) {
    if (!spec.unresolvedBearing) continue
    const liveContent = readLiveStore(liveCacheDir, spec)
    if (liveContent && typeof liveContent === 'object' && liveContent.unreadable) {
      throw new Error(`Live store ${spec.file} could not be read reliably; refusing to activate while unresolved work may exist.`)
    }
    const diff = reconciliationForStore(spec, bytes.toString('utf8'), typeof liveContent === 'string' ? liveContent : undefined)
    if (diff.only_in_live_count > 0) {
      throw new Error(`The live profile contains unresolved work that is newer than this archive (${spec.file}). Create a fresh Bar trading snapshot first; this archive will not overwrite newer unresolved work.`)
    }
  }
  // Preserve a recoverable prior state before writing anything into the live
  // profile. If the copy fails, activation aborts with no changes made.
  const priorStateDir = path.join(path.dirname(liveCacheDir), 'bar-trading-prior-state', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))
  ensureDir(priorStateDir)
  const priorCopies = []
  for (const { spec } of stagedEntries) {
    const liveFile = path.join(liveCacheDir, spec.file)
    if (!fs.existsSync(liveFile)) continue
    const copyPath = path.join(priorStateDir, spec.file)
    fs.copyFileSync(liveFile, copyPath)
    fsyncFile(copyPath)
    priorCopies.push(spec.file)
  }
  fsyncDir(priorStateDir)
  // Activate: interrupted generations are preserved for review under a
  // non-promotable name, everything else is written atomically.
  const activated = []
  const preservedGenerations = []
  for (const { spec, bytes } of stagedEntries) {
    if (spec.kind === 'tmp-generation') {
      const reviewPath = resolveContainedPath(liveCacheDir, `${spec.file}.restored-${Date.now()}.recovery`)
      writeBytesAtomic(reviewPath, bytes)
      preservedGenerations.push(path.basename(reviewPath))
      continue
    }
    const liveFile = path.join(liveCacheDir, spec.file)
    writeBytesAtomic(liveFile, bytes)
    const readBack = fs.readFileSync(liveFile)
    if (sha256(readBack) !== sha256(bytes)) throw new Error(`Activation verification failed for ${spec.file}. Prior state is preserved at ${priorStateDir}.`)
    activated.push(spec.file)
  }
  const activationReport = {
    operation_id: safeOperationId,
    activated_at: new Date().toISOString(),
    lodge_id: report.lodge_id,
    package_sha256: report.package_sha256,
    activated_stores: activated,
    preserved_interrupted_generations: preservedGenerations,
    deferred_stores: deferredStores,
    deferred_stores_note: deferredStores.length ? 'Renderer-owned durable state is staged but requires the renderer import seam; it was not activated by the main process.' : null,
    prior_state_directory: priorStateDir,
    prior_state_files: priorCopies,
    never_restored: ['users', 'trial_status', 'interrupted generations are review-only'],
    note: 'Server-confirmed financial records were not modified. Replay reconciliation remains the responsibility of the normal queue and submit-journal paths.'
  }
  writeJsonAtomic(path.join(stagingDir, ACTIVATION_REPORT_FILE), activationReport)
  return { success: true, operationId: safeOperationId, activation: activationReport }
}

export {
  SNAPSHOT_SCHEMA,
  PACKAGE_SCHEMA,
  PACKAGE_EXTENSION,
  RECOVERY_LIMITATIONS,
  PROTECTED_FIELD_NAMES
}
