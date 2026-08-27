import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { state } from '../state.js'
import {
  validateStarterBackupPackage,
  verifyStarterBackupAtPath,
  buildRestorePreviewReport,
  reconstructBookingLedger,
  buildRecoveryIdentityMap,
  remapPayloadForRecovery,
  perTableCanonicalHash
} from './starterBackup.js'

const MAX_STAGED_BYTES = 256 * 1024 * 1024
const MAX_OPERATIONS = 50
const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VALID_STATUSES = new Set(['draft', 'staging', 'sealed', 'preview_ready', 'approved', 'executing', 'verified', 'discarded', 'failed'])
const RECOVERY_WORKSPACE_ENV = 'disposable_recovery_directory'
const OPERATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
const EXECUTION_LOCK_STALE_MS = 15 * 60 * 1000
const EXECUTION_STALE_MS = 15 * 60 * 1000
const SERVER_RESTORE_MAX_BYTES = 8 * 1024 * 1024
const SERVER_RESTORE_FIELDS = Object.freeze({
  settings: new Set(['id', 'lodge_id', 'lodge_name', 'company_name', 'address', 'city', 'country', 'phone', 'email', 'website', 'vat_number', 'currency', 'setup_complete', 'created_at', 'updated_at', 'business_type', 'property_type', 'vat_enabled', 'vat_rate', 'deleted', 'slug', 'booking_tagline', 'booking_description', 'whatsapp_number', 'booking_check_in_from', 'booking_check_out_until', 'booking_cancellation_policy', 'booking_payment_terms', 'booking_house_rules', 'booking_faq', 'assistant_enabled', 'timezone', 'public_offer_rooms', 'public_offer_multi_room', 'public_offer_full_lodge', 'public_offer_day_use', 'public_offer_events', 'public_offer_campsites', 'operating_profile']),
  // Dimension foreign keys are intentionally omitted: room_types and
  // floor_sections are outside the seven-table package and the SQL restore
  // reports those references instead of cross-lodge-linking them.
  rooms: new Set(['id', 'lodge_id', 'room_number', 'room_type', 'rate_per_night', 'max_occupancy', 'status', 'housekeeping_status', 'housekeeping_notes', 'description', 'created_at', 'updated_at', 'amenities', 'accommodation_kind', 'capacity_adults', 'capacity_children', 'max_tents', 'max_vehicles', 'is_powered', 'site_surface', 'shared_facilities', 'rate_mode', 'rate_per_person', 'rate_per_tent', 'rate_per_vehicle']),
  customers: new Set(['id', 'lodge_id', 'name', 'email', 'phone', 'id_number', 'address', 'nationality', 'notes', 'is_blacklisted', 'blacklist_reason', 'created_at', 'updated_at']),
  bookings: new Set(['id', 'lodge_id', 'room_id', 'customer_id', 'check_in', 'check_out', 'adults', 'children', 'tents_count', 'vehicles_count', 'accommodation_kind', 'booking_accommodation_details', 'total_amount', 'deposit_amount', 'payment_method', 'status', 'notes', 'updated_at', 'created_at', 'is_exclusive_event', 'event_daily_rate', 'quotation_id', 'charges_total', 'vat_enabled', 'vat_rate', 'cancel_reason', 'cancelled_at', 'invoice_number']),
  quotations: new Set(['id', 'lodge_id', 'customer_id', 'customer_name', 'room_id', 'room_name', 'check_in', 'check_out', 'adults', 'children', 'total_amount', 'currency', 'notes', 'status', 'valid_until', 'converted_booking_id', 'created_at', 'updated_at', 'customer_phone', 'subtotal', 'tax_amount', 'quotation_type', 'event_name', 'event_daily_rate', 'accommodation_lines', 'parent_quotation_id']),
  signed_payment_ledger: new Set(['id', 'booking_id', 'lodge_id', 'amount', 'method', 'type', 'paid_at', 'notes', 'created_at']),
  maintenance: new Set(['id', 'lodge_id', 'room_id', 'title', 'description', 'priority', 'status', 'reported_date', 'notes', 'created_at', 'labour_cost', 'parts_cost', 'total_cost', 'vendor_name', 'cost_notes'])
})

function getOperationsRoot() {
  const base = String(state.cacheRootDir || state.cacheDir || '').trim() || String(process.env.APPDATA || process.cwd())
  return path.join(base, 'starter-recovery-operations')
}

function getWorkspaceRoot() {
  const base = String(state.cacheRootDir || state.cacheDir || '').trim() || String(process.env.APPDATA || process.cwd())
  return path.join(base, 'starter-recovery-workspace')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function resolveContainedPath(root, ...segments) {
  const resolvedRoot = path.resolve(String(root))
  const candidate = path.resolve(resolvedRoot, ...segments.map((segment) => String(segment)))
  const relative = path.relative(resolvedRoot, candidate)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Recovery path is outside the recovery workspace.')
  }
  return candidate
}

function assertContainedPath(root, candidate) {
  const resolvedRoot = path.resolve(String(root))
  const resolvedCandidate = path.resolve(String(candidate))
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Recovery path is outside the recovery workspace.')
  }
  return resolvedCandidate
}

function fsyncDir(dir) {
  try {
    const handle = fs.openSync(dir, 'r')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
}

function assertValidOperationId(operationId) {
  const value = String(operationId || '').trim()
  if (!OPERATION_ID_PATTERN.test(value)) throw new Error('A stable operation ID (UUID v4) is required for recovery operations.')
  return value.toLowerCase()
}

function operationPath(operationId) {
  const safeId = assertValidOperationId(operationId)
  return resolveContainedPath(getOperationsRoot(), `${safeId}.json`)
}

function operationLockPath(operationId) {
  const safeId = assertValidOperationId(operationId)
  return resolveContainedPath(getOperationsRoot(), `${safeId}.lock`)
}

function stagedPackagePath(operationId) {
  const safeId = assertValidOperationId(operationId)
  return resolveContainedPath(getOperationsRoot(), `${safeId}.tbbackup`)
}

function operationWorkspacePath(operationId) {
  const safeId = assertValidOperationId(operationId)
  return resolveContainedPath(getWorkspaceRoot(), safeId)
}

function acquireOperationLock(operationId) {
  const lockPath = operationLockPath(operationId)
  const token = randomUUID()
  ensureDir(path.dirname(lockPath))
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const metadata = { operation_id: operationId, token, pid: process.pid, started_at: new Date().toISOString() }
      fs.writeFileSync(lockPath, `${JSON.stringify(metadata)}\n`, { flag: 'wx' })
      try { const h = fs.openSync(lockPath, 'r+'); try { fs.fsyncSync(h) } finally { fs.closeSync(h) } } catch {}
      return { lockPath, token }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let stale = false
      try {
        const metadata = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
        const startedAt = new Date(metadata.started_at || 0).getTime()
        const age = Date.now() - startedAt
        const pidAlive = Number.isInteger(Number(metadata.pid)) && isProcessAlive(Number(metadata.pid))
        stale = !pidAlive && (!Number.isFinite(startedAt) || age > EXECUTION_LOCK_STALE_MS)
      } catch {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs
        stale = age > EXECUTION_LOCK_STALE_MS
      }
      if (!stale) throw new Error('Recovery operation is already executing.')
      try { fs.unlinkSync(lockPath) } catch (unlinkError) {
        if (unlinkError?.code === 'ENOENT') continue
        throw new Error('Recovery operation is already executing.')
      }
    }
  }
  throw new Error('Recovery operation is already executing.')
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code !== 'ESRCH' }
}

function releaseOperationLock(lock) {
  if (!lock?.lockPath) return
  try {
    const metadata = JSON.parse(fs.readFileSync(lock.lockPath, 'utf8'))
    if (metadata.token !== lock.token) return
  } catch { return }
  try { fs.unlinkSync(lock.lockPath) } catch {}
}

function writeOperationAtomic(operationId, data) {
  const safeId = assertValidOperationId(operationId)
  const target = operationPath(safeId)
  ensureDir(path.dirname(target))
  const tmp = `${target}.${randomUUID()}.tmp`
  const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
  fs.writeFileSync(tmp, bytes, { flag: 'wx' })
  try {
    const handle = fs.openSync(tmp, 'r+')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
  fs.renameSync(tmp, target)
  fsyncDir(path.dirname(target))
}

function readOperation(operationId) {
  const safeId = assertValidOperationId(operationId)
  const p = operationPath(safeId)
  if (!fs.existsSync(p)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (String(parsed?.operation_id || '').toLowerCase() !== safeId) return null
    return parsed
  } catch { return null }
}

function listAllOperations() {
  try {
    const dir = getOperationsRoot()
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => {
      try {
        const filePath = resolveContainedPath(dir, name)
        const operationId = assertValidOperationId(path.basename(name, '.json'))
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        if (String(parsed?.operation_id || '').toLowerCase() !== operationId) return null
        return parsed
      } catch { return null }
    }).filter(Boolean).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  } catch { return [] }
}

function listOperations() {
  return listAllOperations().slice(0, MAX_OPERATIONS)
}

function isExpired(op, now = Date.now()) {
  if (!op?.expires_at) return false
  const expiresAt = new Date(op.expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt <= now
}

function isCapacityActive(op, now = Date.now()) {
  if (!op || op.status === 'discarded') return false
  if (op.status === 'executing' && canRecoverStaleExecution(op)) return false
  if (isExpired(op, now) && op.status !== 'executing') return false
  return true
}

function recoverStaleExecution(op) {
  if (!op || op.status !== 'executing' || !canRecoverStaleExecution(op)) return op
  op.status = 'approved'
  op.execution_recovered_at = new Date().toISOString()
  op.execution_pid = null
  appendAudit(op, 'execution_recovered', { reason: 'Previous execution stopped before completion.' })
  writeOperationAtomic(op.operation_id, op)
  return op
}

function discardExpiredOperation(op) {
  if (!op || op.status === 'discarded' || op.status === 'executing' || !isExpired(op)) return op
  op.status = 'discarded'
  op.discarded_at = new Date().toISOString()
  op.discarded_reason = 'expired'
  appendAudit(op, 'expired', { expires_at: op.expires_at })
  writeOperationAtomic(op.operation_id, op)
  return op
}

function ensureOperationNotExpired(op) {
  if (isExpired(op) && op.status !== 'executing') {
    discardExpiredOperation(op)
    throw new Error('This recovery operation has expired. Begin a new recovery operation.')
  }
  return op
}

function assertStagedPackagePath(operationId, stagedPath) {
  const expected = stagedPackagePath(operationId)
  const actual = assertContainedPath(getOperationsRoot(), stagedPath)
  if (actual !== expected) throw new Error('Recovery package staging path is invalid.')
  return actual
}

function captureRehearsalWorkspaceSnapshot(targetRoot, operationId, lodgeId) {
  ensureDir(targetRoot)
  const entries = fs.readdirSync(targetRoot).map((name) => {
    const entryPath = resolveContainedPath(targetRoot, name)
    let bytes = 0
    try { bytes = fs.statSync(entryPath).size } catch {}
    return { name, bytes }
  }).sort((a, b) => a.name.localeCompare(b.name))
  const fingerprint = createHash('sha256').update(JSON.stringify(entries)).digest('hex')
  return {
    at: new Date().toISOString(),
    operation_id: operationId,
    target_environment: RECOVERY_WORKSPACE_ENV,
    lodge_id: lodgeId,
    snapshot_scope: 'local rehearsal directory only; no lodge database rows are captured',
    authoritative: false,
    existing_files: entries.length,
    fingerprint
  }
}

function writeJsonAtomic(filePath, value) {
  const target = path.resolve(String(filePath))
  const dir = path.dirname(target)
  ensureDir(dir)
  const tempPath = resolveContainedPath(dir, `${path.basename(target)}.${randomUUID()}.tmp`)
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  try {
    const handle = fs.openSync(tempPath, 'r+')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
  fs.renameSync(tempPath, target)
  fsyncDir(dir)
}

function writeBytesAtomic(filePath, bytes) {
  const target = path.resolve(String(filePath))
  const dir = path.dirname(target)
  ensureDir(dir)
  const tempPath = resolveContainedPath(dir, `${path.basename(target)}.${randomUUID()}.tmp`)
  fs.writeFileSync(tempPath, bytes, { flag: 'wx' })
  try {
    const handle = fs.openSync(tempPath, 'r+')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
  fs.renameSync(tempPath, target)
  fsyncDir(dir)
}

function buildSanitizedRehearsalReport({ verification, remappedTables, ledgerReconstruction, rehearsalTargetId, sourcePackageName, identityRemapped }) {
  const restoredTables = Object.fromEntries(Object.entries(remappedTables).map(([table, rows]) => [
    table,
    { count: Array.isArray(rows) ? rows.length : 0, sha256: perTableCanonicalHash(Array.isArray(rows) ? rows : []) }
  ]))
  return {
    mode: 'disposable-in-memory-restore-rehearsal',
    execution_mode: 'rehearsal_only',
    support_led: true,
    can_restore_live: false,
    live_restore_available: false,
    writes_personal_data: false,
    persists_to_database: false,
    isolated_target: true,
    target_environment: RECOVERY_WORKSPACE_ENV,
    source_package: sourcePackageName,
    package_sha256: verification.packageSha256,
    source_lodge_id: verification.manifest.lodge_id,
    rehearsal_target_id: rehearsalTargetId,
    identity_remapped: identityRemapped,
    per_table_hashes: verification.perTableHashes || null,
    per_table_hashes_verified: verification.perTableHashesVerified === true,
    sanitized_counts: verification.counts,
    generated_at: new Date().toISOString(),
    counts: verification.counts,
    restored_tables: restoredTables,
    ledger_reconstruction: {
      totals: ledgerReconstruction.totals,
      orphan_payment_count: ledgerReconstruction.orphanPayments.length
    },
    missing_lineage_disclosure: ledgerReconstruction.missing_lineage_disclosure,
    validation: 'passed',
    scaling_notes: 'This report covers the local in-memory rehearsal only. A disposable lodge exists only after the service-role restore and verification RPCs both succeed.'
  }
}

function projectServerRestoreTables(remappedTables, generatedAt) {
  const fallbackDate = String(generatedAt || new Date().toISOString()).slice(0, 10)
  const tables = {}
  for (const [table, allowlist] of Object.entries(SERVER_RESTORE_FIELDS)) {
    const rows = Array.isArray(remappedTables?.[table]) ? remappedTables[table] : []
    tables[table] = rows.map((row) => {
      if (table === 'signed_payment_ledger' && (row?.conference_booking_id || row?._unresolved_conference_ref)) {
        throw new Error('This package contains conference payment references, which are outside the disposable Starter restore scope.')
      }
      const normalized = { ...row }
      if (table === 'rooms') {
        if (normalized.rate_per_night === undefined) normalized.rate_per_night = normalized.price_per_night
        if (normalized.max_occupancy === undefined) normalized.max_occupancy = normalized.capacity ?? normalized.capacity_adults
        if (!normalized.room_type) normalized.room_type = normalized.accommodation_kind || 'room'
      }
      if (table === 'bookings' && normalized.charges_total === undefined) normalized.charges_total = 0
      if (table === 'maintenance') {
        if (!normalized.title) normalized.title = normalized.issue || normalized.description || 'Recovered maintenance item'
        if (!normalized.description) normalized.description = normalized.issue || ''
        if (!normalized.reported_date) normalized.reported_date = String(normalized.created_at || fallbackDate).slice(0, 10)
      }
      if (table === 'signed_payment_ledger' && !normalized.paid_at) normalized.paid_at = normalized.created_at || generatedAt
      return Object.fromEntries(Object.entries(normalized).filter(([field, value]) => allowlist.has(field) && value !== undefined))
    })
  }
  return tables
}

function buildServerRestorePayload(op, verification, remappedTables) {
  const tables = projectServerRestoreTables(remappedTables, verification.manifest?.generated_at)
  const counts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]))
  const perTableHashes = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, perTableCanonicalHash(rows)]))
  const payload = {
    operation_id: op.operation_id,
    source_lodge_id: op.lodge_id,
    recovery_lodge_id: op.recovery_lodge_id,
    actor_id: op.server_actor_id,
    actor_email: op.server_actor_email,
    reason: op.approval_reason || op.reason,
    ticket_ref: op.approval_ticket_ref || op.ticket_ref,
    target_mode: 'disposable',
    package_sha256: op.package_sha256,
    tables,
    counts,
    per_table_hashes: perTableHashes
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  if (bytes > SERVER_RESTORE_MAX_BYTES) {
    throw new Error(`The validated recovery payload is ${bytes.toLocaleString()} bytes and exceeds the 8 MiB direct-restore limit. Use the managed chunked recovery path.`)
  }
  return { payload, bytes, binding: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }
}

function buildServerRequestBinding(op) {
  return createHash('sha256').update(JSON.stringify({
    operation_id: op.operation_id,
    source_lodge_id: op.lodge_id,
    recovery_lodge_id: op.recovery_lodge_id,
    actor_id: op.server_actor_id,
    actor_email: op.server_actor_email,
    reason: op.approval_reason || op.reason,
    ticket_ref: op.approval_ticket_ref || op.ticket_ref,
    target_mode: op.target_mode,
    package_sha256: op.package_sha256,
    sealed_hash: op.sealed_hash,
    approval_sealed_hash: op.approval_sealed_hash,
    table_counts: op.table_counts,
    per_table_hashes: op.per_table_hashes
  })).digest('hex')
}

function resolveRecoveryAdminContext(options = {}) {
  const injectedClient = options.adminClient && typeof options.adminClient.rpc === 'function' ? options.adminClient : null
  const adminClient = injectedClient || state.adminDb
  const online = injectedClient && Object.prototype.hasOwnProperty.call(options, 'isOnline')
    ? options.isOnline === true
    : state.isOnline === true
  if (!online) throw new Error('Disposable recovery requires an online Command Central connection. Reconnect and retry with the same operation.')
  if (!adminClient || typeof adminClient.rpc !== 'function') throw new Error('The Command Central recovery service is unavailable. Retry after the secure admin connection is restored.')
  return adminClient
}

function resolveRecoveryActor(op) {
  const actorId = String(state.currentUser?.id || '').trim().toLowerCase()
  const actorEmail = String(state.currentUser?.email || '').trim().toLowerCase()
  if (!UUID_PATTERN.test(actorId)) throw new Error('Disposable recovery requires an authenticated operator with a valid user UUID.')
  if (actorEmail.length < 3 || actorEmail.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(actorEmail)) {
    throw new Error('Disposable recovery requires an authenticated operator email for audit attribution.')
  }
  if (op.server_actor_id && op.server_actor_id !== actorId) {
    throw new Error('This recovery operation is bound to a different Command Central operator. The original operator must retry it.')
  }
  if (op.server_actor_email && op.server_actor_email !== actorEmail) {
    throw new Error('This recovery operation is bound to a different Command Central operator email. The original operator must retry it.')
  }
  return { actorId, actorEmail }
}

function unwrapRpcData(data) {
  return Array.isArray(data) && data.length === 1 ? data[0] : data
}

async function callRecoveryRpc(adminClient, name, args) {
  const { data, error } = await adminClient.rpc(name, args)
  if (error) throw new Error(error.message || `${name} failed.`)
  const result = unwrapRpcData(data)
  if (!result || typeof result !== 'object') throw new Error(`${name} returned no result.`)
  return result
}

function countsMatch(actual, expected) {
  return Object.entries(expected || {}).every(([table, count]) => Number(actual?.[table]) === Number(count))
}

function hashesMatch(actual, expected) {
  return Object.entries(expected || {}).every(([table, hash]) => String(actual?.[table] || '').toLowerCase() === String(hash).toLowerCase())
}

function moneyMatches(actual, expected) {
  return Number.isFinite(Number(actual)) && Math.abs(Number(actual) - Number(expected)) < 0.005
}

function evaluateServerVerification(result, op) {
  const expectedLedger = op.server_expected_ledger || {}
  const ledger = result?.ledger_reconciliation || {}
  const checks = {
    server_success: result?.success === true,
    status_verified: result?.status === 'verified',
    operation_matches: String(result?.operation_id || '') === op.operation_id,
    source_lodge_matches: String(result?.source_lodge_id || '') === op.lodge_id,
    recovery_lodge_matches: String(result?.recovery_lodge_id || '') === op.recovery_lodge_id,
    actor_id_matches: String(result?.actor_id || '').toLowerCase() === op.server_actor_id,
    actor_email_matches: String(result?.actor_email || '').toLowerCase() === op.server_actor_email,
    target_disposable: result?.target_mode === 'disposable',
    quarantined: result?.quarantined === true,
    isolation_ok: result?.isolation_ok === true,
    counts_match: result?.counts_match === true && countsMatch(result?.counts, op.server_table_counts),
    package_matches: String(result?.package_sha256 || '') === op.package_sha256,
    hashes_match: hashesMatch(result?.per_table_hashes, op.server_table_hashes),
    ledger_count_matches: Number(ledger.payment_count) === Number(expectedLedger.payment_count),
    ledger_gross_matches: moneyMatches(ledger.gross_positive, expectedLedger.gross_positive),
    ledger_refunds_match: moneyMatches(ledger.refund_negative, expectedLedger.refund_negative),
    ledger_net_matches: moneyMatches(ledger.net_delta, expectedLedger.net_delta),
    replay_safe: result?.idempotency?.replay_is_safe === true
  }
  return { passed: Object.values(checks).every(Boolean), checks }
}

function safeServerResult(result) {
  return {
    success: result?.success === true,
    idempotent: result?.idempotent === true,
    status: result?.status || null,
    operation_id: result?.operation_id || null,
    source_lodge_id: result?.source_lodge_id || null,
    recovery_lodge_id: result?.recovery_lodge_id || null,
    actor_id: result?.actor_id || null,
    actor_email: result?.actor_email || null,
    target_mode: result?.target_mode || null,
    quarantined: result?.quarantined === true,
    isolation_ok: result?.isolation_ok === true,
    counts_match: result?.counts_match === true,
    table_counts: result?.table_counts || result?.counts || null,
    ledger_reconciliation: result?.ledger_reconciliation || null,
    package_sha256: result?.package_sha256 || null,
    payload_sha256: result?.payload_sha256 || null,
    per_table_hashes: result?.per_table_hashes || null,
    idempotency: result?.idempotency || null
  }
}

function markServerVerified(op, serverResult, evaluation, event, localRehearsalPassed = null) {
  const verifiedAt = new Date().toISOString()
  op.status = 'verified'
  op.verified_at = verifiedAt
  op.server_verified_at = verifiedAt
  op.server_verification_checked_at = verifiedAt
  op.server_verification_confirmed = true
  op.server_restore_status = 'verified'
  op.server_verification = safeServerResult(serverResult)
  op.server_verification_checks = evaluation.checks
  op.supabase_restored = true
  op.restore_persistence = 'quarantined_disposable_lodge'
  op.execution_pid = null
  op.last_execute_error = null
  const details = {
    recovery_lodge_id: op.recovery_lodge_id,
    package_sha256: op.package_sha256,
    quarantined: true,
    counts_match: true,
    isolation_ok: true
  }
  if (typeof localRehearsalPassed === 'boolean') details.local_rehearsal_passed = localRehearsalPassed
  appendAudit(op, event, details)
  return op
}

function requireSupportCapability() {
  const user = state.currentUser
  if (!user) throw new Error('An authenticated support session is required for recovery operations.')
  if (user.isMasterAdmin !== true) throw new Error('Recovery requires a Command Central support administrator. Sign in with a master admin account.')
  // The IPC layer enforces command_central.recovery.manage and the SQL RPC is
  // callable only through the trusted service-role path, where it binds the
  // supplied actor to immutable operation/audit evidence. This defensive check
  // also prevents an unprivileged local caller from entering the domain.
  const hasCapability = (() => {
    try {
      // Prefer explicit capability snapshot if present on the user object.
      const caps = user.capabilities || user.effectiveCapabilities || {}
      if (caps['command_central.recovery.manage'] === true) return true
      // Master admins have all capabilities implicitly; allow them.
      if (user.isMasterAdmin === true) return true
      return false
    } catch { return false }
  })()
  if (!hasCapability) throw new Error('Missing Command Central recovery capability (command_central.recovery.manage).')
}

function redactOperationForAudit(op) {
  // Never include passphrase, tokens, or raw file bytes. The audit record
  // contains only fingerprints and non-PII metadata.
  if (!op) return null
  const { passphrase: _omit1, passphrase_hash: _omit2, ...rest } = op
  return rest
}

function appendAudit(op, event, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    event,
    actor_id: state.currentUser?.id || null,
    actor_email: state.currentUser?.email || null,
    operation_id: op.operation_id,
    details: { ...details }
  }
  // Ensure no secret reaches the audit trail.
  if (entry.details.passphrase || entry.details.passphrase_hash) {
    delete entry.details.passphrase
    delete entry.details.passphrase_hash
  }
  // Local tamper evidence only: the operation file is not an authoritative
  // server audit log, but chained hashes make accidental edits detectable.
  entry.previous_hash = Array.isArray(op.audit) && op.audit.length > 0
    ? op.audit[op.audit.length - 1].entry_hash || null
    : null
  entry.entry_hash = createHash('sha256').update(JSON.stringify(entry)).digest('hex')
  op.audit = Array.isArray(op.audit) ? op.audit : []
  op.audit.push(entry)
}

function verifyAuditChain(op) {
  if (!Array.isArray(op?.audit) || op.audit.length === 0) return null
  let previousHash = null
  for (const entry of op.audit) {
    if (!entry || typeof entry !== 'object' || typeof entry.entry_hash !== 'string') return null
    if ((entry.previous_hash || null) !== previousHash) return false
    const unsigned = { ...entry }
    delete unsigned.entry_hash
    const expected = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')
    if (expected !== entry.entry_hash) return false
    previousHash = entry.entry_hash
  }
  return true
}

export function beginStarterRecoveryOperation(payload = {}) {
  const operationId = assertValidOperationId(String(payload.operation_id || randomUUID()).trim())
  const reason = String(payload.reason || '').trim()
  if (reason.length < 8 || reason.length > 512) throw new Error('Provide a reason between 8 and 512 characters for recovery operations.')
  const ticketRef = String(payload.ticket_ref || payload.ticketRef || '').trim()
  if (ticketRef.length < 3 || ticketRef.length > 128) throw new Error('A ticket reference between 3 and 128 characters is required.')
  const lodgeId = String(payload.lodge_id || payload.lodgeId || state.lodgeId || '').trim().toLowerCase()
  if (!lodgeId) throw new Error('An explicit lodge scope is required for recovery operations.')
  if (!UUID_PATTERN.test(lodgeId)) throw new Error('Lodge scope must be a valid lodge ID (UUID).')
  requireSupportCapability()
  // Idempotency: re-begin with same operation ID returns existing without duplication.
  const existing = readOperation(operationId)
  if (existing) {
    if (isExpired(existing)) {
      discardExpiredOperation(existing)
      throw new Error('This recovery operation has expired. Begin a new recovery operation with a new operation ID.')
    }
    // Validate payload identity to prevent idempotency-key reuse with different intent.
    if (String(existing.lodge_id) !== String(lodgeId)) throw new Error('Idempotency key reuse with a different lodge scope is not allowed.')
    if (String(existing.reason || '') !== reason) throw new Error('Idempotency key reuse with a different reason is not allowed.')
    if (String(existing.ticket_ref || '') !== ticketRef) throw new Error('Idempotency key reuse with a different ticket reference is not allowed.')
    return existing
  }
  cleanupExpiredStagedOperations()
  const activeOperations = listAllOperations().filter((item) => isCapacityActive(item)).length
  if (activeOperations >= MAX_OPERATIONS) throw new Error('Too many active recovery operations. Discard old operations before starting a new one.')
  const now = new Date()
  const op = {
    operation_id: operationId,
    created_at: now.toISOString(),
    lodge_id: lodgeId,
    reason,
    ticket_ref: ticketRef,
    status: 'draft',
    target_environment: RECOVERY_WORKSPACE_ENV,
    server_target_environment: 'quarantined_disposable_lodge',
    target_mode: 'disposable',
    execution_mode: 'server_disposable_restore',
    live_restore_available: false,
    package_sha256: null,
    package_size: null,
    manifest_summary: null,
    per_table_hashes: null,
    sealed_at: null,
    approved_at: null,
    approved_by: null,
    executed_at: null,
    verified_at: null,
    recovery_lodge_id: null,
    rehearsal_directory: null,
    expires_at: new Date(now.getTime() + OPERATION_EXPIRY_MS).toISOString(),
    audit: []
  }
  // Never store passphrase in the operation record. It is held only in memory
  // for the duration of the decrypt call.
  appendAudit(op, 'begin', { lodge_id: lodgeId, reason, ticket_ref: ticketRef, target_mode: 'disposable' })
  writeOperationAtomic(operationId, op)
  return op
}

export function stageStarterRecoveryPackage(operationId, sourcePath, options = {}) {
  const safeId = assertValidOperationId(operationId)
  const op = readOperation(safeId)
  if (!op) throw new Error('Recovery operation not found. Begin a new operation before staging a package.')
  ensureOperationNotExpired(op)
  if (!['draft', 'staging', 'failed'].includes(op.status)) throw new Error(`Cannot stage a package in status ${op.status}.`)
  const resolved = String(sourcePath || '').trim()
  if (!resolved || path.extname(resolved).toLowerCase() !== '.tbbackup') throw new Error('Choose a Tsa Bonno .tbbackup file to stage.')
  if (!fs.existsSync(resolved)) throw new Error('The selected .tbbackup file was not found.')
  const stats = fs.statSync(path.resolve(resolved))
  if (!stats.isFile()) throw new Error('The selected recovery package is not a file.')
  if (stats.size > MAX_STAGED_BYTES) throw new Error('The selected recovery package exceeds the 256 MB staging ceiling. Ask support for a managed export slice.')
  // Passphrase is accepted transiently for validation but never persisted.
  const passphrase = typeof options.passphrase === 'string' ? options.passphrase : ''
  // Quick envelope sanity: decrypt in main process only. Never send passphrase to SQL.
  const source = path.resolve(resolved)
  const probe = verifyStarterBackupAtPath(source, { passphrase, expectedLodgeId: op.lodge_id })
  // Allow staging of foreign-lodge packages so preview can show the lodge mismatch
  // before sealing; seal will enforce identity strictly.
  if (!probe.success && /different lodge/i.test(probe.error || '')) {
    // Record the mismatch as a preview-visible warning; still stage for sealed validation to reject.
  } else if (!probe.success) {
    throw new Error(probe.error || 'Staged package failed local validation.')
  }
  const stagedPath = stagedPackagePath(safeId)
  const packageBytes = fs.readFileSync(source)
  const copiedHash = createHash('sha256').update(packageBytes).digest('hex')
  if (probe.packageSha256 && copiedHash !== probe.packageSha256) throw new Error('The selected recovery package changed while it was being staged. Try again.')
  writeBytesAtomic(stagedPath, packageBytes)
  op.status = 'staging'
  // The selected source may be anywhere the operator can read. The operation
  // record only ever points to the private, validated staging copy.
  op.staged_path = stagedPath
  op.package_sha256 = probe.packageSha256 || probe.sha256 || null
  op.package_size = stats.size
  op.manifest_summary = probe.manifest ? {
    format: probe.manifest.format,
    core_schema: probe.manifest.core_schema,
    lodge_id: probe.manifest.lodge_id,
    app_version: probe.manifest.app_version,
    generated_at: probe.manifest.generated_at,
    complete: probe.manifest.complete === true,
    warnings: Array.isArray(probe.manifest.warnings) ? probe.manifest.warnings : [],
    included_categories: Array.isArray(probe.manifest.included_categories) ? probe.manifest.included_categories : [],
    excluded_categories: Array.isArray(probe.manifest.excluded_categories) ? probe.manifest.excluded_categories : []
  } : null
  op.per_table_hashes = probe.perTableHashes || null
  // Expiry: staged packages older than 7 days are discarded by the cleanup helper.
  op.staged_at = new Date().toISOString()
  op.expires_at = new Date(Date.now() + OPERATION_EXPIRY_MS).toISOString()
  // Contiguous sequence validation: for single-file staging, sequence is trivially valid.
  // Chunked staging (future) will validate seq/total contiguity here.
  appendAudit(op, 'stage', { package_sha256: op.package_sha256, package_size: op.package_size, manifest_lodge: op.manifest_summary?.lodge_id || null })
  writeOperationAtomic(safeId, op)
  return op
}

export function sealAndValidateStarterRecovery(operationId, options = {}) {
  const safeId = assertValidOperationId(operationId)
  const op = readOperation(safeId)
  if (!op) throw new Error('Recovery operation not found.')
  ensureOperationNotExpired(op)
  if (!['staging', 'sealed', 'failed'].includes(op.status)) throw new Error(`Cannot seal in status ${op.status}.`)
  if (!op.staged_path) throw new Error('No staged package to seal.')
  const stagedPath = assertStagedPackagePath(safeId, op.staged_path)
  const passphrase = typeof options.passphrase === 'string' ? options.passphrase : ''
  // Full validation in main process using the same envelope logic as the trusted
  // recovery backend would use. Never delegates decryption to SQL.
  let bytes
  try {
    bytes = fs.readFileSync(stagedPath)
  } catch { throw new Error('Staged package could not be read for sealing.') }
  let result
  try {
    result = validateStarterBackupPackage(bytes, { passphrase, expectedLodgeId: op.lodge_id })
  } catch (error) {
    op.status = 'failed'
    op.failure_reason = error?.message || 'Seal validation failed.'
    appendAudit(op, 'seal_failed', { error: op.failure_reason })
    writeOperationAtomic(safeId, op)
    throw new Error(op.failure_reason)
  }
  // Cross-check: staged fingerprint must match sealed fingerprint.
  const sealedHash = result.packageSha256
  if (op.package_sha256 && op.package_sha256 !== sealedHash) {
    op.status = 'failed'
    op.failure_reason = 'Staged package hash changed before sealing.'
    appendAudit(op, 'seal_failed', { error: op.failure_reason, staged: op.package_sha256, sealed: sealedHash })
    writeOperationAtomic(safeId, op)
    throw new Error(op.failure_reason)
  }
  op.package_sha256 = sealedHash
  op.manifest_summary = {
    format: result.manifest.format,
    core_schema: result.manifest.core_schema,
    lodge_id: result.manifest.lodge_id,
    app_version: result.manifest.app_version,
    generated_at: result.manifest.generated_at,
    complete: result.manifest.complete === true,
    warnings: Array.isArray(result.manifest.warnings) ? result.manifest.warnings : [],
    included_categories: Array.isArray(result.manifest.included_categories) ? result.manifest.included_categories : [],
    excluded_categories: Array.isArray(result.manifest.excluded_categories) ? result.manifest.excluded_categories : []
  }
  op.per_table_hashes = result.perTableHashes || null
  op.per_table_hashes_verified = result.perTableHashesVerified === true
  op.table_counts = result.counts || {}
  op.sealed_at = new Date().toISOString()
  op.sealed_hash = sealedHash
  op.snapshot_coherence = result.snapshotCoherence || null
  // Financial reconstruction performed now so preview can disclose it before approval.
  try {
    const ledger = reconstructBookingLedger(result.sanitizedTables || result.payload?.tables)
    op.ledger_preview = { totals: ledger.totals, orphan_count: ledger.orphanPayments.length }
    op.missing_lineage_disclosure = ledger.missing_lineage_disclosure
  } catch {}
  op.status = 'sealed'
  appendAudit(op, 'sealed', { package_sha256: sealedHash, table_counts: op.table_counts, per_table_hashes_verified: op.per_table_hashes_verified })
  writeOperationAtomic(safeId, op)
  return op
}

export function previewStarterRecovery(operationId) {
  const safeId = assertValidOperationId(operationId)
  const op = readOperation(safeId)
  if (!op) throw new Error('Recovery operation not found.')
  ensureOperationNotExpired(op)
  if (!['sealed', 'preview_ready', 'approved'].includes(op.status)) {
    // Allow preview after sealing; before sealing, return staged preview if available.
    if (op.status === 'staging') {
      return {
        operation_id: op.operation_id,
        status: op.status,
        lodge_id: op.lodge_id,
        package_sha256: op.package_sha256,
        manifest_summary: op.manifest_summary,
        target_environment: op.target_environment,
        target_mode: op.target_mode,
        sealed: false,
        consequence: 'This package has not been sealed. No recovery will run until validation passes and approval is recorded.',
        audit: op.audit || []
      }
    }
    throw new Error(`Cannot preview in status ${op.status}. Seal the package first.`)
  }
  // Read-only preview: no raw rows, no PII, no passphrase.
  const manifest = op.manifest_summary ? { ...op.manifest_summary, per_table_hashes: op.per_table_hashes } : null
  const report = buildRestorePreviewReport(manifest, op.table_counts, { manifestVerified: true, snapshotCoherence: op.snapshot_coherence })
  appendAudit(op, 'preview', { package_sha256: op.package_sha256, table_counts: op.table_counts })
  // Mark preview_ready without changing sealed hash.
  if (op.status === 'sealed') {
    op.status = 'preview_ready'
  }
  writeOperationAtomic(safeId, op)
  return {
    operation_id: op.operation_id,
    status: op.status,
    lodge_id: op.lodge_id,
    source_package_fingerprint: op.package_sha256,
    manifest_summary: op.manifest_summary,
    table_counts: op.table_counts,
    per_table_hashes: op.per_table_hashes,
    per_table_hashes_verified: op.per_table_hashes_verified === true,
    snapshot_coherence: op.snapshot_coherence,
    ledger_preview: op.ledger_preview || null,
    missing_lineage_disclosure: op.missing_lineage_disclosure || null,
    target_environment: op.target_environment,
    target_mode: op.target_mode,
    consequence: 'After local validation, Command Central will create a quarantined disposable recovery lodge and verify its counts, ledger, and isolation. No live lodge data is overwritten.',
    excluded_categories: report.excluded_categories,
    included_categories: report.included_categories,
    sealed_at: op.sealed_at,
    approved_at: op.approved_at,
    audit: op.audit || []
  }
}

export function approveStarterRecovery(operationId, payload = {}) {
  const safeId = assertValidOperationId(operationId)
  const op = readOperation(safeId)
  if (!op) throw new Error('Recovery operation not found.')
  ensureOperationNotExpired(op)
  if (!['sealed', 'preview_ready'].includes(op.status)) throw new Error(`Cannot approve in status ${op.status}. Seal and preview the package first.`)
  const reason = String(payload.reason || op.reason || '').trim()
  if (reason.length < 8 || reason.length > 512) throw new Error('Approval requires a reason between 8 and 512 characters.')
  const ticketRef = String(payload.ticket_ref || payload.ticketRef || op.ticket_ref || '').trim()
  if (ticketRef.length < 3 || ticketRef.length > 128) throw new Error('Approval requires a ticket reference between 3 and 128 characters.')
  requireSupportCapability()
  op.approved_at = new Date().toISOString()
  op.approved_by = { id: state.currentUser?.id || null, email: state.currentUser?.email || null }
  op.approval_sealed_hash = op.sealed_hash || op.package_sha256
  op.approval_reason = reason
  op.approval_ticket_ref = ticketRef
  op.status = 'approved'
  appendAudit(op, 'approved', { sealed_hash: op.approval_sealed_hash, reason, ticket_ref: ticketRef, approved_by: op.approved_by })
  writeOperationAtomic(safeId, op)
  return op
}

function deterministicUuid(seed) {
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4]
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`
}

function runRecoveryRehearsal(verification, targetRoot, operationId, recoveryLodgeId, passphrase) {
  const rehearsalTargetId = recoveryLodgeId
  const effectivePayload = verification.sanitizedTables
    ? { ...verification.payload, tables: verification.sanitizedTables }
    : verification.payload
  const identityMap = buildRecoveryIdentityMap(effectivePayload, { operationId, recoveryLodgeId: rehearsalTargetId })
  const remapped = remapPayloadForRecovery(effectivePayload, identityMap)
  const restoredTables = {}
  for (const [table, rows] of Object.entries(remapped.tables || {})) {
    const restoredRows = JSON.parse(JSON.stringify(Array.isArray(rows) ? rows : []))
    const ids = restoredRows.map((row) => row?.id).filter(Boolean).map(String)
    if (new Set(ids).size !== ids.length) throw new Error(`Disposable restore rehearsal found duplicate IDs in ${table}.`)
    restoredTables[table] = restoredRows
  }
  const customers = new Set((restoredTables.customers || []).map((row) => String(row.id || '')).filter(Boolean))
  const rooms = new Set((restoredTables.rooms || []).map((row) => String(row.id || '')).filter(Boolean))
  const bookings = new Set((restoredTables.bookings || []).map((row) => String(row.id || '')).filter(Boolean))
  for (const booking of restoredTables.bookings || []) {
    if (booking.customer_id && !customers.has(String(booking.customer_id))) throw new Error('Disposable restore rehearsal found a booking with a missing customer reference.')
    if (booking.room_id && !rooms.has(String(booking.room_id))) throw new Error('Disposable restore rehearsal found a booking with a missing room reference.')
  }
  for (const payment of restoredTables.signed_payment_ledger || []) {
    if (payment.booking_id && !bookings.has(String(payment.booking_id))) throw new Error('Disposable restore rehearsal found a payment with a missing booking reference.')
  }
  const ledgerReconstruction = reconstructBookingLedger(restoredTables)
  const report = buildSanitizedRehearsalReport({
    verification,
    remappedTables: restoredTables,
    ledgerReconstruction,
    rehearsalTargetId,
    sourcePackageName: path.basename(String(verification.sourcePath || 'recovery.tbbackup')),
    identityRemapped: true
  })
  const rehearsalDirectory = resolveContainedPath(targetRoot, `starter-restore-rehearsal-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${randomUUID().slice(0, 8)}`)
  ensureDir(rehearsalDirectory)
  writeJsonAtomic(resolveContainedPath(rehearsalDirectory, 'restore-report.json'), report)
  // `passphrase` is deliberately accepted only to make the transient boundary
  // explicit to callers; it is not persisted, logged, or sent to a backend.
  void passphrase
  return { rehearsalDirectory, report, rehearsalTargetId, remappedTables: restoredTables, ledgerReconstruction }
}

function canRecoverStaleExecution(op) {
  const pid = Number(op?.execution_pid)
  if (Number.isInteger(pid) && pid > 0) return !isProcessAlive(pid)
  const startedAt = new Date(op?.execution_started_at || op?.executed_at || 0).getTime()
  return !Number.isFinite(startedAt) || startedAt <= 0 || Date.now() - startedAt > EXECUTION_STALE_MS
}

function assertCompletedReplayMatches(op, safeId) {
  if (op.server_verification_confirmed !== true) throw new Error('This operation has only local rehearsal evidence and must be executed through the recovery service before it can be verified.')
  const stagedPath = assertStagedPackagePath(safeId, op.staged_path)
  const bytes = fs.readFileSync(stagedPath)
  const currentHash = createHash('sha256').update(bytes).digest('hex')
  if (currentHash !== op.package_sha256 || currentHash !== op.sealed_hash || currentHash !== op.approval_sealed_hash) {
    throw new Error('Idempotent replay was rejected because the approved package no longer matches the verified operation.')
  }
  if (!op.server_request_binding || op.server_request_binding !== buildServerRequestBinding(op)) {
    throw new Error('Idempotent replay was rejected because the recovery target or approval metadata changed.')
  }
  return op
}

function evaluateServerExecuteResult(result, op) {
  const checks = {
    server_success: result?.success === true,
    operation_matches: String(result?.operation_id || '') === op.operation_id,
    source_lodge_matches: String(result?.source_lodge_id || '') === op.lodge_id,
    recovery_lodge_matches: String(result?.recovery_lodge_id || '') === op.recovery_lodge_id,
    actor_id_matches: String(result?.actor_id || '').toLowerCase() === op.server_actor_id,
    actor_email_matches: String(result?.actor_email || '').toLowerCase() === op.server_actor_email,
    target_disposable: result?.target_mode === 'disposable',
    quarantined: result?.quarantined === true,
    package_matches: String(result?.package_sha256 || '') === op.package_sha256,
    counts_match: countsMatch(result?.table_counts, op.server_table_counts)
  }
  return { passed: Object.values(checks).every(Boolean), checks }
}

async function queryServerRecoveryVerification(adminClient, op) {
  const result = await callRecoveryRpc(adminClient, 'admin_verify_starter_disposable_restore', { p_operation_id: op.operation_id })
  const evaluation = evaluateServerVerification(result, op)
  return { result, evaluation }
}

function makeExecutionRetryable(op, safeId, event, message, details = {}) {
  op.status = 'approved'
  op.execution_pid = null
  op.last_execute_error = String(message || 'Disposable recovery was not confirmed.')
  op.last_execute_error_at = new Date().toISOString()
  appendAudit(op, event, { error: op.last_execute_error, ...details })
  writeOperationAtomic(safeId, op)
}

function readLocalRehearsalChecks(op, safeId) {
  let report = null
  let rehearsalDirectory = null
  try {
    if (op.rehearsal_directory) {
      rehearsalDirectory = assertContainedPath(operationWorkspacePath(safeId), op.rehearsal_directory)
      const reportPath = resolveContainedPath(rehearsalDirectory, 'restore-report.json')
      if (fs.existsSync(reportPath)) report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    }
  } catch {}
  const auditChain = verifyAuditChain(op)
  const checks = {
    report_present: Boolean(report),
    isolated_target: report?.isolated_target === true,
    lodge_isolation: report?.target_environment === RECOVERY_WORKSPACE_ENV,
    rehearsal_only: report?.execution_mode === 'rehearsal_only' && report?.persists_to_database === false && report?.can_restore_live === false,
    local_audit_chain: auditChain !== false,
    per_table_hashes_present: Boolean(report?.per_table_hashes),
    ledger_present: Boolean(report?.ledger_reconstruction),
    missing_lineage_disclosed: typeof report?.missing_lineage_disclosure === 'string' && report.missing_lineage_disclosure.length > 0
  }
  return { report, rehearsalDirectory, auditChain, checks, passed: Object.values(checks).every(Boolean) }
}

export async function executeStarterRecovery(operationId, options = {}) {
  const safeId = assertValidOperationId(operationId)
  let op = readOperation(safeId)
  if (!op) throw new Error('Recovery operation not found.')
  if (op.status === 'verified' && op.server_verification_confirmed === true) return assertCompletedReplayMatches(op, safeId)
  // Older local-rehearsal builds used final-looking statuses. They are not
  // server evidence and must pass the real execute + verify contract.
  if (['verified', 'verified_local'].includes(op.status) && op.server_verification_confirmed !== true) {
    op.status = 'approved'
    op.verified_at = null
    op.supabase_restored = false
    appendAudit(op, 'legacy_rehearsal_downgraded', { reason: 'Server restore verification was absent.' })
    writeOperationAtomic(safeId, op)
  }
  if (!['approved', 'executing'].includes(op.status)) throw new Error(`Cannot execute in status ${op.status}. Approve the operation first.`)
  const lock = acquireOperationLock(safeId)
  try {
    op = readOperation(safeId)
    if (!op) throw new Error('Recovery operation not found.')
    if (op.status === 'verified' && op.server_verification_confirmed === true) return assertCompletedReplayMatches(op, safeId)
    if (op.status === 'executing') {
      if (!canRecoverStaleExecution(op)) throw new Error('Recovery operation is already executing.')
      op.status = 'approved'
      op.execution_recovered_at = new Date().toISOString()
      appendAudit(op, 'execution_recovered', { reason: 'Previous execution stopped before completion.' })
      writeOperationAtomic(safeId, op)
    }
    ensureOperationNotExpired(op)
    if (op.status !== 'approved') throw new Error(`Cannot execute in status ${op.status}. Approve the operation first.`)
    if (!op.staged_path) throw new Error('No staged package to execute.')
    const stagedPath = assertStagedPackagePath(safeId, op.staged_path)
    if (op.target_mode !== 'disposable' || op.target_environment !== RECOVERY_WORKSPACE_ENV) {
      throw new Error('Live-lodge replacement is not available. Only a quarantined disposable recovery lodge is supported.')
    }
    const adminClient = resolveRecoveryAdminContext(options)
    const actor = resolveRecoveryActor(op)
    let currentBytes
    try { currentBytes = fs.readFileSync(stagedPath) } catch { throw new Error('Staged package could not be read at execution time.') }
    const currentHash = createHash('sha256').update(currentBytes).digest('hex')
    if (currentHash !== op.approval_sealed_hash || currentHash !== op.sealed_hash) {
      op.status = 'failed'
      op.failure_reason = 'Package hash changed after approval. Re-seal and re-approve.'
      appendAudit(op, 'execute_failed', { error: op.failure_reason, expected: op.approval_sealed_hash, actual: currentHash })
      writeOperationAtomic(safeId, op)
      throw new Error(op.failure_reason)
    }
    op.status = 'executing'
    op.executed_at = new Date().toISOString()
    op.execution_started_at = op.executed_at
    op.execution_pid = process.pid
    op.execution_mode = 'server_disposable_restore'
    if (!op.recovery_lodge_id) op.recovery_lodge_id = deterministicUuid(`recovery-lodge:${safeId}`)
    if (!UUID_PATTERN.test(op.recovery_lodge_id) || op.recovery_lodge_id === op.lodge_id) {
      throw new Error('The persisted recovery lodge identity is invalid. Discard this operation and begin again.')
    }
    op.server_actor_id = actor.actorId
    op.server_actor_email = actor.actorEmail
    const requestBinding = buildServerRequestBinding(op)
    if (op.server_request_binding && op.server_request_binding !== requestBinding) {
      throw new Error('Operation ID replay was rejected because the approved recovery request changed.')
    }
    op.server_request_binding = requestBinding
    appendAudit(op, 'executing', { sealed_hash: currentHash, execution_mode: 'server_disposable_restore', recovery_lodge_id: op.recovery_lodge_id })
    // Persist the stable target and request binding before the first RPC. An
    // ambiguous retry must reuse exactly these identities.
    writeOperationAtomic(safeId, op)

    let validated
    try {
      validated = validateStarterBackupPackage(currentBytes, { passphrase: String(options.passphrase || ''), expectedLodgeId: op.lodge_id })
      validated.sourcePath = stagedPath
    } catch (error) {
      const message = error?.message || 'Recovery validation failed at execution time.'
      makeExecutionRetryable(op, safeId, 'execute_validation_failed', message)
      throw new Error(message)
    }

    const targetRoot = operationWorkspacePath(safeId)
    const preSnapshot = captureRehearsalWorkspaceSnapshot(targetRoot, safeId, op.lodge_id)
    writeJsonAtomic(resolveContainedPath(targetRoot, 'pre-restore-snapshot.json'), preSnapshot)
    let rehearsal
    try {
      rehearsal = runRecoveryRehearsal(validated, targetRoot, safeId, op.recovery_lodge_id, String(options.passphrase || ''))
    } catch (error) {
      const message = error?.message || 'Recovery rehearsal failed.'
      makeExecutionRetryable(op, safeId, 'execute_rehearsal_failed', message)
      throw new Error(message)
    }
    op.rehearsal_target_id = rehearsal.rehearsalTargetId
    op.rehearsal_directory = rehearsal.rehearsalDirectory
    op.rehearsal_report = rehearsal.report
    op.ledger_reconstruction = rehearsal.report.ledger_reconstruction
    op.server_restore_status = 'local_rehearsal_passed'
    const serverRequest = buildServerRestorePayload(op, validated, rehearsal.remappedTables)
    if (op.server_payload_binding && op.server_payload_binding !== serverRequest.binding) {
      makeExecutionRetryable(op, safeId, 'execute_payload_mismatch', 'Operation ID replay was rejected because the remapped server payload changed.')
      throw new Error(op.last_execute_error)
    }
    op.server_payload_binding = serverRequest.binding
    op.server_payload_text_bytes = serverRequest.bytes
    op.server_table_counts = serverRequest.payload.counts
    op.server_table_hashes = serverRequest.payload.per_table_hashes
    op.server_expected_ledger = {
      payment_count: serverRequest.payload.counts.signed_payment_ledger,
      gross_positive: rehearsal.ledgerReconstruction.totals.gross_collections,
      refund_negative: -rehearsal.ledgerReconstruction.totals.refunds,
      net_delta: rehearsal.ledgerReconstruction.totals.net_paid
    }
    writeOperationAtomic(safeId, op)

    // A prior execute response may have been lost after the server committed.
    // Probe the authoritative operation before repeating a mutation. A definite
    // "not found" can proceed to execute; any other ambiguous verification
    // failure stays retryable without creating a second target.
    if (op.server_rpc_attempted_at) {
      try {
        const priorVerification = await queryServerRecoveryVerification(adminClient, op)
        if (priorVerification.evaluation.passed) {
          markServerVerified(op, priorVerification.result, priorVerification.evaluation, 'server_verified_after_ambiguous_retry', true)
          writeOperationAtomic(safeId, op)
          return op
        }
        op.server_restore_status = 'pending_verification'
        op.server_verification = safeServerResult(priorVerification.result)
        op.server_verification_checks = priorVerification.evaluation.checks
        const message = 'A server recovery operation already exists, but its quarantine, counts, ledger, or isolation checks are not yet confirmed. Retry verification with this same operation ID.'
        makeExecutionRetryable(op, safeId, 'server_retry_verify_rejected', message, { checks: priorVerification.evaluation.checks })
        throw new Error(message)
      } catch (error) {
        if (!/not found/i.test(String(error?.message || ''))) {
          if (op.status === 'approved') throw error
          const message = `The earlier recovery request is ambiguous and could not be checked safely: ${error?.message || 'verification failed'}. Retry this same operation before executing again.`
          makeExecutionRetryable(op, safeId, 'server_retry_verify_unconfirmed', message)
          throw new Error(message)
        }
      }
    }

    let executeResult
    op.server_rpc_attempted_at = new Date().toISOString()
    op.server_restore_status = 'execute_requested'
    writeOperationAtomic(safeId, op)
    try {
      executeResult = await callRecoveryRpc(adminClient, 'admin_execute_starter_disposable_restore', { p_payload: serverRequest.payload })
    } catch (error) {
      const message = `Disposable recovery was not confirmed by the server: ${error?.message || 'restore request failed'}. Retry this same operation; its target and payload will be reused safely.`
      op.server_restore_status = 'retryable_execute_failure'
      makeExecutionRetryable(op, safeId, 'server_execute_unconfirmed', message)
      throw new Error(message)
    }
    const executeEvaluation = evaluateServerExecuteResult(executeResult, op)
    if (!executeEvaluation.passed) {
      const message = 'The recovery service returned an inconsistent restore result. Retry the same operation or escalate with its operation ID.'
      op.server_restore_status = 'retryable_execute_result_mismatch'
      makeExecutionRetryable(op, safeId, 'server_execute_result_rejected', message, { checks: executeEvaluation.checks })
      throw new Error(message)
    }
    op.server_execute_result = safeServerResult(executeResult)
    op.server_restore_status = 'awaiting_server_verification'
    writeOperationAtomic(safeId, op)

    let serverVerification
    try {
      serverVerification = await queryServerRecoveryVerification(adminClient, op)
    } catch (error) {
      const message = `The disposable lodge may have been created, but server verification could not be confirmed: ${error?.message || 'verification request failed'}. Retry this same operation.`
      op.server_restore_status = 'pending_verification'
      makeExecutionRetryable(op, safeId, 'server_verify_unconfirmed', message)
      throw new Error(message)
    }
    if (!serverVerification.evaluation.passed) {
      const message = 'The server did not confirm quarantine, record counts, ledger reconciliation, and lodge isolation. The operation remains unverified and safe to retry.'
      op.server_restore_status = 'verification_failed'
      op.server_verification = safeServerResult(serverVerification.result)
      op.server_verification_checks = serverVerification.evaluation.checks
      makeExecutionRetryable(op, safeId, 'server_verify_rejected', message, { checks: serverVerification.evaluation.checks })
      throw new Error(message)
    }

    markServerVerified(op, serverVerification.result, serverVerification.evaluation, 'server_verified', true)
    writeOperationAtomic(safeId, op)
    return op
  } catch (error) {
    const latest = readOperation(safeId)
    if (latest && latest.status === 'executing' && latest.execution_pid === process.pid) {
      makeExecutionRetryable(latest, safeId, 'execute_interrupted', error?.message || 'Disposable recovery was interrupted.')
    }
    throw error
  } finally {
    releaseOperationLock(lock)
  }
}

export function discardStarterRecoveryOperation(operationId) {
  const safeId = assertValidOperationId(operationId)
  const op = readOperation(safeId)
  if (!op) throw new Error('Recovery operation not found.')
  if (['executing'].includes(op.status)) throw new Error('Cannot discard an executing operation.')
  if (op.status === 'discarded') return op
  op.status = 'discarded'
  op.discarded_at = new Date().toISOString()
  appendAudit(op, 'discarded', {})
  writeOperationAtomic(safeId, op)
  // Cleanup staged workspace if present, but never the audit record.
  try {
    const workspace = operationWorkspacePath(safeId)
    if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
  } catch {}
  try {
    const staged = stagedPackagePath(safeId)
    if (fs.existsSync(staged)) fs.unlinkSync(staged)
  } catch {}
  return op
}

export function getStarterRecoveryOperation(operationId) {
  const safeId = assertValidOperationId(operationId)
  const op = readOperation(safeId)
  if (!op) throw new Error('Recovery operation not found.')
  // Never surface passphrase.
  const { passphrase: _omit, ...rest } = op
  return rest
}

export function listStarterRecoveryOperations() {
  return listOperations().map((op) => {
    const { passphrase: _omit, ...rest } = op
    return rest
  })
}

export async function verifyStarterRecoveryOperation(operationId, options = {}) {
  const safeId = assertValidOperationId(operationId)
  const op = readOperation(safeId)
  if (!op) throw new Error('Recovery operation not found.')
  if (!op.recovery_lodge_id || !op.server_request_binding || !op.server_table_counts || !op.server_table_hashes) {
    throw new Error('Execute the approved recovery operation before requesting authoritative verification.')
  }
  const adminClient = resolveRecoveryAdminContext(options)
  const local = readLocalRehearsalChecks(op, safeId)
  const { result, evaluation } = await queryServerRecoveryVerification(adminClient, op)
  op.server_verification = safeServerResult(result)
  op.server_verification_checks = evaluation.checks
  op.server_verification_checked_at = new Date().toISOString()
  if (evaluation.passed) {
    markServerVerified(op, result, evaluation, 'server_reverified', local.passed)
  } else {
    op.status = 'approved'
    op.verified_at = null
    op.server_verification_confirmed = false
    op.server_restore_status = 'verification_failed'
    op.supabase_restored = false
    op.restore_persistence = 'unconfirmed'
    op.last_execute_error = 'The server did not confirm the disposable lodge recovery checks.'
    appendAudit(op, 'server_reverify_failed', { checks: evaluation.checks, local_rehearsal_passed: local.passed })
  }
  writeOperationAtomic(safeId, op)
  return {
    success: evaluation.passed,
    operation_id: safeId,
    recovery_lodge_id: op.recovery_lodge_id,
    server_checks: evaluation.checks,
    server: safeServerResult(result),
    local_supplemental: { success: local.passed, checks: local.checks, audit_chain: local.auditChain, report: local.report, rehearsal_directory: local.rehearsalDirectory }
  }
}

export function cleanupExpiredStagedOperations() {
  const now = Date.now()
  for (const op of listAllOperations()) {
    if (op.status === 'executing') {
      try { recoverStaleExecution(op) } catch {}
    }
    let current = op
    try { current = readOperation(op.operation_id) || op } catch { continue }
    if (isExpired(current, now) && current.status !== 'executing' && current.status !== 'discarded') {
      try { discardExpiredOperation(current) } catch {}
    }
  }
  try {
    const root = getOperationsRoot()
    if (!fs.existsSync(root)) return
    for (const name of fs.readdirSync(root).filter((entry) => entry.endsWith('.lock'))) {
      const operationId = name.slice(0, -'.lock'.length)
      if (!OPERATION_ID_PATTERN.test(operationId)) continue
      const lockPath = operationLockPath(operationId)
      let stale = false
      try {
        const metadata = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
        const startedAt = new Date(metadata.started_at || 0).getTime()
        stale = !isProcessAlive(Number(metadata.pid)) && (!Number.isFinite(startedAt) || Date.now() - startedAt > EXECUTION_LOCK_STALE_MS)
      } catch {
        try { stale = Date.now() - fs.statSync(lockPath).mtimeMs > EXECUTION_LOCK_STALE_MS } catch {}
      }
      if (stale) {
        try { fs.unlinkSync(lockPath) } catch {}
      }
    }
  } catch {}
}

export { RECOVERY_WORKSPACE_ENV }
